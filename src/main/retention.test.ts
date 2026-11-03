import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('./logger', () => ({ log: jest.fn() }));
jest.mock('./store', () => ({ getSetting: jest.fn() }));

let outputDir = '';
let recording = false;
jest.mock('./recording-manager', () => ({
  getOutputDir: () => outputDir,
  getRecordingStatus: () => ({ recording }),
}));

import { isEligibleForRetention, slimTranscript, applyRetention, audioFilesFor } from './retention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-02T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe('isEligibleForRetention', () => {
  test('a finished meeting older than the window', () => {
    expect(isEligibleForRetention({ date: daysAgo(61), status: 'complete' }, NOW, 60)).toBe(true);
    expect(isEligibleForRetention({ date: daysAgo(61), status: 'transcribed' }, NOW, 60)).toBe(true);
  });

  test('not inside the window', () => {
    expect(isEligibleForRetention({ date: daysAgo(59), status: 'complete' }, NOW, 60)).toBe(false);
  });

  test('never one without a transcript, or one still being worked on', () => {
    for (const status of ['recorded', 'transcribing', 'generating', undefined]) {
      expect(isEligibleForRetention({ date: daysAgo(400), status }, NOW, 60)).toBe(false);
    }
  });

  test('never one waiting for speaker names', () => {
    expect(isEligibleForRetention({ date: daysAgo(400), status: 'transcribed', awaitingSpeakerReview: true }, NOW, 60)).toBe(false);
  });

  test('0 days means keep forever; a bad date is left alone', () => {
    expect(isEligibleForRetention({ date: daysAgo(4000), status: 'complete' }, NOW, 0)).toBe(false);
    expect(isEligibleForRetention({ date: 'not a date', status: 'complete' }, NOW, 60)).toBe(false);
  });
});

describe('slimTranscript', () => {
  test('drops word timings, keeps text, speakers and utterance times', () => {
    const t = {
      text: 'hi there', words: [{ text: 'hi' }],
      utterances: [{ speaker: 'A', text: 'hi there', start: 0, end: 900, words: [{ text: 'hi' }] }],
    };
    const { slim, changed } = slimTranscript(t);
    expect(changed).toBe(true);
    expect(slim).toEqual({ text: 'hi there', utterances: [{ speaker: 'A', text: 'hi there', start: 0, end: 900 }] });
  });

  test('a slim transcript is unchanged', () => {
    expect(slimTranscript({ text: 'x', utterances: [{ speaker: 'A', text: 'x' }] }).changed).toBe(false);
  });
});

describe('audioFilesFor', () => {
  test('never points outside the recording folder', () => {
    const files = audioFilesFor({ audioPath: '/etc/passwd' }, '/r/abc');
    expect(files.every(f => f.startsWith('/r/abc/'))).toBe(true);
  });
});

describe('applyRetention', () => {
  function makeRecording(id: string, manifest: Record<string, unknown>, withTranscript = true) {
    const dir = path.join(outputDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const audioPath = path.join(dir, 'audio.m4a');
    fs.writeFileSync(audioPath, Buffer.alloc(1000));
    fs.writeFileSync(path.join(dir, 'audio-normalized.m4a'), Buffer.alloc(500));
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes');
    if (withTranscript) {
      fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify({ text: 'x', words: [{ t: 1 }], utterances: [{ speaker: 'A', text: 'x', words: [{ t: 1 }] }] }));
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, audioPath, ...manifest }));
    return dir;
  }

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-retention-'));
    recording = false;
  });
  afterEach(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  test('removes old audio, keeps notes and transcript text, marks the manifest', () => {
    const dir = makeRecording('old', { date: daysAgo(90), status: 'complete' });
    const result = applyRetention(NOW, 60);
    expect(result.cleared).toEqual(['old']);
    expect(result.bytesFreed).toBeGreaterThanOrEqual(1500);
    expect(fs.existsSync(path.join(dir, 'audio.m4a'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'audio-normalized.m4a'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'notes.md'), 'utf-8')).toBe('# Notes');
    const transcript = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf-8'));
    expect(transcript.words).toBeUndefined();
    expect(transcript.utterances[0].text).toBe('x');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
    expect(manifest.audioRemovedAt).toBe(new Date(NOW).toISOString());
    expect(manifest.audioPath).toBe(path.join(dir, 'audio.m4a')); // other code finds the folder through it
  });

  test('leaves recent, untranscribed and in-review meetings alone', () => {
    const recent = makeRecording('recent', { date: daysAgo(10), status: 'complete' });
    const untranscribed = makeRecording('untranscribed', { date: daysAgo(90), status: 'recorded' }, false);
    const review = makeRecording('review', { date: daysAgo(90), status: 'transcribed', awaitingSpeakerReview: true });
    expect(applyRetention(NOW, 60).cleared).toEqual([]);
    for (const dir of [recent, untranscribed, review]) {
      expect(fs.existsSync(path.join(dir, 'audio.m4a'))).toBe(true);
    }
  });

  test('does nothing while a recording is running, or when set to keep forever', () => {
    makeRecording('old', { date: daysAgo(90), status: 'complete' });
    recording = true;
    expect(applyRetention(NOW, 60).cleared).toEqual([]);
    recording = false;
    expect(applyRetention(NOW, 0).cleared).toEqual([]);
  });

  test('a second run finds nothing more to do', () => {
    makeRecording('old', { date: daysAgo(90), status: 'complete' });
    expect(applyRetention(NOW, 60).cleared).toEqual(['old']);
    expect(applyRetention(NOW, 60)).toEqual({ cleared: [], bytesFreed: 0 });
  });
});
