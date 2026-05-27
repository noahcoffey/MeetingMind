jest.mock('fs');
import * as fs from 'fs';

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/mm-userdata'),
    isPackaged: false,
    getAppPath: jest.fn(() => '/tmp/mm-app'),
  },
}));

jest.mock('./logger', () => ({ log: jest.fn() }));

jest.mock('./whisperx', () => ({
  getPythonPath: jest.fn(() => '/tmp/mm-app/bin/python-macos-arm64/bin/python3'),
}));

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

import { isWhisperXReady, installWhisperXDeps, getVenvPython, getVenvDir } from './whisperx-setup';
import { getPythonPath } from './whisperx';

const mockGetPythonPath = getPythonPath as jest.MockedFunction<typeof getPythonPath>;

describe('isWhisperXReady', () => {
  beforeEach(() => mockExistsSync.mockReset());

  test('returns false when venv python does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isWhisperXReady()).toBe(false);
  });

  test('returns false when python exists but ready marker does not', () => {
    const venvPython = getVenvPython();
    mockExistsSync.mockImplementation((p) => p === venvPython);
    expect(isWhisperXReady()).toBe(false);
  });

  test('returns true when venv python and ready marker both exist', () => {
    mockExistsSync.mockReturnValue(true);
    expect(isWhisperXReady()).toBe(true);
  });
});

describe('installWhisperXDeps', () => {
  beforeEach(() => mockExistsSync.mockReset());

  test('rejects when the bundled Python binary is not found', async () => {
    mockGetPythonPath.mockReturnValue('/nonexistent/python3');
    // Not ready (so it proceeds past the idempotency check), and the bundled
    // interpreter path does not exist.
    mockExistsSync.mockReturnValue(false);

    await expect(installWhisperXDeps(() => {})).rejects.toThrow(/Bundled Python interpreter not found/);
  });

  test('is a no-op when already set up', async () => {
    mockExistsSync.mockReturnValue(true); // ready marker + python present
    const onProgress = jest.fn();
    await installWhisperXDeps(onProgress);
    expect(onProgress).toHaveBeenCalledWith('WhisperX is already set up.', 100);
  });
});

describe('venv paths', () => {
  test('venv dir is under userData', () => {
    expect(getVenvDir()).toContain('whisperx-env');
  });
  test('venv python is inside the venv dir', () => {
    expect(getVenvPython()).toContain('whisperx-env');
    expect(getVenvPython()).toContain('python');
  });
});
