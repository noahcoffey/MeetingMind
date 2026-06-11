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
  getFFmpegPath: jest.fn(() => 'ffmpeg'),
}));

jest.mock('./whisperx-setup', () => ({
  isWhisperXReady: jest.fn(() => false),
  getVenvPython: jest.fn(() => 'python3'),
}));

jest.mock('./audio-normalizer', () => ({
  analyzeAudioLevel: jest.fn(() => Promise.reject(new Error('skipped in test'))),
  isAudioTooQuiet: jest.fn(() => false),
  normalizeAudio: jest.fn(),
}));

jest.mock('keytar', () => ({
  getPassword: jest.fn(() => Promise.resolve('test-api-key')),
}), { virtual: true });

import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { startTranscription } from './transcription';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockGetRecording = getRecording as jest.MockedFunction<typeof getRecording>;

const POLL_INTERVAL = 10000;

describe('AssemblyAI polling resume and timeout', () => {
  let tempDir: string;
  let audioPath: string;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-resume-'));
    audioPath = path.join(tempDir, 'audio.m4a');
    fs.writeFileSync(audioPath, 'fake audio data');

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'transcriptionProvider') return 'assemblyai' as any;
      if (key === 'autoNormalizeQuietAudio') return false as any;
      if (key === 'recordingOutputFolder') return tempDir as any;
      return '' as any;
    });

    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete (global as any).fetch;
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  // Drive the poll loop forward until the transcription promise settles.
  async function runToCompletion<T>(promise: Promise<T>, maxPolls = 800): Promise<T> {
    let settled = false;
    const tracked = promise.finally(() => { settled = true; });
    for (let i = 0; i < maxPolls && !settled; i++) {
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL);
    }
    return tracked;
  }

  test('resumes polling a pending transcript instead of re-uploading', async () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath,
      duration: 60,
      pendingTranscript: { provider: 'assemblyai', transcriptId: 't-pending' },
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/v2/transcript/t-pending')) {
        return jsonResponse({ status: 'completed', text: 'hello world', audio_duration: 60, utterances: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await runToCompletion(startTranscription('rec-1'));

    expect(result.success).toBe(true);
    const calledUrls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calledUrls.some(u => u.includes('/v2/upload'))).toBe(false);
    expect(calledUrls.some(u => u.includes('/v2/transcript/t-pending'))).toBe(true);
  });

  test('falls back to a fresh upload when the pending transcript is gone', async () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath,
      duration: 60,
      pendingTranscript: { provider: 'assemblyai', transcriptId: 't-stale' },
    });

    fetchMock.mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/v2/transcript/t-stale')) return jsonResponse({ error: 'not found' }, 404);
      if (url.includes('/v2/upload')) return jsonResponse({ upload_url: 'https://cdn.example/upload-1' });
      if (url.endsWith('/v2/transcript') && opts?.method === 'POST') return jsonResponse({ id: 't-fresh' });
      if (url.includes('/v2/transcript/t-fresh')) {
        return jsonResponse({ status: 'completed', text: 'fresh result', audio_duration: 60, utterances: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await runToCompletion(startTranscription('rec-1'));

    expect(result.success).toBe(true);
    const calledUrls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calledUrls.some(u => u.includes('/v2/upload'))).toBe(true);
  });

  test('gives up after the poll timeout with a resumable error', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-1', audioPath, duration: 60 });

    fetchMock.mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/v2/upload')) return jsonResponse({ upload_url: 'https://cdn.example/upload-1' });
      if (url.endsWith('/v2/transcript') && opts?.method === 'POST') return jsonResponse({ id: 't-slow' });
      if (url.includes('/v2/transcript/t-slow')) return jsonResponse({ status: 'processing' });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await runToCompletion(startTranscription('rec-1'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('retry to check on it without re-uploading');
    // Only one upload despite hours of polling
    const uploads = fetchMock.mock.calls.filter(c => (c[0] as string).includes('/v2/upload'));
    expect(uploads.length).toBe(1);
  });
});
