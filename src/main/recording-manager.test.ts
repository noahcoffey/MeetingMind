import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/mm-test-userdata'),
    isPackaged: false,
    getAppPath: jest.fn(() => '/tmp/mm-test-app'),
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
  },
}));

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { getSetting } from './store';
import { listRecordings, listRecordingIndex, getRecording, deleteRecording, getRecordingStatus, isPathInsideRecordingsDir, importRecording, parseFfmpegDuration } from './recording-manager';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Stand in for ffmpeg. A transcode writes `output` to the output path (the
// last argument), prints `stderr` and exits with `code`; a length probe of the
// finished file (`-i` alone) prints `probeStderr` and exits 1, as ffmpeg does.
function fakeFfmpeg({ code = 0, stderr = '', output = 'aac-bytes', probeStderr = '' }: { code?: number; stderr?: string; output?: string; probeStderr?: string }) {
  mockSpawn.mockImplementation(((_cmd: string, args: string[]) => {
    const proc: any = new EventEmitter();
    proc.stderr = new EventEmitter();
    const isTranscode = args.includes('-c:a');
    setImmediate(() => {
      if (isTranscode && code === 0) fs.writeFileSync(args[args.length - 1], output);
      proc.stderr.emit('data', Buffer.from(isTranscode ? stderr : probeStderr));
      proc.emit('close', isTranscode ? code : 1);
    });
    return proc;
  }) as any);
}

describe('recording-manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-recmgr-test-'));
    mockGetSetting.mockReturnValue(tempDir as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createRecording(id: string, manifest: Record<string, unknown>) {
    const dir = path.join(tempDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  }

  describe('listRecordings', () => {
    test('returns empty array when no recordings exist', () => {
      expect(listRecordings()).toEqual([]);
    });

    test('returns empty array when output dir does not exist', () => {
      mockGetSetting.mockReturnValue('/nonexistent/path' as any);
      expect(listRecordings()).toEqual([]);
    });

    test('lists all recordings sorted by date descending', () => {
      createRecording('older', { id: 'older', title: 'Old', date: '2025-01-01T10:00:00Z' });
      createRecording('newer', { id: 'newer', title: 'New', date: '2025-06-01T10:00:00Z' });

      const recordings = listRecordings();
      expect(recordings).toHaveLength(2);
      expect(recordings[0].id).toBe('newer');
      expect(recordings[1].id).toBe('older');
    });

    test('skips directories without manifest', () => {
      createRecording('valid', { id: 'valid', title: 'Valid', date: '2025-01-01T10:00:00Z' });
      fs.mkdirSync(path.join(tempDir, 'empty-dir'), { recursive: true });

      const recordings = listRecordings();
      expect(recordings).toHaveLength(1);
    });

    test('skips malformed manifests', () => {
      createRecording('valid', { id: 'valid', title: 'Valid', date: '2025-01-01T10:00:00Z' });
      const badDir = path.join(tempDir, 'bad');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'manifest.json'), 'not json');

      const recordings = listRecordings();
      expect(recordings).toHaveLength(1);
    });

    describe('with a date range', () => {
      const ms = (iso: string) => new Date(iso).getTime();

      beforeEach(() => {
        createRecording('jan', { id: 'jan', title: 'Jan', date: '2025-01-10T10:00:00Z' });
        createRecording('jun', { id: 'jun', title: 'Jun', date: '2025-06-10T10:00:00Z' });
        createRecording('dec', { id: 'dec', title: 'Dec', date: '2025-12-10T10:00:00Z' });
      });

      test('returns only recordings inside the range, still newest first', () => {
        const recordings = listRecordings({
          startMs: ms('2025-01-01T00:00:00Z'),
          endMs: ms('2025-07-01T00:00:00Z'),
        });
        expect(recordings.map(r => r.id)).toEqual(['jun', 'jan']);
      });

      test('is inclusive of both bounds', () => {
        const recordings = listRecordings({
          startMs: ms('2025-06-10T10:00:00Z'),
          endMs: ms('2025-06-10T10:00:00Z'),
        });
        expect(recordings.map(r => r.id)).toEqual(['jun']);
      });

      test('returns nothing when the range holds no meetings', () => {
        const recordings = listRecordings({
          startMs: ms('2025-08-01T00:00:00Z'),
          endMs: ms('2025-09-01T00:00:00Z'),
        });
        expect(recordings).toEqual([]);
      });

      test('returns everything when no range is passed', () => {
        expect(listRecordings()).toHaveLength(3);
      });

      test('drops manifests with an unparseable date rather than including them', () => {
        createRecording('broken', { id: 'broken', title: 'Broken', date: 'not-a-date' });
        const recordings = listRecordings({
          startMs: ms('2025-01-01T00:00:00Z'),
          endMs: ms('2025-12-31T00:00:00Z'),
        });
        expect(recordings.map(r => r.id)).not.toContain('broken');
      });
    });
  });

  describe('listRecordingIndex', () => {
    test('returns an empty index when there are no recordings', () => {
      expect(listRecordingIndex()).toEqual([]);
    });

    test('projects only the fields the calendar needs', () => {
      createRecording('rec-1', {
        id: 'rec-1',
        title: 'Standup',
        date: '2025-06-10T10:00:00Z',
        notebook: 'Work',
        project: 'proj-9',
        tags: ['weekly'],
        audioPath: '/somewhere/audio.m4a',
        duration: 1800,
      });

      expect(listRecordingIndex()).toEqual([
        {
          id: 'rec-1',
          ms: new Date('2025-06-10T10:00:00Z').getTime(),
          notebook: 'Work',
          project: 'proj-9',
          tags: ['weekly'],
        },
      ]);
    });

    test('skips entries with an unparseable date', () => {
      createRecording('good', { id: 'good', title: 'Good', date: '2025-06-10T10:00:00Z' });
      createRecording('broken', { id: 'broken', title: 'Broken', date: 'not-a-date' });

      expect(listRecordingIndex().map(e => e.id)).toEqual(['good']);
    });

    test('covers every recording, unlike a windowed list', () => {
      createRecording('jan', { id: 'jan', title: 'Jan', date: '2025-01-10T10:00:00Z' });
      createRecording('dec', { id: 'dec', title: 'Dec', date: '2025-12-10T10:00:00Z' });

      expect(listRecordingIndex()).toHaveLength(2);
    });
  });

  describe('getRecording', () => {
    test('returns recording manifest by id', () => {
      createRecording('rec-1', { id: 'rec-1', title: 'My Meeting', date: '2025-01-01T10:00:00Z' });

      const rec = getRecording('rec-1');
      expect(rec).not.toBeNull();
      expect(rec.title).toBe('My Meeting');
    });

    test('returns null for nonexistent recording', () => {
      expect(getRecording('nonexistent')).toBeNull();
    });
  });

  describe('deleteRecording', () => {
    test('deletes recording directory', () => {
      createRecording('to-delete', { id: 'to-delete', title: 'Delete Me' });

      const result = deleteRecording('to-delete');
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'to-delete'))).toBe(false);
    });

    test('returns error for nonexistent recording', () => {
      const result = deleteRecording('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getRecordingStatus', () => {
    test('returns idle status when not recording', () => {
      const status = getRecordingStatus();
      expect(status.recording).toBe(false);
      expect(status.duration).toBe(0);
      expect(status.chunkCount).toBe(0);
      expect(status.isPaused).toBe(false);
    });
  });

  describe('isPathInsideRecordingsDir', () => {
    test('allows files inside the configured output dir', () => {
      expect(isPathInsideRecordingsDir(path.join(tempDir, 'rec-1', 'audio.m4a'))).toBe(true);
    });

    test('allows the output dir itself', () => {
      expect(isPathInsideRecordingsDir(tempDir)).toBe(true);
    });

    test('rejects paths outside the recordings dirs', () => {
      expect(isPathInsideRecordingsDir('/etc/passwd')).toBe(false);
    });

    test('rejects traversal that escapes the output dir', () => {
      expect(isPathInsideRecordingsDir(path.join(tempDir, '..', 'other', 'file'))).toBe(false);
      expect(isPathInsideRecordingsDir(path.join(tempDir, 'rec-1', '..', '..', '..', 'etc', 'passwd'))).toBe(false);
    });

    test('rejects sibling dirs sharing the output dir as a prefix', () => {
      expect(isPathInsideRecordingsDir(tempDir + '-evil/file')).toBe(false);
    });

    test('allows the default recordings location even when a custom dir is set', () => {
      const os = require('os');
      const defaultDir = path.join(os.homedir(), 'Documents', 'MeetingMind', 'recordings');
      expect(isPathInsideRecordingsDir(path.join(defaultDir, 'rec-1', 'audio.m4a'))).toBe(true);
    });
  });

  describe('parseFfmpegDuration', () => {
    test('reads the input banner duration', () => {
      const stderr = "Input #0, mp3, from 'memo.mp3':\n  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s\n";
      expect(parseFfmpegDuration(stderr)).toBeCloseTo(3723.5);
    });

    test('falls back to the last progress time when the banner has none', () => {
      const stderr = '  Duration: N/A, bitrate: N/A\nsize=1kB time=00:00:10.00 bitrate=1k\rsize=2kB time=00:01:05.25 bitrate=1k\n';
      expect(parseFfmpegDuration(stderr)).toBeCloseTo(65.25);
    });

    test('returns null when there is nothing to read', () => {
      expect(parseFfmpegDuration('garbage')).toBeNull();
    });
  });

  describe('importRecording', () => {
    let sourcePath: string;

    beforeEach(() => {
      mockSpawn.mockReset();
      sourcePath = path.join(os.tmpdir(), `mm-import-src-${process.pid}.mp3`);
      fs.writeFileSync(sourcePath, 'fake mp3');
    });

    afterEach(() => {
      fs.rmSync(sourcePath, { force: true });
    });

    function recordingDirs() {
      return fs.readdirSync(tempDir);
    }

    test('writes a recorded manifest marked as an import', async () => {
      fakeFfmpeg({ stderr: '  Duration: 00:45:30.80, start: 0.000000\n' });

      const result = await importRecording(sourcePath, {
        title: 'Standup',
        calendarEventId: 'evt-1',
        calendarEventProvider: 'google',
        userContext: 'Weekly sync',
        notebook: 'Work',
      });

      expect(result.success).toBe(true);
      const manifest = getRecording(result.recordingId!);
      expect(manifest).toMatchObject({
        id: result.recordingId,
        title: 'Standup',
        duration: 2730,
        fileSize: 'aac-bytes'.length,
        audioPath: path.join(tempDir, result.recordingId!, 'audio.m4a'),
        status: 'recorded',
        calendarEventId: 'evt-1',
        calendarEventProvider: 'google',
        userContext: 'Weekly sync',
        notebook: 'Work',
        speakerNames: {},
        source: 'import',
      });

      // Transcoded with the same settings as a live recording's merge.
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(expect.arrayContaining(['-i', sourcePath, '-vn', '-af', 'highpass=f=80,afftdn=nf=-25', '-c:a', 'aac', '-b:a', '64k', '-ac', '1']));
    });

    test('fails without calling ffmpeg when the file does not exist', async () => {
      const result = await importRecording(path.join(tempDir, 'missing.mp3'));
      expect(result.success).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(recordingDirs()).toEqual([]);
    });

    test('fails and leaves no folder behind when ffmpeg cannot decode the file', async () => {
      fakeFfmpeg({ code: 1, stderr: 'memo.mp3: Invalid data found when processing input\n' });
      const result = await importRecording(sourcePath);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid data found');
      expect(recordingDirs()).toEqual([]);
    });

    test('fails and leaves no folder behind when the transcode is empty', async () => {
      fakeFfmpeg({ stderr: '  Duration: 00:00:05.00\n', output: '' });
      const result = await importRecording(sourcePath);
      expect(result.success).toBe(false);
      expect(recordingDirs()).toEqual([]);
    });

    test('reads the length from the finished file when the transcode does not report it', async () => {
      fakeFfmpeg({ stderr: 'nothing useful', probeStderr: '  Duration: 00:02:00.40, start: 0.000000\n' });
      const result = await importRecording(sourcePath, { notebook: 'Work' });
      expect(result.success).toBe(true);
      expect(getRecording(result.recordingId!).duration).toBe(120);
    });

    test('keeps a converted recording whose length cannot be read at all', async () => {
      fakeFfmpeg({ stderr: 'nothing useful', probeStderr: 'nothing either' });
      const result = await importRecording(sourcePath, { notebook: 'Work' });
      expect(result.success).toBe(true);
      expect(getRecording(result.recordingId!).duration).toBe(0);
      expect(fs.existsSync(path.join(tempDir, result.recordingId!, 'audio.m4a'))).toBe(true);
    });
  });
});
