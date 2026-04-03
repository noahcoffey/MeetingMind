import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger';
import { getSetting, setSetting } from './store';
import type { Project } from './store';
import { listRecordings } from './recording-manager';

function getOutputDir(): string {
  return getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind');
}

function getProjectsDir(): string {
  return path.join(getOutputDir(), 'projects');
}

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

function getClaudePath(): string {
  const candidates = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'claude';
}

function getShellEnv(): Record<string, string> {
  const env = { ...process.env };
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
  ];
  const currentPath = env.PATH || '';
  env.PATH = [...extraPaths, currentPath].join(':');
  return env as Record<string, string>;
}

async function getAnthropicKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'anthropic');
  if (!key) throw new Error('Anthropic API key not configured');
  return key;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- CRUD ---

export function createProject(name: string, notebook: string): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    notebook,
    createdAt: new Date().toISOString(),
    lastSummaryAt: null,
  };

  const projects = getSetting('projects') || [];
  projects.push(project);
  setSetting('projects', projects);

  // Create project directory
  const projectDir = path.join(getProjectsDir(), project.id);
  fs.mkdirSync(projectDir, { recursive: true });

  log('info', 'Project created', { id: project.id, name, notebook });
  return project;
}

export function renameProject(id: string, name: string): { success: boolean } {
  const projects = getSetting('projects') || [];
  const project = projects.find(p => p.id === id);
  if (!project) return { success: false };

  project.name = name;
  setSetting('projects', projects);
  log('info', 'Project renamed', { id, name });
  return { success: true };
}

export function deleteProject(id: string): { success: boolean } {
  const projects = getSetting('projects') || [];
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length === projects.length) return { success: false };

  setSetting('projects', filtered);

  // Clear project field from all recordings
  const recordings = listRecordings();
  for (const rec of recordings) {
    if ((rec as any).project === id) {
      const outputDir = path.dirname(rec.audioPath);
      const manifestPath = path.join(outputDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          delete manifest.project;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch {}
      }
    }
  }

  // Delete project directory
  const projectDir = path.join(getProjectsDir(), id);
  if (fs.existsSync(projectDir)) {
    try { fs.rmSync(projectDir, { recursive: true }); } catch {}
  }

  log('info', 'Project deleted', { id });
  return { success: true };
}

export function updateProjectsForNotebookRename(oldName: string, newName: string): void {
  const projects = getSetting('projects') || [];
  let changed = false;
  for (const p of projects) {
    if (p.notebook === oldName) {
      p.notebook = newName;
      changed = true;
    }
  }
  if (changed) setSetting('projects', projects);
}

export function deleteProjectsForNotebook(notebookName: string): void {
  const projects = getSetting('projects') || [];
  const toDelete = projects.filter(p => p.notebook === notebookName);
  for (const p of toDelete) {
    deleteProject(p.id);
  }
}

export function moveToProject(recordingId: string, projectId: string | null): { success: boolean; error?: string } {
  const recordings = listRecordings();
  const rec = recordings.find(r => r.id === recordingId);
  if (!rec) return { success: false, error: 'Recording not found' };

  const outputDir = path.dirname(rec.audioPath);
  const manifestPath = path.join(outputDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) return { success: false, error: 'Manifest not found' };

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (projectId) {
    manifest.project = projectId;
  } else {
    delete manifest.project;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  log('info', 'Recording moved to project', { recordingId, projectId });
  return { success: true };
}

export function getProjectRecordings(projectId: string): any[] {
  const recordings = listRecordings();
  return recordings.filter((rec: any) => rec.project === projectId);
}

// --- Summary ---

export function getProjectSummary(projectId: string): string | null {
  const summaryPath = path.join(getProjectsDir(), projectId, 'summary.md');
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return fs.readFileSync(summaryPath, 'utf-8');
  } catch {
    return null;
  }
}

function buildMeetingBlocks(recordings: any[]): string {
  return recordings.map((rec: any, i: number) => {
    const outputDir = path.dirname(rec.audioPath);
    const notesPath = path.join(outputDir, 'notes.md');
    let notes = '_(No notes generated for this meeting)_';
    if (fs.existsSync(notesPath)) {
      try { notes = fs.readFileSync(notesPath, 'utf-8'); } catch {}
    }

    const title = rec.title || rec.calendarEvent?.title || 'Untitled Meeting';
    const date = new Date(rec.date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const duration = formatDuration(rec.duration || 0);

    return `### Meeting ${i + 1}: ${title}\n**Date:** ${date} | **Duration:** ${duration}\n\n${notes}`;
  }).join('\n\n---\n\n');
}

function buildFirstRunPrompt(projectName: string, recordings: any[]): string {
  const meetingBlocks = buildMeetingBlocks(recordings);
  const withNotes = recordings.filter((rec: any) => {
    const notesPath = path.join(path.dirname(rec.audioPath), 'notes.md');
    return fs.existsSync(notesPath);
  }).length;

  return `You are synthesizing a project summary from meeting notes. The project is called "${projectName}".

**Total meetings:** ${recordings.length} (${withNotes} with detailed notes)

Below are the meeting notes from this project:

${meetingBlocks}

---

Generate a comprehensive project summary in Markdown with these sections:

# Project Summary: ${projectName}

## Overview
(What this project is about, based on the meetings)

## Key Decisions
(All decisions made across meetings, with dates)

## Current Status & Progress
(Where things stand as of the most recent meeting)

## Open Items & Next Steps
(Unresolved items and upcoming work)

## Meeting Log
(One-line per meeting for quick reference, format: - **Date** — Title: key takeaway)

Important guidelines:
- Synthesize across meetings — don't just list each meeting separately
- Prioritize what's most recent and actionable
- Use specific names when attributing decisions or action items`;
}

function buildIncrementalPrompt(projectName: string, existingSummary: string, newRecordings: any[]): string {
  const meetingBlocks = buildMeetingBlocks(newRecordings);

  return `You are updating an existing project summary with new meeting information. The project is called "${projectName}".

## Current Summary:
${existingSummary}

## New Meetings Since Last Update (${newRecordings.length} meeting${newRecordings.length !== 1 ? 's' : ''}):

${meetingBlocks}

---

Update the project summary by integrating the new meeting information. Preserve important historical context but update the status, decisions, and open items to reflect the latest information. Add new meetings to the Meeting Log. Return the complete updated summary in the same format.

Important guidelines:
- Keep the same section structure (Overview, Key Decisions, Current Status & Progress, Open Items & Next Steps, Meeting Log)
- Update "Current Status & Progress" to reflect the latest state
- Move resolved items out of "Open Items" and note them as completed in "Key Decisions" if appropriate
- Add new action items and decisions
- Keep the summary focused and scannable`;
}

async function generateViaCLI(prompt: string): Promise<string> {
  const claudePath = getClaudePath();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--output-format', 'text'];
    const proc = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let fullOutput = '';
    let stderrOutput = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      fullOutput += text;
      sendToRenderer('project-summary:stream', text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fullOutput.trim().length > 0) {
        resolve(fullOutput);
      } else {
        const errMsg = stderrOutput.trim() || `claude CLI exited with code ${code}`;
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Could not start claude CLI: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function generateViaAPI(prompt: string): Promise<string> {
  const apiKey = await getAnthropicKey();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  const client = new Anthropic({ apiKey });
  let fullOutput = '';

  const stream = client.messages.stream({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullOutput += text;
      sendToRenderer('project-summary:stream', text);
    }
  }

  return fullOutput;
}

export async function generateProjectSummary(
  projectId: string
): Promise<{ success: boolean; summary?: string; error?: string }> {
  const projects = getSetting('projects') || [];
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  try {
    const recordings = getProjectRecordings(projectId);
    if (recordings.length === 0) {
      return { success: false, error: 'No recordings in this project.' };
    }

    // Sort by date ascending
    recordings.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let prompt: string;
    const existingSummary = getProjectSummary(projectId);

    if (!project.lastSummaryAt || !existingSummary) {
      // First run — use all recordings
      prompt = buildFirstRunPrompt(project.name, recordings);
    } else {
      // Incremental — only new recordings since last summary
      const lastSummaryDate = new Date(project.lastSummaryAt);
      const newRecordings = recordings.filter(
        (rec: any) => new Date(rec.date) > lastSummaryDate
      );

      if (newRecordings.length === 0) {
        return { success: true, summary: existingSummary };
      }

      prompt = buildIncrementalPrompt(project.name, existingSummary, newRecordings);
    }

    log('info', 'Generating project summary', {
      projectId,
      projectName: project.name,
      totalRecordings: recordings.length,
      promptLength: prompt.length,
    });

    const provider = getSetting('notesProvider') || 'cli';
    let summary: string;

    if (provider === 'cli') {
      summary = await generateViaCLI(prompt);
    } else {
      summary = await generateViaAPI(prompt);
    }

    // Save summary to disk
    const projectDir = path.join(getProjectsDir(), projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'summary.md'), summary);

    // Update lastSummaryAt
    project.lastSummaryAt = new Date().toISOString();
    setSetting('projects', projects);

    sendToRenderer('project-summary:complete', { projectId, summary });
    log('info', 'Project summary generated', { projectId });
    return { success: true, summary };
  } catch (err: any) {
    log('error', 'Project summary generation failed', { projectId, error: err.message });
    return { success: false, error: err.message };
  }
}
