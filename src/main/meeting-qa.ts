import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';

export interface QAEntry {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

function getQAPath(recordingId: string): string | null {
  const recording = getRecording(recordingId);
  if (!recording) return null;
  return path.join(path.dirname(recording.audioPath), 'questions.json');
}

export function getQuestions(recordingId: string): QAEntry[] {
  const qaPath = getQAPath(recordingId);
  if (!qaPath || !fs.existsSync(qaPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(qaPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveQuestions(recordingId: string, entries: QAEntry[]): void {
  const qaPath = getQAPath(recordingId);
  if (!qaPath) return;
  fs.writeFileSync(qaPath, JSON.stringify(entries, null, 2));
}

function buildQAPrompt(recording: any, notes: string, transcript: string, question: string): string {
  const userName = getSetting('userName') || 'the user';
  return `You are a helpful assistant answering questions about a specific meeting. Use the meeting notes and transcript below to answer the user's question accurately and concisely.

If the answer is not found in the provided context, say so clearly rather than guessing.

Meeting: ${recording.title || recording.calendarEvent?.title || 'Untitled Meeting'}
Date: ${new Date(recording.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Recorded by: ${userName}

--- MEETING NOTES ---
${notes || '(No notes available)'}

--- TRANSCRIPT ---
${transcript || '(No transcript available)'}

--- QUESTION ---
${question}`;
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
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env as Record<string, string>;
}

async function getAnthropicKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'anthropic');
  if (!key) throw new Error('Anthropic API key not configured');
  return key;
}

async function askViaCLI(prompt: string, qaId: string): Promise<string> {
  const claudePath = getClaudePath();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ['-p', '--model', model, '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let fullAnswer = '';
    let stderrOutput = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      fullAnswer += text;
      sendToRenderer('qa:stream', { qaId, text });
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fullAnswer.trim().length > 0) {
        resolve(fullAnswer);
      } else {
        reject(new Error(stderrOutput.trim() || `claude CLI exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Could not start claude CLI: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function askViaAPI(prompt: string, qaId: string): Promise<string> {
  const apiKey = await getAnthropicKey();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';
  const client = new Anthropic({ apiKey });
  let fullAnswer = '';

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullAnswer += text;
      sendToRenderer('qa:stream', { qaId, text });
    }
  }

  return fullAnswer;
}

export async function askQuestion(
  recordingId: string,
  question: string,
): Promise<{ success: boolean; entry?: QAEntry; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const outputDir = path.dirname(recording.audioPath);

  // Load notes
  let notes = '';
  const notesPath = path.join(outputDir, 'notes.md');
  if (fs.existsSync(notesPath)) {
    notes = fs.readFileSync(notesPath, 'utf-8');
  }

  // Load transcript
  let transcript = '';
  const transcriptPath = path.join(outputDir, 'transcript.json');
  if (fs.existsSync(transcriptPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
      const speakerNames = recording.speakerNames || {};
      if (data.utterances) {
        transcript = data.utterances
          .map((u: any) => {
            const speaker = speakerNames[u.speaker] || u.speaker;
            return `${speaker}: ${u.text}`;
          })
          .join('\n');
      } else {
        transcript = data.text || '';
      }
    } catch {}
  }

  if (!notes && !transcript) {
    return { success: false, error: 'No notes or transcript available for this meeting.' };
  }

  const qaId = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prompt = buildQAPrompt(recording, notes, transcript, question);

  try {
    const provider = getSetting('notesProvider') || 'cli';
    let answer: string;

    if (provider === 'cli') {
      answer = await askViaCLI(prompt, qaId);
    } else {
      answer = await askViaAPI(prompt, qaId);
    }

    const entry: QAEntry = {
      id: qaId,
      question,
      answer,
      timestamp: new Date().toISOString(),
    };

    // Save to questions.json
    const existing = getQuestions(recordingId);
    existing.push(entry);
    saveQuestions(recordingId, existing);

    sendToRenderer('qa:complete', { qaId, recordingId });
    log('info', 'Q&A completed', { recordingId, qaId });
    return { success: true, entry };
  } catch (err: any) {
    log('error', 'Q&A failed', { recordingId, error: err.message });
    sendToRenderer('qa:error', { qaId, error: err.message });
    return { success: false, error: err.message };
  }
}

export function deleteQuestion(recordingId: string, qaId: string): { success: boolean } {
  const entries = getQuestions(recordingId);
  const filtered = entries.filter(e => e.id !== qaId);
  saveQuestions(recordingId, filtered);
  return { success: true };
}

// Sanitize filename for Obsidian compatibility
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Meeting';
}

export function appendQAToObsidian(
  recordingId: string,
  qaId: string,
): { success: boolean; error?: string } {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const vaultPath = getSetting('obsidianVaultPath');
  if (!vaultPath) return { success: false, error: 'Obsidian vault path not configured' };

  const entries = getQuestions(recordingId);
  const entry = entries.find(e => e.id === qaId);
  if (!entry) return { success: false, error: 'Question not found' };

  const subfolder = getSetting('obsidianSubfolder') || 'Meeting Notes';
  const dateStr = new Date(recording.date).toISOString().slice(0, 10);
  const title = sanitizeFilename(
    (recording.title || recording.calendarEvent?.title || 'Untitled Meeting').replace(/\.md$/, '')
  );
  const filename = `${dateStr} - ${title}.md`;
  const notePath = path.join(vaultPath, subfolder, filename);

  if (!fs.existsSync(notePath)) {
    return { success: false, error: 'Obsidian note not found. Save notes to Obsidian first.' };
  }

  let content = fs.readFileSync(notePath, 'utf-8');

  // Build the Q&A block
  const qaBlock = `\n> **Q:** ${entry.question}\n>\n> **A:** ${entry.answer}\n`;

  // Append under existing "Questions & Answers" section, or create it
  if (content.includes('## Questions & Answers')) {
    content = content.trimEnd() + '\n' + qaBlock;
  } else {
    content = content.trimEnd() + '\n\n## Questions & Answers\n' + qaBlock;
  }

  fs.writeFileSync(notePath, content);
  log('info', 'Q&A appended to Obsidian note', { notePath, qaId });
  return { success: true };
}
