import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';
import { log } from './logger';
import { getPythonPath } from './whisperx';

/**
 * WhisperX, PyTorch and pyannote are far too large (hundreds of MB of native
 * extensions) to bundle in the installer, so we install them on first run into a
 * dedicated virtualenv under the user's app-data directory. The venv lives
 * outside the .app bundle so it survives app updates.
 *
 *   ~/Library/Application Support/MeetingMind/whisperx-env/
 */

const PIP_PACKAGES = ['whisperx', 'torch', 'torchvision', 'torchaudio', 'pyannote.audio'];

export function getVenvDir(): string {
  return path.join(app.getPath('userData'), 'whisperx-env');
}

export function getVenvPython(): string {
  // python-build-standalone and venv both expose bin/python on macOS.
  return path.join(getVenvDir(), 'bin', 'python');
}

/**
 * A marker file we write once pip install completes successfully. Its presence
 * (alongside the venv python) is how we know setup finished rather than crashed
 * partway through.
 */
function getReadyMarker(): string {
  return path.join(getVenvDir(), '.whisperx-ready');
}

/** True only if the venv python exists AND the install-complete marker exists. */
export function isWhisperXReady(): boolean {
  return fs.existsSync(getVenvPython()) && fs.existsSync(getReadyMarker());
}

/** Returns a Python interpreter's "major.minor" (e.g. "3.11"), or null if it can't be run. */
function getPythonMinorVersion(pythonPath: string): string | null {
  try {
    return execFileSync(
      pythonPath,
      ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
      { encoding: 'utf-8', timeout: 10000 },
    ).trim() || null;
  } catch {
    return null;
  }
}

function run(
  command: string,
  cmdArgs: string[],
  onProgress: (message: string, pct: number) => void,
  basePct: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    log('info', `whisperx-setup: ${label}`, { command, cmdArgs });
    const proc = spawn(command, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    // Keep the tail of combined output so a non-zero exit can report *why*
    // (e.g. pip's "No matching distribution found ..."), not just the code.
    let outputTail = '';
    const forward = (data: Buffer) => {
      const text = data.toString();
      outputTail = (outputTail + text).slice(-2000);
      const line = text.trim();
      if (line) onProgress(`${label}: ${line.split('\n').pop()}`, basePct);
    };
    proc.stdout?.on('data', forward);
    proc.stderr?.on('data', forward);

    proc.on('error', (err) => reject(new Error(`${label} failed to start: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      // Surface the last few non-empty output lines as error context.
      const tail = outputTail
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-3)
        .join(' | ');
      reject(new Error(`${label} exited with code ${code}${tail ? `: ${tail}` : ''}`));
    });
  });
}

/**
 * Creates the venv with the bundled Python and pip-installs the WhisperX stack.
 * Idempotent: a no-op if setup already completed. Streams pip output via
 * onProgress so the renderer can show live status.
 */
export async function installWhisperXDeps(
  onProgress: (message: string, pct: number) => void,
): Promise<void> {
  if (isWhisperXReady()) {
    onProgress('WhisperX is already set up.', 100);
    return;
  }

  const bundledPython = getPythonPath();
  if (bundledPython !== 'python3' && !fs.existsSync(bundledPython)) {
    throw new Error(`Bundled Python interpreter not found at ${bundledPython}`);
  }

  const venvDir = getVenvDir();
  const venvPython = getVenvPython();

  // If a venv already exists but was built from a different Python version than
  // the interpreter we'd use now, it's stale (e.g. an earlier run fell back to a
  // system Python with no compatible wheels). Rebuild it rather than silently
  // reusing a broken environment.
  if (fs.existsSync(venvPython)) {
    const bundledVer = getPythonMinorVersion(bundledPython);
    const venvVer = getPythonMinorVersion(venvPython);
    if (bundledVer && venvVer && bundledVer !== venvVer) {
      log('warn', 'whisperx-setup: stale venv version mismatch, rebuilding', { venvVer, bundledVer });
      onProgress(`Rebuilding environment (found Python ${venvVer}, expected ${bundledVer})...`, 3);
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
  }

  // 1. Create the virtualenv from the bundled interpreter (skip if it exists).
  if (!fs.existsSync(venvPython)) {
    onProgress('Creating Python environment...', 5);
    await run(bundledPython, ['-m', 'venv', venvDir], onProgress, 5, 'Creating environment');
  }

  // 2. Upgrade pip so wheels resolve cleanly.
  onProgress('Upgrading pip...', 15);
  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], onProgress, 15, 'Upgrading pip');

  // 3. Install the WhisperX stack (the long step).
  onProgress('Installing WhisperX and PyTorch (this can take several minutes)...', 25);
  await run(
    venvPython,
    ['-m', 'pip', 'install', ...PIP_PACKAGES],
    onProgress,
    25,
    'Installing packages',
  );

  // 4. Mark setup complete.
  fs.writeFileSync(getReadyMarker(), new Date().toISOString());
  onProgress('WhisperX setup complete.', 100);
  log('info', 'whisperx-setup: complete', { venvDir });
}
