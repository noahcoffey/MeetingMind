jest.mock('fs');
import * as fs from 'fs';

// Fake subprocesses: spawn() returns an emitter that closes successfully;
// execFileSync() is controlled per-test to report Python versions.
jest.mock('child_process', () => {
  const { EventEmitter } = require('events');
  return {
    execFileSync: jest.fn(),
    spawn: jest.fn(() => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit('close', 0));
      return proc;
    }),
  };
});
import { execFileSync } from 'child_process';

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
const mockRmSync = fs.rmSync as jest.MockedFunction<typeof fs.rmSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

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

  test('rebuilds a stale venv whose Python version differs from the bundled interpreter', async () => {
    mockGetPythonPath.mockReturnValue('/tmp/mm-app/bin/python-macos-arm64/bin/python3');
    mockRmSync.mockReset();
    mockExecFileSync.mockReset();
    // Bundled python + venv python both exist; the ready marker does not (so it
    // isn't considered "ready" and proceeds into setup).
    mockExistsSync.mockImplementation((p: any) => !String(p).includes('.whisperx-ready'));
    // venv was built from 3.14, bundled interpreter is 3.11 → mismatch.
    mockExecFileSync.mockImplementation((py: any) =>
      (String(py).includes('whisperx-env') ? '3.14\n' : '3.11\n') as any,
    );

    const onProgress = jest.fn();
    await installWhisperXDeps(onProgress);

    expect(mockRmSync).toHaveBeenCalledWith(getVenvDir(), { recursive: true, force: true });
    expect(onProgress).toHaveBeenCalledWith('WhisperX setup complete.', 100);
  });

  test('does not rebuild when venv Python matches the bundled interpreter', async () => {
    mockGetPythonPath.mockReturnValue('/tmp/mm-app/bin/python-macos-arm64/bin/python3');
    mockRmSync.mockReset();
    mockExecFileSync.mockReset();
    mockExistsSync.mockImplementation((p: any) => !String(p).includes('.whisperx-ready'));
    mockExecFileSync.mockReturnValue('3.11\n' as any); // both report 3.11

    await installWhisperXDeps(jest.fn());

    expect(mockRmSync).not.toHaveBeenCalled();
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
