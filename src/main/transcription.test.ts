import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/mm-userdata'),
    getAppPath: jest.fn(() => '/tmp/mm-app'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
  },
}));

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

jest.mock('./whisperx-setup', () => ({
  isWhisperXReady: jest.fn(() => false),
  getVenvPython: jest.fn(() => '/tmp/mm-userdata/whisperx-env/bin/python'),
}));

import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { isWhisperXReady } from './whisperx-setup';
import { startTranscription, getTranscriptionStatus } from './transcription';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockGetRecording = getRecording as jest.MockedFunction<typeof getRecording>;
const mockIsWhisperXReady = isWhisperXReady as jest.MockedFunction<typeof isWhisperXReady>;

describe('startTranscription', () => {
  test('returns error when recording not found', async () => {
    mockGetRecording.mockReturnValue(null);
    const result = await startTranscription('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when audio file missing', async () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: '/tmp/nonexistent-audio-file.m4a',
      duration: 60,
    });

    const result = await startTranscription('rec-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Audio file not found');
  });

  test('defaults to assemblyai provider when setting is empty', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'transcriptionProvider') return '' as any;
      return '' as any;
    });

    // Will fail at API key step, but we can verify it tried assemblyai
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-trans-'));
    const audioPath = path.join(tempDir, 'audio.m4a');
    fs.writeFileSync(audioPath, 'fake audio data');

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath,
      duration: 60,
    });

    // Mock keytar to return null (no key configured)
    jest.mock('keytar', () => ({
      getPassword: jest.fn(() => Promise.resolve(null)),
    }), { virtual: true });

    const result = await startTranscription('rec-1');
    expect(result.success).toBe(false);
    // Should fail with API key error for assemblyai
    expect(result.error).toContain('API key');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('whisperx-local returns a WhisperX-specific error when not set up', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'transcriptionProvider') return 'whisperx-local' as any;
      if (key === 'autoNormalizeQuietAudio') return false as any;
      return '' as any;
    });
    mockIsWhisperXReady.mockReturnValue(false);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-wx-'));
    const audioPath = path.join(tempDir, 'audio.m4a');
    fs.writeFileSync(audioPath, 'fake audio data');

    mockGetRecording.mockReturnValue({ id: 'rec-1', audioPath, duration: 60 });

    const result = await startTranscription('rec-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('WhisperX');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('getTranscriptionStatus', () => {
  test('returns unknown for nonexistent recording', () => {
    mockGetRecording.mockReturnValue(null);
    const status = getTranscriptionStatus('nonexistent');
    expect(status.status).toBe('unknown');
  });

  test('returns recording status', () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      status: 'transcribed',
    });

    const status = getTranscriptionStatus('rec-1');
    expect(status.status).toBe('transcribed');
  });

  test('returns transcribing status', () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      status: 'transcribing',
    });

    const status = getTranscriptionStatus('rec-1');
    expect(status.status).toBe('transcribing');
  });
});
