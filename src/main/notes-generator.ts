import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { autoTagRecording } from './tagger';

const DEFAULT_PROMPT = `You are a professional meeting notes assistant. Based on the transcript and context below, generate structured meeting notes in Markdown format.

Context:
- Meeting: {{event_title}}
- Date: {{date}}
- Attendees: {{attendees}}
- Duration: {{duration}}
- Additional context from the recorder: {{user_context}}
- Primary participant (the person who recorded this): {{user_name}}

Transcript:
{{transcript}}

Generate notes with these exact sections:

# {{suggested_title}}

**Date:** {{date}} | **Attendees:** {{attendees}} | **Duration:** {{duration}}

## Summary
(3-5 sentence executive summary)

## Key Discussion Points
(bullet points of main topics)

## Decisions Made
(explicit decisions reached, or "None recorded" if none)

## Action Items
(format: - [ ] [Person]: [task] (due: [date if mentioned]))

## Open Questions
(unresolved items / parking lot)

## Notes
(any important verbatim quotes or details worth preserving)`;

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

function formatTranscript(transcriptData: any, speakerNames: Record<string, string>): string {
  if (!transcriptData.utterances) {
    return transcriptData.text || '';
  }

  return transcriptData.utterances
    .map((u: any) => {
      const speaker = speakerNames[u.speaker] || u.speaker;
      const time = new Date(u.start).toISOString().substr(11, 8);
      return `[${time}] ${speaker}: ${u.text}`;
    })
    .join('\n');
}

function buildPrompt(recording: any, transcript: string): string {
  const template = getSetting('notesPromptTemplate') || DEFAULT_PROMPT;
  const userName = getSetting('userName') || 'Unknown';

  const date = new Date(recording.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const eventTitle = recording.calendarEvent?.title || recording.title || 'Untitled Meeting';
  const attendees = recording.calendarEvent?.attendees?.join(', ') || userName;
  const duration = formatDuration(recording.duration);
  const userContext = recording.userContext || 'None provided';

  return template
    .replace(/\{\{event_title\}\}/g, eventTitle)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{attendees\}\}/g, attendees)
    .replace(/\{\{duration\}\}/g, duration)
    .replace(/\{\{user_context\}\}/g, userContext)
    .replace(/\{\{user_name\}\}/g, userName)
    .replace(/\{\{transcript\}\}/g, transcript)
    .replace(/\{\{suggested_title\}\}/g, eventTitle);
}

// Sanitize filename for Obsidian and filesystem compatibility
// Removes: \ / : * ? " < > | # ^ [ ]
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Meeting';
}

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

// Resolve the claude CLI binary path
function getClaudePath(): string {
  // Common install locations
  const candidates = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fall back to PATH resolution
  return 'claude';
}

// Build a shell environment that includes common PATH entries
// Electron apps don't always inherit the user's full shell PATH
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

// Generate notes via Claude Code CLI (uses subscription, not API credits)
async function generateNotesViaCLI(prompt: string): Promise<string> {
  const claudePath = getClaudePath();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  log('info', 'Generating notes via Claude CLI', { claudePath, model });

  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--output-format', 'text'];
    const proc = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let fullNotes = '';
    let stderrOutput = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      fullNotes += text;
      sendToRenderer('notes:stream', text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fullNotes.trim().length > 0) {
        resolve(fullNotes);
      } else {
        const errMsg = stderrOutput.trim() || `claude CLI exited with code ${code}`;
        log('error', 'Claude CLI failed', { code, stderr: stderrOutput });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      log('error', 'Failed to spawn claude CLI', err);
      reject(new Error(
        `Could not start claude CLI: ${err.message}. ` +
        'Make sure Claude Code is installed (npm install -g @anthropic-ai/claude-code) ' +
        'and the "claude" command is in your PATH.'
      ));
    });

    // Write the prompt to stdin
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// Generate notes via Anthropic API (uses API credits)
async function generateNotesViaAPI(prompt: string): Promise<string> {
  const apiKey = await getAnthropicKey();
  const model = getSetting('claudeModel') || 'claude-sonnet-4-20250514';

  const client = new Anthropic({ apiKey });
  let fullNotes = '';

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullNotes += text;
      sendToRenderer('notes:stream', text);
    }
  }

  return fullNotes;
}

export async function generateNotes(recordingId: string): Promise<{ success: boolean; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const outputDir = path.dirname(recording.audioPath);
  const transcriptPath = path.join(outputDir, 'transcript.json');

  if (!fs.existsSync(transcriptPath)) {
    return { success: false, error: 'Transcript not found. Please transcribe first.' };
  }

  try {
    const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
    const speakerNames = recording.speakerNames || {};
    const transcript = formatTranscript(transcriptData, speakerNames);
    const prompt = buildPrompt(recording, transcript);

    // Update status
    updateRecordingStatus(recordingId, 'generating');

    const provider = getSetting('notesProvider') || 'cli';
    let fullNotes: string;

    if (provider === 'cli') {
      fullNotes = await generateNotesViaCLI(prompt);
    } else {
      fullNotes = await generateNotesViaAPI(prompt);
    }

    // Save notes
    const notesPath = path.join(outputDir, 'notes.md');
    fs.writeFileSync(notesPath, fullNotes);

    // Ensure notes output directory exists
    const notesOutputDir = path.join(
      getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind'),
      'notes'
    );
    fs.mkdirSync(notesOutputDir, { recursive: true });

    updateRecordingStatus(recordingId, 'complete');
    sendToRenderer('notes:complete', { recordingId, notes: fullNotes });

    // Fire-and-forget auto-tagging
    autoTagRecording(recordingId).catch((err: any) => {
      log('warn', 'Auto-tagging failed (non-blocking)', { recordingId, error: err.message });
    });

    // Auto-save to Obsidian if enabled
    if (getSetting('autoSaveToObsidian') && getSetting('obsidianVaultPath')) {
      try {
        const dateStr = new Date(recording.date).toISOString().slice(0, 10);
        const title = sanitizeFilename(recording.title || recording.calendarEvent?.title || 'Untitled Meeting');
        const filename = `${dateStr} - ${title}.md`;
        const obsidianResult = await saveToObsidian(recordingId, filename);
        if (obsidianResult.success) {
          log('info', 'Auto-saved notes to Obsidian', { recordingId, filename });
        } else {
          log('warn', 'Auto-save to Obsidian failed', { recordingId, error: obsidianResult.error });
        }
      } catch (err: any) {
        log('warn', 'Auto-save to Obsidian error', { recordingId, error: err.message });
      }
    }

    log('info', 'Notes generated successfully', { recordingId, provider });
    return { success: true };
  } catch (err: any) {
    log('error', 'Notes generation failed', err);
    updateRecordingStatus(recordingId, 'transcribed');
    return { success: false, error: err.message };
  }
}

export function getNotes(recordingId: string): string | null {
  const recording = getRecording(recordingId);
  if (!recording) return null;

  const outputDir = path.dirname(recording.audioPath);
  const notesPath = path.join(outputDir, 'notes.md');

  if (!fs.existsSync(notesPath)) return null;
  try {
    return fs.readFileSync(notesPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function suggestTitle(recordingId: string): Promise<string> {
  const recording = getRecording(recordingId);
  if (!recording) return 'Untitled Meeting';

  if (recording.calendarEvent?.title) {
    return recording.calendarEvent.title;
  }

  try {
    const outputDir = path.dirname(recording.audioPath);
    const notesPath = path.join(outputDir, 'notes.md');

    if (!fs.existsSync(notesPath)) return 'Untitled Meeting';

    const notes = fs.readFileSync(notesPath, 'utf-8');
    const summary = notes.substring(0, 1000);
    const titlePrompt = `Based on these meeting notes, suggest a concise 4-6 word title for this meeting. Return ONLY the title, no quotes or punctuation.\n\n${summary}`;

    const provider = getSetting('notesProvider') || 'cli';

    if (provider === 'cli') {
      const claudePath = getClaudePath();
      const title = await new Promise<string>((resolve, reject) => {
        const proc = spawn(claudePath, ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: getShellEnv(),
        });
        let output = '';
        proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
        proc.on('close', (code) => {
          if (code === 0 && output.trim()) resolve(output.trim());
          else resolve('Untitled Meeting');
        });
        proc.on('error', () => resolve('Untitled Meeting'));
        proc.stdin.write(titlePrompt);
        proc.stdin.end();
      });
      return title;
    } else {
      const apiKey = await getAnthropicKey();
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: titlePrompt }],
      });
      const title = (response.content[0] as any).text?.trim() || 'Untitled Meeting';
      return title;
    }
  } catch {
    return 'Untitled Meeting';
  }
}

export async function saveNotes(recordingId: string, filename: string): Promise<{ success: boolean; path?: string; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const outputDir = path.dirname(recording.audioPath);
  const notesPath = path.join(outputDir, 'notes.md');

  if (!fs.existsSync(notesPath)) {
    return { success: false, error: 'Notes not found' };
  }

  const notesOutputDir = path.join(
    getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind'),
    'notes'
  );
  fs.mkdirSync(notesOutputDir, { recursive: true });

  const safeFilename = sanitizeFilename(filename.replace(/\.md$/, '')) + '.md';
  const savePath = path.join(notesOutputDir, safeFilename);
  fs.copyFileSync(notesPath, savePath);

  return { success: true, path: savePath };
}

export async function saveToObsidian(recordingId: string, filename: string): Promise<{ success: boolean; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const vaultPath = getSetting('obsidianVaultPath');
  if (!vaultPath) return { success: false, error: 'Obsidian vault path not configured' };

  const subfolder = getSetting('obsidianSubfolder') || 'Meeting Notes';
  const outputDir = path.dirname(recording.audioPath);
  const notesPath = path.join(outputDir, 'notes.md');

  if (!fs.existsSync(notesPath)) {
    return { success: false, error: 'Notes not found' };
  }

  const safeFilename = sanitizeFilename(filename.replace(/\.md$/, '')) + '.md';
  const obsidianDir = path.join(vaultPath, subfolder);
  fs.mkdirSync(obsidianDir, { recursive: true });

  const savePath = path.join(obsidianDir, safeFilename);

  if (fs.existsSync(savePath)) {
    log('warn', 'Overwriting existing Obsidian note', { savePath });
  }

  fs.copyFileSync(notesPath, savePath);

  // Inject backlink into daily note
  const dailyNotesFolder = getSetting('obsidianDailyNotesFolder') || '';
  const dailyNotePath = path.join(
    vaultPath,
    dailyNotesFolder,
    `${new Date().toISOString().slice(0, 10)}.md`
  );

  if (fs.existsSync(dailyNotePath)) {
    let dailyContent = fs.readFileSync(dailyNotePath, 'utf-8');
    const noteLink = `- [[${subfolder}/${safeFilename.replace('.md', '')}]]`;

    if (!dailyContent.includes(noteLink)) {
      if (dailyContent.includes('## Meetings')) {
        dailyContent = dailyContent.replace(
          '## Meetings',
          `## Meetings\n${noteLink}`
        );
      } else {
        dailyContent += `\n\n## Meetings\n${noteLink}\n`;
      }
      fs.writeFileSync(dailyNotePath, dailyContent);
    }
  }

  log('info', 'Notes saved to Obsidian', { savePath });
  return { success: true };
}

function updateRecordingStatus(recordingId: string, status: string): void {
  const outputDir = getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind', 'recordings');
  const manifestPath = path.join(outputDir, recordingId, 'manifest.json');

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.status = status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}
