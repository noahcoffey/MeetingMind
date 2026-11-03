import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { runClaude } from './claude-cli';

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

// Keep the prompt comfortably inside the model's context window (and the
// cost of a single question bounded) — ~150k chars is roughly 40k tokens.
// A multi-hour meeting transcript can exceed this several times over.
const MAX_TRANSCRIPT_CHARS = 150_000;

export function truncateTranscript(transcript: string): { text: string; truncated: boolean } {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return { text: transcript, truncated: false };
  }
  // Keep the beginning and end (agenda up front, decisions at the end) and
  // drop the middle, cutting at line boundaries so utterances stay intact.
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  let head = transcript.slice(0, half);
  head = head.slice(0, head.lastIndexOf('\n') + 1 || half);
  let tail = transcript.slice(-half);
  tail = tail.slice(tail.indexOf('\n') + 1);
  return {
    text: `${head}\n[... middle of the transcript omitted for length ...]\n${tail}`,
    truncated: true,
  };
}

// The meeting material, kept byte-for-byte identical between questions about
// the same meeting so it's served from the prompt cache after the first one.
function buildQAContext(recording: any, notes: string, transcript: string): string {
  const userName = getSetting('userName') || 'the user';
  const { text: boundedTranscript, truncated } = truncateTranscript(transcript);
  const truncationNote = truncated
    ? '\nNote: the transcript was too long to include in full — its middle section has been omitted.\n'
    : '';
  return `Meeting: ${recording.title || recording.calendarEvent?.title || 'Untitled Meeting'}
Date: ${new Date(recording.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Recorded by: ${userName}
${truncationNote}
--- MEETING NOTES ---
${notes || '(No notes available)'}

--- TRANSCRIPT ---
${boundedTranscript || '(No transcript available)'}`;
}

function buildQAPrompt(question: string, truncated: boolean): string {
  return `You are a helpful assistant answering questions about a specific meeting. Use the meeting notes and transcript provided above to answer the user's question accurately and concisely.

If the answer is not found in the provided context, say so clearly rather than guessing.${truncated ? ' The middle of the transcript was omitted for length; if the answer may depend on it, say so.' : ''}

--- QUESTION ---
${question}`;
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
  const context = buildQAContext(recording, notes, transcript);
  const prompt = buildQAPrompt(question, truncateTranscript(transcript).truncated);

  try {
    const { text: answer } = await runClaude({
      label: 'qa',
      context,
      prompt,
      onChunk: (text) => sendToRenderer('qa:stream', { qaId, recordingId, text }),
    });

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
    const provider = getSetting('notesProvider') || 'cli';
    const providerLabel = provider === 'cli' ? 'Claude CLI' : 'Anthropic API';
    const errorMsg = `[${providerLabel}] ${err.message}`;
    sendToRenderer('qa:error', { qaId, error: errorMsg });
    return { success: false, error: errorMsg };
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
