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

import { getSetting } from './store';
import { listRecordings, getRecording, deleteRecording, getRecordingStatus } from './recording-manager';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;

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
});
