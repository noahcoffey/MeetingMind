import * as fs from 'fs';

// "Who's talking" marks: while recording, the user taps an attendee's name
// when that person speaks. Each tap is stamped by main with the recording's
// elapsed time, mapped onto the merged audio's timeline when the recording
// stops, and later matched against the diarized transcript so the speaker
// pre-pass knows "Speaker 2 was talking when you tapped Dana — three times".

export interface SpeakerMark {
  name: string;
  /** Milliseconds. While recording: elapsed recording time (pauses excluded).
   *  On a saved recording: position in the merged audio. */
  atMs: number;
}

export interface ChunkTiming {
  /** Elapsed recording time (ms, pauses excluded) when the chunk's ffmpeg was spawned. */
  startedAtMs: number;
  /** How much audio the chunk actually holds. */
  durationMs: number;
}

const MAX_NAME_LENGTH = 80;

/** Trim and bound a name from the renderer — it ends up in a manifest and a Claude prompt. */
export function cleanMarkName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.slice(0, MAX_NAME_LENGTH);
}

/**
 * Wall-clock recording time and audio time drift apart: every chunk is a fresh
 * ffmpeg process, and the moments between one exiting and the next capturing
 * are not in the audio. So a mark is placed by the chunk it fell in — the audio
 * of every earlier chunk, plus how far into this one it was.
 */
export function marksToAudioTime(marks: SpeakerMark[], chunks: ChunkTiming[]): SpeakerMark[] {
  if (chunks.length === 0) return marks.map(m => ({ ...m }));
  const sorted = [...chunks].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const offsets: number[] = [];
  let total = 0;
  for (const c of sorted) { offsets.push(total); total += Math.max(0, c.durationMs); }

  return marks.map(mark => {
    let i = 0;
    while (i + 1 < sorted.length && sorted[i + 1].startedAtMs <= mark.atMs) i++;
    const into = mark.atMs - sorted[i].startedAtMs;
    const within = Math.min(Math.max(0, into), Math.max(0, sorted[i].durationMs));
    return { name: mark.name, atMs: Math.round(offsets[i] + within) };
  });
}

/** Length of a PCM WAV file's audio, from its header and size. Null if it isn't one. */
export function wavDurationMs(filePath: string): number | null {
  let fd: number | null = null;
  try {
    const size = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(Math.min(4096, size));
    fs.readSync(fd, head, 0, head.length, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;
    const fmt = head.indexOf('fmt ', 12, 'ascii');
    const data = head.indexOf('data', 12, 'ascii');
    if (fmt < 0 || data < 0 || fmt + 20 > head.length) return null;
    const byteRate = head.readUInt32LE(fmt + 16);
    if (!byteRate) return null;
    const payload = Math.max(0, size - (data + 8));
    return (payload / byteRate) * 1000;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch {}
  }
}

interface TimedUtterance { speaker: string; start: number; end: number }

/** How close (ms) a mark that fell between utterances may be to one and still count for it. */
const GAP_TOLERANCE_MS = 3000;

/** The utterance a mark points at: the one being spoken, else the nearest one close by. */
export function utteranceAt(utterances: TimedUtterance[], atMs: number): TimedUtterance | null {
  let best: TimedUtterance | null = null;
  let bestDistance = Infinity;
  for (const u of utterances) {
    if (!u.speaker) continue;
    if (atMs >= u.start && atMs <= u.end) return u;
    const distance = atMs < u.start ? u.start - atMs : atMs - u.end;
    if (distance < bestDistance) { best = u; bestDistance = distance; }
  }
  return bestDistance <= GAP_TOLERANCE_MS ? best : null;
}

/** speaker label → name → how many marks landed on that speaker. */
export type MarkTally = Record<string, Record<string, number>>;

export function tallyMarks(marks: SpeakerMark[], utterances: TimedUtterance[]): MarkTally {
  const tally: MarkTally = {};
  for (const mark of marks || []) {
    const u = utteranceAt(utterances, mark.atMs);
    if (!u) continue;
    const byName = (tally[u.speaker] ||= {});
    byName[mark.name] = (byName[mark.name] || 0) + 1;
  }
  return tally;
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The part of the identify prompt that reports the marks; empty when there are none. */
export function describeMarksForPrompt(marks: SpeakerMark[], utterances: TimedUtterance[]): string {
  if (!marks || marks.length === 0) return '';
  const tally = tallyMarks(marks, utterances);
  const lines = Object.entries(tally)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([speaker, byName]) => {
      const names = Object.entries(byName)
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name} ×${n}`)
        .join(', ');
      return `- While ${speaker} was talking: ${names}`;
    });
  const raw = marks
    .slice(0, 200)
    .map(m => `[${fmtTime(m.atMs)}] ${m.name}`)
    .join('\n');

  return `During the meeting the recorder tapped a person's name when that person was speaking. These marks are first-hand evidence from someone in the room — treat a speaker who got several marks for one name, and few for anyone else, as that person (high confidence). A mark can trail the start of speech by a few seconds, so one stray mark on another speaker is likely a slow tap, not a contradiction.
${lines.length ? `Marks matched to the transcript:\n${lines.join('\n')}` : 'None of the marks lined up with a transcript segment.'}
Marks as tapped:
${raw}`;
}
