import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { log } from './logger';
import { getSetting } from './store';
import { listRecordings, getRecording } from './recording-manager';

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

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface MeetingInput {
  id: string;
  title: string;
  date: string;
  duration: string;
  attendees: string;
  notes: string | null;
  hasNotes: boolean;
}

/**
 * Collect recordings within a date range and gather their notes.
 * Uses pre-generated notes (not raw transcripts) to stay well within
 * Claude's context window. A busy week of ~20 meetings with notes
 * averages ~30K-50K tokens — well under the 200K limit.
 */
export function getRecordingsInRange(startDate: string, endDate: string): MeetingInput[] {
  const recordings = listRecordings();
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const inRange = recordings.filter((rec: any) => {
    const recDate = new Date(rec.date);
    return recDate >= start && recDate <= end;
  });

  return inRange.map((rec: any) => {
    const outputDir = path.dirname(rec.audioPath);
    const notesPath = path.join(outputDir, 'notes.md');

    let notes: string | null = null;
    if (fs.existsSync(notesPath)) {
      try {
        notes = fs.readFileSync(notesPath, 'utf-8');
      } catch {}
    }

    // Build attendee list
    const calendarAttendees = rec.calendarEvent?.attendees || [];
    const speakerNames: Record<string, string> = rec.speakerNames || {};
    const labeledSpeakers = Object.values(speakerNames).filter(
      (name: string) => name && !name.startsWith('Speaker ')
    );
    const allAttendees = new Set<string>([...calendarAttendees, ...labeledSpeakers]);
    const userName = getSetting('userName');
    if (userName) allAttendees.add(userName);

    return {
      id: rec.id,
      title: rec.title || rec.calendarEvent?.title || 'Untitled Meeting',
      date: new Date(rec.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      duration: formatDuration(rec.duration || 0),
      attendees: allAttendees.size > 0 ? Array.from(allAttendees).join(', ') : 'Unknown',
      notes,
      hasNotes: notes !== null,
    };
  });
}

function buildHighlightsPrompt(meetings: MeetingInput[], startDate: string, endDate: string): string {
  const userName = getSetting('userName') || 'the user';
  const start = new Date(startDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const end = new Date(endDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const meetingBlocks = meetings.map((m, i) => {
    const header = `### Meeting ${i + 1}: ${m.title}\n**Date:** ${m.date} | **Duration:** ${m.duration} | **Attendees:** ${m.attendees}`;
    if (m.notes) {
      return `${header}\n\n${m.notes}`;
    }
    return `${header}\n\n_(No notes generated for this meeting)_`;
  }).join('\n\n---\n\n');

  const meetingsWithNotes = meetings.filter(m => m.hasNotes).length;
  const meetingsWithoutNotes = meetings.length - meetingsWithNotes;

  let caveat = '';
  if (meetingsWithoutNotes > 0) {
    caveat = `\n\nNote: ${meetingsWithoutNotes} of ${meetings.length} meetings do not have generated notes. Include them in the count but note that details are unavailable.`;
  }

  return `You are a professional executive assistant creating a weekly highlights report. You are writing this for ${userName}.

**Period:** ${start} through ${end}
**Total meetings:** ${meetings.length} (${meetingsWithNotes} with detailed notes)${caveat}

Below are the complete meeting notes from this period. Synthesize them into a cohesive weekly highlights report.

${meetingBlocks}

---

Generate a comprehensive "Weekly Highlights" report in Markdown with these sections:

# Weekly Highlights: ${start.split(',')[0]} – ${end.split(',')[0]}

**Period:** ${start} – ${end} | **Meetings:** ${meetings.length}

## Executive Summary
(3-5 sentences capturing the most important themes and outcomes of the week)

## Key Topics & Themes
(Group related discussions across meetings into major topic areas. For each topic:
- Summarize what was discussed
- Note which meetings covered it
- Highlight any decisions or conclusions reached)

## Decisions Made
(All decisions from across meetings, organized by topic area. Include who decided and in which meeting.)

## Action Items
(Consolidated from all meetings. Format: - [ ] [Person]: [task] (from: [meeting name], due: [date if mentioned]))

## Notable Discussions
(Important conversations, debates, or insights worth remembering — things that might not be "decisions" but provide important context)

## Open Questions & Follow-ups
(Unresolved items from across meetings that need attention next week)

## Week at a Glance
(Brief 1-line summary per meeting for quick reference)

Important guidelines:
- Cross-reference information across meetings to find themes and connections
- Do NOT simply list each meeting's notes separately — synthesize and group by topic
- Prioritize what's most important and actionable
- Use specific names when attributing decisions or action items
- Keep the report focused and scannable`;
}

async function generateViaCLI(prompt: string): Promise<string> {
  const claudePath = getClaudePath();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  log('info', 'Generating weekly highlights via Claude CLI', { claudePath, model });

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
      sendToRenderer('highlights:stream', text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fullOutput.trim().length > 0) {
        resolve(fullOutput);
      } else {
        const errMsg = stderrOutput.trim() || `claude CLI exited with code ${code}`;
        log('error', 'Claude CLI failed for highlights', { code, stderr: stderrOutput });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      log('error', 'Failed to spawn claude CLI for highlights', err);
      reject(new Error(
        `Could not start claude CLI: ${err.message}. ` +
        'Make sure Claude Code is installed and the "claude" command is in your PATH.'
      ));
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
      sendToRenderer('highlights:stream', text);
    }
  }

  return fullOutput;
}

export async function generateWeeklyHighlights(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; report?: string; error?: string; meetingCount?: number }> {
  try {
    const meetings = getRecordingsInRange(startDate, endDate);

    if (meetings.length === 0) {
      return { success: false, error: 'No recordings found in the selected date range.' };
    }

    const meetingsWithNotes = meetings.filter(m => m.hasNotes);
    if (meetingsWithNotes.length === 0) {
      return {
        success: false,
        error: `Found ${meetings.length} recording(s) but none have generated notes. Please generate notes for your meetings first.`,
      };
    }

    const prompt = buildHighlightsPrompt(meetings, startDate, endDate);

    log('info', 'Generating weekly highlights', {
      startDate,
      endDate,
      totalMeetings: meetings.length,
      withNotes: meetingsWithNotes.length,
      promptLength: prompt.length,
    });

    const provider = getSetting('notesProvider') || 'cli';
    let report: string;

    if (provider === 'cli') {
      report = await generateViaCLI(prompt);
    } else {
      report = await generateViaAPI(prompt);
    }

    // Save the report
    const outputDir = getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind');
    const highlightsDir = path.join(outputDir, 'highlights');
    fs.mkdirSync(highlightsDir, { recursive: true });

    const filename = `highlights-${startDate}-to-${endDate}.md`;
    const reportPath = path.join(highlightsDir, filename);
    fs.writeFileSync(reportPath, report);

    sendToRenderer('highlights:complete', { report });

    log('info', 'Weekly highlights generated', { reportPath, meetingCount: meetings.length });

    return { success: true, report, meetingCount: meetings.length };
  } catch (err: any) {
    log('error', 'Weekly highlights generation failed', err);
    return { success: false, error: err.message };
  }
}

export function getHighlightsPreview(
  startDate: string,
  endDate: string
): { meetingCount: number; withNotes: number; withoutNotes: number; meetings: { title: string; date: string; hasNotes: boolean }[] } {
  const meetings = getRecordingsInRange(startDate, endDate);
  return {
    meetingCount: meetings.length,
    withNotes: meetings.filter(m => m.hasNotes).length,
    withoutNotes: meetings.filter(m => !m.hasNotes).length,
    meetings: meetings.map(m => ({ title: m.title, date: m.date, hasNotes: m.hasNotes })),
  };
}
