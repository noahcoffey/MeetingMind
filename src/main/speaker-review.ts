import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, Notification } from 'electron';
import { log } from './logger';
import { getSetting, setSetting } from './store';
import { getOutputDir, getRecording } from './recording-manager';
import { runClaudePrompt } from './claude-cli';

// The gate between transcription and notes generation.
//
// Diarization hands back "Speaker 1", "Speaker 2"... and notes generated from
// that attribute action items to nobody in particular — or to the wrong
// person once Claude guesses. So the automatic pipeline can pause here,
// after the transcript exists and before notes are generated (and, with
// them, pushed to MeetingHub — whose ingest is first-send-wins), until the
// speakers have names.
//
// A pause is a manifest field (`awaitingSpeakerReview`), not a new status:
// the renderer has a dozen checks on 'transcribed' that all still apply to a
// paused recording. generateNotes() clears the field whichever button
// started it, so every path out of the gate is the same path.

export interface SpeakerSuggestion {
  name: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export type SpeakerSuggestions = Record<string, SpeakerSuggestion>;

export interface GateDecision {
  proceed: boolean;
  reason: 'gate-off' | 'single-speaker' | 'all-named' | 'identified' | 'needs-review';
  /** Names to write into speakerNames before proceeding (identified only). */
  apply?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Pure helpers (tested)

/** Turn a calendar attendee — "Dana Whitfield", "dana.whitfield@x.com",
 *  "Whitfield, Dana" — into something you would put on a name chip. */
export function attendeeDisplayName(raw: string): string {
  let s = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (s.includes('@')) {
    const local = s.split('@')[0];
    s = local
      .split(/[._\-+]+/)
      .filter(Boolean)
      .filter(part => !/^\d+$/.test(part))
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  } else if (/^[^,]+,\s*[^,]+$/.test(s)) {
    const [last, first] = s.split(',').map(p => p.trim());
    s = `${first} ${last}`;
  }
  return s;
}

/** Everyone who might have been in the room, de-duplicated, display-ready. */
export function candidateNames(recording: any, userName: string, directory: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (n: string) => {
    const name = attendeeDisplayName(n);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) { seen.add(key); out.push(name); }
  };
  if (userName) push(userName);
  for (const a of recording?.calendarEvent?.attendees || []) push(a);
  for (const d of directory) push(d);
  return out;
}

export function distinctSpeakers(utterances: Array<{ speaker: string }>): string[] {
  return Array.from(new Set((utterances || []).map(u => u.speaker).filter(Boolean)));
}

function isUnnamed(key: string, speakerNames: Record<string, string>): boolean {
  const n = speakerNames[key];
  return !n || n === key || /^Speaker \d+$/i.test(n);
}

/**
 * Decide whether the pipeline may go straight to notes. Suggestions (if any)
 * only count when they are high confidence and — when we know who was
 * invited — name someone from that list.
 */
export function decideGate(args: {
  gateEnabled: boolean;
  speakers: string[];
  speakerNames: Record<string, string>;
  suggestions?: SpeakerSuggestions | null;
  candidates: string[];
}): GateDecision {
  const { gateEnabled, speakers, speakerNames, suggestions, candidates } = args;
  if (!gateEnabled) return { proceed: true, reason: 'gate-off' };
  if (speakers.length <= 1) return { proceed: true, reason: 'single-speaker' };

  const unnamed = speakers.filter(k => isUnnamed(k, speakerNames));
  if (unnamed.length === 0) return { proceed: true, reason: 'all-named' };

  if (suggestions) {
    const lowerCandidates = new Set(candidates.map(c => c.toLowerCase()));
    const apply: Record<string, string> = {};
    const used = new Set<string>();
    for (const key of unnamed) {
      const s = suggestions[key];
      if (!s || !s.name || s.confidence !== 'high') return { proceed: false, reason: 'needs-review' };
      const name = s.name.trim();
      if (lowerCandidates.size > 0 && !lowerCandidates.has(name.toLowerCase())) {
        return { proceed: false, reason: 'needs-review' };
      }
      // Two speakers resolved to the same person is a diarization split we
      // should not paper over silently.
      if (used.has(name.toLowerCase())) return { proceed: false, reason: 'needs-review' };
      used.add(name.toLowerCase());
      apply[key] = name;
    }
    return { proceed: true, reason: 'identified', apply };
  }

  return { proceed: false, reason: 'needs-review' };
}

/** Pull the suggestion map out of whatever Claude wrote around the JSON. */
export function parseSuggestions(text: string, speakers: string[]): SpeakerSuggestions {
  const tryParse = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(text.trim());
  if (!obj) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) obj = tryParse(fenced[1].trim());
  }
  if (!obj) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1));
  }
  if (!obj || typeof obj !== 'object') throw new Error(`Could not parse speaker suggestions: ${text.slice(0, 200)}`);
  const map = obj.speakers && typeof obj.speakers === 'object' ? obj.speakers : obj;

  const out: SpeakerSuggestions = {};
  for (const key of speakers) {
    const raw = map[key];
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' && raw.name.trim() && !/^(unknown|null|none)$/i.test(raw.name.trim())
      ? raw.name.trim()
      : null;
    const conf = String(raw.confidence || '').toLowerCase();
    out[key] = {
      name,
      confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
      reason: typeof raw.reason === 'string' ? raw.reason.trim() : '',
    };
  }
  return out;
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MAX_TRANSCRIPT_CHARS = 200_000;

export function buildIdentifyPrompt(args: {
  speakers: string[];
  utterances: Array<{ speaker: string; text: string; start: number }>;
  candidates: string[];
  userName: string;
  title: string;
  alreadyNamed: Record<string, string>;
}): string {
  const { speakers, utterances, candidates, userName, title, alreadyNamed } = args;
  let transcript = utterances.map(u => `[${fmtTime(u.start)}] ${u.speaker}: ${u.text}`).join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[... transcript truncated ...]';
  }
  const known = Object.entries(alreadyNamed)
    .filter(([k, v]) => v && v !== k)
    .map(([k, v]) => `- ${k} is ${v}`)
    .join('\n');

  return `You are matching anonymous diarized speaker labels to real people in a meeting transcript.

Meeting: ${title || 'Untitled'}
Speaker labels in the transcript: ${speakers.join(', ')}
${userName ? `The person who recorded this meeting is ${userName}. They are almost certainly one of the speakers.` : ''}
${candidates.length ? `People invited or likely present: ${candidates.join(', ')}` : 'No attendee list is available.'}
${known ? `Already identified:\n${known}` : ''}

Use evidence from the transcript: self-introductions ("this is Dana", "Dana here"), people addressing each other by name ("thanks, Dana" said to the speaker who just spoke, or a question directed at someone who then answers), and role context. Prefer names from the attendee list. Never invent a name that is neither on the list nor spoken in the transcript. If the evidence is thin, say so with a lower confidence rather than guessing.

Confidence:
- "high": direct evidence, such as a self-introduction or being addressed by name and then replying, and no conflicting evidence.
- "medium": reasonable inference, such as elimination from the attendee list.
- "low": a guess.

Reply with ONLY a JSON object, no prose, shaped like:
{"speakers": {"Speaker 1": {"name": "Dana Whitfield", "confidence": "high", "reason": "Introduces herself at 0:14"}, "Speaker 2": {"name": null, "confidence": "low", "reason": "Never named"}}}
Include every speaker label. Use null for name when unknown. Use the full name from the attendee list when it matches.

Transcript:
${transcript}`;
}

// ---------------------------------------------------------------------------
// Manifest plumbing

function manifestPath(recordingId: string): string {
  return path.join(getOutputDir(), recordingId, 'manifest.json');
}

function updateManifest(recordingId: string, mutate: (m: any) => void): any | null {
  const p = manifestPath(recordingId);
  if (!fs.existsSync(p)) return null;
  const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
  mutate(manifest);
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  return manifest;
}

function readTranscriptUtterances(recording: any): Array<{ speaker: string; text: string; start: number; end: number }> {
  const transcriptPath = path.join(path.dirname(recording.audioPath), 'transcript.json');
  if (!fs.existsSync(transcriptPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
    return Array.isArray(data.utterances) ? data.utterances : [];
  } catch {
    return [];
  }
}

function sendToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, data);
}

// ---------------------------------------------------------------------------
// Public API

/** Ask Claude who each speaker is and remember the answer on the manifest. */
export async function identifySpeakers(recordingId: string): Promise<{ success: boolean; suggestions?: SpeakerSuggestions; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };
  const utterances = readTranscriptUtterances(recording);
  const speakers = distinctSpeakers(utterances);
  if (speakers.length === 0) return { success: false, error: 'No diarized transcript to identify speakers from' };

  const userName = getSetting('userName') || '';
  const candidates = candidateNames(recording, userName, getSetting('speakerDirectory') || []);
  const prompt = buildIdentifyPrompt({
    speakers,
    utterances,
    candidates,
    userName,
    title: recording.calendarEvent?.title || recording.title || '',
    alreadyNamed: recording.speakerNames || {},
  });

  try {
    log('info', 'Identifying speakers with Claude', { recordingId, speakers: speakers.length, candidates: candidates.length });
    const text = await runClaudePrompt(prompt, { maxTokens: 2000 });
    const suggestions = parseSuggestions(text, speakers);
    updateManifest(recordingId, m => {
      m.speakerSuggestions = suggestions;
      m.speakerSuggestionsAt = new Date().toISOString();
    });
    sendToRenderer('speakers:suggestions', { recordingId, suggestions });
    return { success: true, suggestions };
  } catch (err: any) {
    log('warn', 'Speaker identification failed', { recordingId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Called by the auto pipeline once a transcript exists. Either says "go ahead"
 * or parks the recording behind the gate and tells the user.
 */
export async function prepareSpeakerReview(recordingId: string): Promise<{ proceed: boolean; reason: GateDecision['reason'] }> {
  const recording = getRecording(recordingId);
  if (!recording) return { proceed: true, reason: 'gate-off' };

  const gateEnabled = getSetting('speakerReviewBeforeNotes') !== false;
  const utterances = readTranscriptUtterances(recording);
  const speakers = distinctSpeakers(utterances);
  const speakerNames: Record<string, string> = recording.speakerNames || {};
  const userName = getSetting('userName') || '';
  const candidates = candidateNames(recording, userName, getSetting('speakerDirectory') || []);

  // The pre-pass is worth running whenever there is someone to identify, gate
  // or no gate: with the gate off, confident names still improve the notes.
  const unnamedSpeakers = speakers.filter(k => isUnnamed(k, speakerNames));
  let suggestions: SpeakerSuggestions | null = null;
  if (speakers.length > 1 && unnamedSpeakers.length > 0 && getSetting('speakerIdentifyWithClaude') !== false) {
    const result = await identifySpeakers(recordingId);
    if (result.success && result.suggestions) suggestions = result.suggestions;
  }

  let decision = decideGate({ gateEnabled, speakers, speakerNames, suggestions, candidates });
  if (decision.reason === 'gate-off' && suggestions) {
    // Apply whatever Claude was sure about, then proceed regardless.
    const asIfGated = decideGate({ gateEnabled: true, speakers, speakerNames, suggestions, candidates });
    if (asIfGated.proceed && asIfGated.apply) decision = { ...decision, apply: asIfGated.apply };
  }
  log('info', 'Speaker gate decision', { recordingId, ...decision });

  if (decision.proceed) {
    if (decision.apply && Object.keys(decision.apply).length > 0) {
      updateManifest(recordingId, m => {
        m.speakerNames = { ...(m.speakerNames || {}), ...decision.apply };
        m.speakerNamesSource = 'claude';
      });
      // Names Claude picked from the attendee list are as good as typed ones
      // for the directory.
      const directory: string[] = getSetting('speakerDirectory') || [];
      let changed = false;
      for (const name of Object.values(decision.apply)) {
        if (!directory.includes(name)) { directory.push(name); changed = true; }
      }
      if (changed) {
        directory.sort((a, b) => a.localeCompare(b));
        setSetting('speakerDirectory', directory);
      }
    }
    return { proceed: true, reason: decision.reason };
  }

  const unnamedCount = speakers.filter(k => isUnnamed(k, speakerNames)).length;
  updateManifest(recordingId, m => {
    m.awaitingSpeakerReview = { since: new Date().toISOString(), unnamed: unnamedCount };
  });
  const title = recording.title || recording.calendarEvent?.title || 'Untitled Meeting';
  sendToRenderer('speakers:review-needed', { recordingId, title, unnamed: unnamedCount });

  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'Who was speaking?',
      body: `${title}: name ${unnamedCount} speaker${unnamedCount === 1 ? '' : 's'} to finish the notes.`,
    });
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      sendToRenderer('speakers:open-review', { recordingId });
    });
    n.show();
  }
  return { proceed: false, reason: 'needs-review' };
}

/** Drop the gate flag; generateNotes() calls this whichever button started it. */
export function clearSpeakerReview(recordingId: string): boolean {
  let had = false;
  updateManifest(recordingId, m => {
    if (m.awaitingSpeakerReview) { had = true; delete m.awaitingSpeakerReview; }
  });
  if (had) sendToRenderer('speakers:review-complete', { recordingId });
  return had;
}

/** Recordings parked behind the gate — re-seeded into the pipeline widget on launch. */
export function listAwaitingReview(): Array<{ recordingId: string; title: string; since: string }> {
  const dir = getOutputDir();
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ recordingId: string; title: string; since: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = getRecording(entry.name);
    if (m?.awaitingSpeakerReview && m.status === 'transcribed') {
      out.push({
        recordingId: m.id || entry.name,
        title: m.title || m.calendarEvent?.title || 'Untitled Meeting',
        since: m.awaitingSpeakerReview.since,
      });
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}
