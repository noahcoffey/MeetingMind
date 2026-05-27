import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the hermetic Python interpreter bundled with the app.
 *
 * We ship a python-build-standalone CPython 3.11 inside the app (per arch) so
 * WhisperX can run without requiring the user to install Python — mirroring the
 * way ffmpeg is bundled in recording-manager.ts.
 *
 * - Packaged: process.resourcesPath/bin/python-macos-<arch>/bin/python3
 * - Dev:      bin/python-macos-<arch>/bin/python3 if downloaded, else system python3
 */
export function getPythonArchDir(): string {
  // process.arch is 'arm64' on Apple Silicon, 'x64' on Intel.
  return process.arch === 'arm64' ? 'python-macos-arm64' : 'python-macos-x64';
}

export function getPythonPath(): string {
  const archDir = getPythonArchDir();
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    return path.join(process.resourcesPath, 'bin', archDir, 'bin', 'python3');
  }

  // In development, prefer the locally downloaded interpreter if present
  // (scripts/download-python.sh places it under bin/), else fall back to system.
  const bundled = path.join(app.getAppPath(), 'bin', archDir, 'bin', 'python3');
  if (fs.existsSync(bundled)) return bundled;
  return 'python3';
}
