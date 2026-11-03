import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { getSetting } from './store';
import { getOutputDir, getRecordingStatus } from './recording-manager';
import { writeJsonAtomic } from './fs-utils';

// Retention: once a meeting is older than the setting (60 days by default),
// its audio is deleted. The transcript, notes, speakers, tags and Q&A all
// stay, so the meeting is still searchable and readable — only playback and
// re-transcription go. The transcript's word-level timings (most of its size,
// and only of use alongside the audio) go too.
//
// Only meetings that have a transcript are touched: for one that was never
// transcribed, the audio is all there is.

export const DEFAULT_RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The audio a recording folder can hold: the recording and its normalized copy. */
export function audioFilesFor(manifest: { audioPath?: string }, recordingDir: string): string[] {
  const files = new Set<string>();
  if (manifest.audioPath) {
    files.add(manifest.audioPath);
    const ext = path.extname(manifest.audioPath);
    const base = path.basename(manifest.audioPath, ext);
    files.add(path.join(path.dirname(manifest.audioPath), `${base}-normalized${ext}`));
  }
  files.add(path.join(recordingDir, 'audio.m4a'));
  files.add(path.join(recordingDir, 'audio-normalized.m4a'));
  // Never anything outside this recording's own folder.
  const root = path.resolve(recordingDir) + path.sep;
  return [...files].filter(f => path.resolve(f).startsWith(root));
}

export function isEligibleForRetention(
  manifest: { date?: string; status?: string; awaitingSpeakerReview?: boolean },
  now: number,
  days: number,
): boolean {
  if (!(days > 0)) return false;
  const t = new Date(manifest.date || '').getTime();
  if (Number.isNaN(t) || now - t <= days * DAY_MS) return false;
  // Done being worked on, with a transcript to keep.
  if (manifest.status !== 'transcribed' && manifest.status !== 'complete') return false;
  // Still waiting for the user to name speakers — they may want to listen.
  if (manifest.awaitingSpeakerReview) return false;
  return true;
}

/** The transcript without word-level timings. Utterances, text and speakers are kept. */
export function slimTranscript(transcript: any): { slim: any; changed: boolean } {
  if (!transcript || typeof transcript !== 'object') return { slim: transcript, changed: false };
  let changed = false;
  const slim = { ...transcript };
  if ('words' in slim) {
    delete slim.words;
    changed = true;
  }
  if (Array.isArray(slim.utterances)) {
    slim.utterances = slim.utterances.map((u: any) => {
      if (u && typeof u === 'object' && 'words' in u) {
        changed = true;
        const { words, ...rest } = u;
        return rest;
      }
      return u;
    });
  }
  return { slim, changed };
}

export interface RetentionResult {
  cleared: string[];
  bytesFreed: number;
}

export function getRetentionDays(): number {
  const value = getSetting('retentionDays');
  return typeof value === 'number' && value >= 0 ? value : DEFAULT_RETENTION_DAYS;
}

/** Delete the audio of every meeting past the retention window. Safe to run repeatedly. */
export function applyRetention(now = Date.now(), days = getRetentionDays()): RetentionResult {
  const result: RetentionResult = { cleared: [], bytesFreed: 0 };
  if (!(days > 0)) return result;
  // Never while recording: the disk is busy, and nothing here is urgent.
  if (getRecordingStatus().recording) return result;

  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return result;

  for (const dir of fs.readdirSync(outputDir)) {
    const recordingDir = path.join(outputDir, dir);
    const manifestPath = path.join(recordingDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!isEligibleForRetention(manifest, now, days)) continue;
      const transcriptPath = path.join(recordingDir, 'transcript.json');
      if (!fs.existsSync(transcriptPath)) continue;

      let freed = 0;
      for (const file of audioFilesFor(manifest, recordingDir)) {
        if (!fs.existsSync(file)) continue;
        freed += fs.statSync(file).size;
        fs.rmSync(file, { force: true });
      }

      const before = fs.statSync(transcriptPath).size;
      const { slim, changed } = slimTranscript(JSON.parse(fs.readFileSync(transcriptPath, 'utf-8')));
      if (changed) {
        writeJsonAtomic(transcriptPath, slim);
        freed += Math.max(0, before - fs.statSync(transcriptPath).size);
      }

      if (freed === 0 && manifest.audioRemovedAt) continue; // already done
      if (!manifest.audioRemovedAt) {
        manifest.audioRemovedAt = new Date(now).toISOString();
        writeJsonAtomic(manifestPath, manifest);
      }
      result.cleared.push(manifest.id);
      result.bytesFreed += freed;
    } catch (err) {
      log('warn', 'Retention: could not clear a recording', { dir, error: String(err) });
    }
  }

  if (result.cleared.length) {
    log('info', 'Retention: removed audio past the retention window', {
      days,
      recordings: result.cleared.length,
      mbFreed: Math.round(result.bytesFreed / 1e6),
    });
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Run shortly after launch (so startup isn't slowed), then once a day. */
export function startRetentionSchedule(): void {
  const run = () => {
    try {
      applyRetention();
    } catch (err) {
      log('error', 'Retention run failed', { error: String(err) });
    }
  };
  setTimeout(run, 30 * 1000);
  if (timer) clearInterval(timer);
  timer = setInterval(run, DAY_MS);
}
