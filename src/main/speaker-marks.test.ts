import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanMarkName, marksToAudioTime, wavDurationMs, utteranceAt, tallyMarks, describeMarksForPrompt } from './speaker-marks';

describe('cleanMarkName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanMarkName('  Dana   Whitfield \n')).toBe('Dana Whitfield');
  });
  it('rejects empty and non-strings', () => {
    expect(cleanMarkName('   ')).toBeNull();
    expect(cleanMarkName(42)).toBeNull();
    expect(cleanMarkName(undefined)).toBeNull();
  });
  it('caps the length', () => {
    expect(cleanMarkName('x'.repeat(500))!.length).toBe(80);
  });
});

describe('marksToAudioTime', () => {
  it('leaves marks alone with a single chunk that started at zero', () => {
    const out = marksToAudioTime([{ name: 'A', atMs: 4000 }], [{ startedAtMs: 0, durationMs: 300000 }]);
    expect(out).toEqual([{ name: 'A', atMs: 4000 }]);
  });

  it('removes the gaps between chunks', () => {
    // Chunk 2 was spawned at 300.8s of recording time but chunk 1 only holds
    // 299.5s of audio: a mark 10s into chunk 2 is at 309.5s of audio, not 310.8s.
    const chunks = [
      { startedAtMs: 0, durationMs: 299500 },
      { startedAtMs: 300800, durationMs: 299400 },
      { startedAtMs: 601000, durationMs: 50000 },
    ];
    const out = marksToAudioTime(
      [{ name: 'A', atMs: 310800 }, { name: 'B', atMs: 611000 }],
      chunks,
    );
    expect(out).toEqual([
      { name: 'A', atMs: 309500 },
      { name: 'B', atMs: 299500 + 299400 + 10000 },
    ]);
  });

  it('clamps a mark into its chunk', () => {
    const chunks = [{ startedAtMs: 0, durationMs: 1000 }, { startedAtMs: 5000, durationMs: 1000 }];
    // In the dead time after chunk 1 ended (e.g. a pause), and before the first chunk started.
    expect(marksToAudioTime([{ name: 'A', atMs: 3000 }], chunks)[0].atMs).toBe(1000);
    expect(marksToAudioTime([{ name: 'A', atMs: -50 }], chunks)[0].atMs).toBe(0);
  });

  it('copies marks through with no chunk timings', () => {
    expect(marksToAudioTime([{ name: 'A', atMs: 7 }], [])).toEqual([{ name: 'A', atMs: 7 }]);
  });
});

describe('wavDurationMs', () => {
  function writeWav(seconds: number, extraHeader = 0): string {
    const sampleRate = 44100;
    const dataBytes = Math.round(seconds * sampleRate) * 2;
    const list = extraHeader ? Buffer.concat([Buffer.from('LIST'), Buffer.alloc(4), Buffer.alloc(extraHeader)]) : Buffer.alloc(0);
    if (extraHeader) list.writeUInt32LE(extraHeader, 4);
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0, 'ascii');
    fmt.writeUInt32LE(16, 4);
    fmt.writeUInt16LE(1, 8); // PCM
    fmt.writeUInt16LE(1, 10); // mono
    fmt.writeUInt32LE(sampleRate, 12);
    fmt.writeUInt32LE(sampleRate * 2, 16); // byte rate
    fmt.writeUInt16LE(2, 20);
    fmt.writeUInt16LE(16, 22);
    const dataHead = Buffer.alloc(8);
    dataHead.write('data', 0, 'ascii');
    dataHead.writeUInt32LE(dataBytes, 4);
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    riff.write('WAVE', 8, 'ascii');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-wav-')), 'chunk.wav');
    fs.writeFileSync(file, Buffer.concat([riff, fmt, list, dataHead, Buffer.alloc(dataBytes)]));
    return file;
  }

  it('reads the length of a PCM wav', () => {
    expect(wavDurationMs(writeWav(2))).toBeCloseTo(2000, 0);
  });
  it('skips over extra header chunks', () => {
    expect(wavDurationMs(writeWav(1.5, 26))).toBeCloseTo(1500, 0);
  });
  it('returns null for something that is not a wav', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-wav-')), 'x.wav');
    fs.writeFileSync(file, 'hello');
    expect(wavDurationMs(file)).toBeNull();
    expect(wavDurationMs(path.join(os.tmpdir(), 'does-not-exist.wav'))).toBeNull();
  });
});

describe('matching marks to the transcript', () => {
  const utterances = [
    { speaker: 'Speaker 1', start: 0, end: 10000 },
    { speaker: 'Speaker 2', start: 12000, end: 20000 },
    { speaker: 'Speaker 1', start: 40000, end: 50000 },
  ];

  it('picks the utterance being spoken', () => {
    expect(utteranceAt(utterances, 15000)?.speaker).toBe('Speaker 2');
  });
  it('picks a nearby utterance for a mark in a short gap', () => {
    expect(utteranceAt(utterances, 11500)?.speaker).toBe('Speaker 2');
    expect(utteranceAt(utterances, 21000)?.speaker).toBe('Speaker 2');
  });
  it('ignores a mark nowhere near anyone talking', () => {
    expect(utteranceAt(utterances, 30000)).toBeNull();
  });

  it('tallies names per speaker', () => {
    const tally = tallyMarks([
      { name: 'Dana', atMs: 13000 },
      { name: 'Dana', atMs: 19000 },
      { name: 'Noah', atMs: 45000 },
      { name: 'Dana', atMs: 2000 }, // slow tap after Dana stopped and Noah started
      { name: 'Lost', atMs: 30000 },
    ], utterances);
    expect(tally).toEqual({
      'Speaker 2': { Dana: 2 },
      'Speaker 1': { Noah: 1, Dana: 1 },
    });
  });

  it('describes nothing when there are no marks', () => {
    expect(describeMarksForPrompt([], utterances)).toBe('');
  });
  it('says so when no mark lines up', () => {
    expect(describeMarksForPrompt([{ name: 'X', atMs: 30000 }], utterances)).toContain('None of the marks lined up');
  });
});
