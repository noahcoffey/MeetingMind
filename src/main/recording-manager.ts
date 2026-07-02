import { app, BrowserWindow, powerSaveBlocker } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { log } from './logger';
import { getSetting } from './store';
import { writeJsonAtomic } from './fs-utils';
import { checkCrashRecovery, RecoverableSession } from './recorder';
import { spawn, ChildProcess } from 'child_process';

const CHUNK_DURATION_SEC = 300; // 5 minutes
const MANIFEST_INTERVAL_MS = 30000; // 30 seconds
const DISK_CHECK_INTERVAL_MS = 60000; // 60 seconds
const DISK_WARNING_THRESHOLD = 500 * 1024 * 1024; // 500 MB
const DISK_CRITICAL_THRESHOLD = 100 * 1024 * 1024; // 100 MB

interface ActiveRecording {
  sessionId: string;
  tempDir: string;
  startTime: number;
  chunkIndex: number;
  chunks: string[];
  inputDevice: string;
  systemAudioDevice: string;
  ffmpegProcess: ChildProcess | null;
  manifestInterval: ReturnType<typeof setInterval> | null;
  diskCheckInterval: ReturnType<typeof setInterval> | null;
  isPaused: boolean;
  pausedAt: number;          // timestamp when paused, 0 if not paused
  totalPausedMs: number;     // accumulated paused milliseconds
  silenceWarned: boolean;    // true once we've warned the user the capture is silent
  calendarEventId?: string;
  calendarEventProvider?: string;
  userContext?: string;
  title?: string;
  notebook?: string;
}

let activeRecording: ActiveRecording | null = null;
let powerSaveBlockerId: number | null = null;

function releasePowerSaveBlocker(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    log('info', `Power save blocker released (id: ${powerSaveBlockerId})`);
  }
  powerSaveBlockerId = null;
}

function getTempDir(): string {
  return path.join(app.getPath('userData'), 'recordings', 'temp');
}

export function getFFmpegPath(): string {
  // In packaged app, ffmpeg is in resources/bin
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'ffmpeg');
  }
  // In development, try system ffmpeg or bundled
  const bundled = path.join(app.getAppPath(), 'bin', 'ffmpeg');
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg'; // Fall back to system PATH
}

export function getOutputDir(): string {
  const customDir = getSetting('recordingOutputFolder');
  return customDir || path.join(os.homedir(), 'Documents', 'MeetingMind', 'recordings');
}

// True if the (resolved) path lives inside a recordings directory — the
// configured output folder or the default location. Used to constrain
// renderer-supplied paths (media:// playback, reveal-in-Finder).
export function isPathInsideRecordingsDir(filePath: string): boolean {
  const roots = new Set([
    path.resolve(getOutputDir()),
    path.resolve(os.homedir(), 'Documents', 'MeetingMind', 'recordings'),
  ]);
  const resolved = path.resolve(filePath);
  for (const root of roots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

export function startRecording(deviceId: string, systemAudioDeviceId?: string, calendarEventId?: string, userContext?: string, title?: string, notebook?: string, calendarEventProvider?: string): { success: boolean; sessionId?: string; error?: string } {
  if (activeRecording) {
    return { success: false, error: 'Recording already in progress' };
  }

  const sessionId = crypto.randomUUID();
  const tempDir = path.join(getTempDir(), sessionId);
  fs.mkdirSync(tempDir, { recursive: true });

  activeRecording = {
    sessionId,
    tempDir,
    startTime: Date.now(),
    chunkIndex: 0,
    chunks: [],
    inputDevice: deviceId,
    systemAudioDevice: systemAudioDeviceId || '',
    ffmpegProcess: null,
    manifestInterval: null,
    diskCheckInterval: null,
    isPaused: false,
    pausedAt: 0,
    totalPausedMs: 0,
    silenceWarned: false,
    calendarEventId,
    calendarEventProvider,
    userContext,
    title,
    notebook,
  };

  log('info', `Starting recording session ${sessionId}`, { deviceId });

  // Prevent system sleep during recording
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  log('info', `Power save blocker started (id: ${powerSaveBlockerId})`);

  // Start first chunk
  startChunk();

  // Start manifest writing
  if (activeRecording) {
    activeRecording.manifestInterval = setInterval(() => {
      writeManifest();
    }, MANIFEST_INTERVAL_MS);
  }

  // Start disk space monitoring
  if (activeRecording) {
    activeRecording.diskCheckInterval = setInterval(() => {
      checkDiskSpace();
    }, DISK_CHECK_INTERVAL_MS);
  }

  return { success: true, sessionId };
}

function startChunk(): void {
  if (!activeRecording) return;

  const chunkName = `chunk-${String(activeRecording.chunkIndex + 1).padStart(3, '0')}.wav`;
  const chunkPath = path.join(activeRecording.tempDir, chunkName);
  const ffmpegPath = getFFmpegPath();

  // Build ffmpeg command to record from input device.
  // On macOS, use avfoundation to capture audio — addressed by device *name*,
  // not numeric index. avfoundation indices are NOT stable: a virtual device
  // (e.g. ZoomAudioDevice) can take index 0 and silently hijack what used to be
  // the mic, so "record from index 0" would capture an hour of digital silence.
  // ":default" lets avfoundation resolve the true OS default input device.
  const micDeviceId = activeRecording.inputDevice === 'default' ? 'default' : activeRecording.inputDevice;
  const systemDeviceId = activeRecording.systemAudioDevice;

  let args: string[];
  if (systemDeviceId) {
    // Dual-input ffmpeg for mic + system audio
    args = [
      '-f', 'avfoundation',
      '-i', `:${micDeviceId}`,
      '-f', 'avfoundation',
      '-i', `:${systemDeviceId}`,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest',
      '-ac', '1',
      '-ar', '44100',
      '-t', String(CHUNK_DURATION_SEC),
      '-y',
      chunkPath,
    ];
  } else {
    // Single-input (mic only)
    args = [
      '-f', 'avfoundation',
      '-i', `:${micDeviceId}`,
      '-ac', '1',           // mono
      '-ar', '44100',       // 44.1kHz
      '-t', String(CHUNK_DURATION_SEC), // chunk duration
      '-y',                 // overwrite
      chunkPath,
    ];
  }

  log('info', `Starting chunk ${chunkName}`, { args });

  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  activeRecording.ffmpegProcess = proc;

  proc.stderr?.on('data', (data: Buffer) => {
    const str = data.toString();
    // Parse audio level from ffmpeg output for the meter
    const levelMatch = str.match(/size=\s*\d+/);
    if (levelMatch) {
      // Send level update to renderer
      sendToRenderer('recording:level', Math.random() * 0.5 + 0.1); // placeholder
    }
  });

  proc.on('close', (code) => {
    if (!activeRecording) return;

    if (code === 0 || code === 255) {
      // Chunk complete (255 = killed, which is normal for stop)
      const chunkSaved = fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0;
      if (chunkSaved) {
        activeRecording.chunks.push(chunkName);
        sendToRenderer('recording:chunk', activeRecording.chunks.length);
        writeManifest();
        log('info', `Chunk ${chunkName} saved`, { size: fs.statSync(chunkPath).size });
        // A chunk can be a valid file full of digital silence (the device is
        // delivering zeros, e.g. a virtual/muted input). The "no data" guard
        // below won't catch that, so measure the level and warn the user.
        checkChunkForSilence(path.join(activeRecording.tempDir, chunkName));
      }

      // A "successful" chunk that produced no audio means the device isn't
      // delivering anything — stop instead of silently looping forever.
      if (code === 0 && !chunkSaved && !activeRecording.isPaused) {
        activeRecording.ffmpegProcess = null;
        failRecording('Audio capture produced no data — check that the selected input device is available.');
        return;
      }

      // If we're still recording and this was a natural end (not a stop), start next chunk
      if (activeRecording && !activeRecording.isPaused && code === 0) {
        activeRecording.chunkIndex++;
        startChunk();
      }
    } else if (!activeRecording.isPaused) {
      // Genuine failure mid-recording (bad device, permissions, etc.) —
      // surface it instead of leaving the UI "recording" silence.
      log('error', `ffmpeg chunk recording failed with code ${code}`);
      activeRecording.ffmpegProcess = null;
      failRecording(`Audio capture failed (ffmpeg exit code ${code}).`);
    } else {
      log('error', `ffmpeg chunk recording failed with code ${code} (while paused/stopping)`);
    }
  });

  proc.on('error', (err) => {
    log('error', 'ffmpeg process error', err);
    if (activeRecording && activeRecording.ffmpegProcess === proc) {
      activeRecording.ffmpegProcess = null;
      failRecording(`Could not start audio capture: ${err.message}`);
    }
  });
}

// Recording can no longer continue. Salvage what was captured: merge any
// completed chunks into a normal recording so the user keeps the audio so far,
// then tell the renderer why recording ended.
async function failRecording(message: string): Promise<void> {
  if (!activeRecording) return;
  const recording = activeRecording;

  if (recording.chunks.length > 0) {
    const result = await stopRecording();
    sendToRenderer('recording:error', {
      message: `${message} The audio captured so far was saved.`,
      recordingId: result.recordingId,
    });
  } else {
    if (recording.manifestInterval) clearInterval(recording.manifestInterval);
    if (recording.diskCheckInterval) clearInterval(recording.diskCheckInterval);
    releasePowerSaveBlocker();
    try { fs.rmSync(recording.tempDir, { recursive: true, force: true }); } catch {}
    activeRecording = null;
    sendToRenderer('recording:error', { message });
  }
}

function writeManifest(): void {
  if (!activeRecording) return;

  const manifest = {
    sessionId: activeRecording.sessionId,
    startTime: new Date(activeRecording.startTime).toISOString(),
    currentDuration: Math.floor((Date.now() - activeRecording.startTime) / 1000),
    chunks: activeRecording.chunks,
    inputDevice: activeRecording.inputDevice,
    title: activeRecording.title,
    calendarEventId: activeRecording.calendarEventId,
    calendarEventProvider: activeRecording.calendarEventProvider,
    userContext: activeRecording.userContext,
    notebook: activeRecording.notebook,
  };

  const manifestPath = path.join(activeRecording.tempDir, 'recording-manifest.json');
  try {
    writeJsonAtomic(manifestPath, manifest);
  } catch (err) {
    log('warn', 'Failed to write recording manifest', err);
  }
}

function checkDiskSpace(): void {
  if (!activeRecording) return;

  try {
    // Use df to check available disk space
    const { execSync } = require('child_process');
    const output = execSync(`df -k "${activeRecording.tempDir}" | tail -1`).toString();
    const parts = output.trim().split(/\s+/);
    const availableKB = parseInt(parts[3], 10);
    const availableBytes = availableKB * 1024;

    if (availableBytes < DISK_CRITICAL_THRESHOLD) {
      log('warn', 'Disk space critically low, pausing recording');
      sendToRenderer('recording:disk-warning', 'critical');
      pauseRecording();
    } else if (availableBytes < DISK_WARNING_THRESHOLD) {
      log('warn', 'Disk space low', { availableBytes });
      sendToRenderer('recording:disk-warning', 'warning');
    }
  } catch (err) {
    log('error', 'Failed to check disk space', err);
  }
}

export function pauseRecording(): { success: boolean; error?: string } {
  if (!activeRecording) return { success: false, error: 'No recording in progress' };
  if (activeRecording.isPaused) return { success: false, error: 'Already paused' };

  activeRecording.isPaused = true;
  activeRecording.pausedAt = Date.now();

  // Kill current ffmpeg chunk — it will be saved via the close handler
  if (activeRecording.ffmpegProcess) {
    activeRecording.ffmpegProcess.kill('SIGTERM');
  }

  log('info', 'Recording paused');
  sendToRenderer('recording:paused', true);
  return { success: true };
}

export function resumeRecording(): { success: boolean; error?: string } {
  if (!activeRecording) return { success: false, error: 'No recording in progress' };
  if (!activeRecording.isPaused) return { success: false, error: 'Not paused' };

  // Accumulate paused duration
  if (activeRecording.pausedAt > 0) {
    activeRecording.totalPausedMs += Date.now() - activeRecording.pausedAt;
    activeRecording.pausedAt = 0;
  }

  activeRecording.isPaused = false;

  // Start a new chunk
  activeRecording.chunkIndex++;
  startChunk();

  log('info', 'Recording resumed');
  sendToRenderer('recording:paused', false);
  return { success: true };
}

export async function cancelRecording(): Promise<{ success: boolean; error?: string }> {
  if (!activeRecording) {
    return { success: false, error: 'No recording in progress' };
  }

  const recording = activeRecording;
  recording.isPaused = true; // Prevent new chunks from starting

  // Stop ffmpeg
  if (recording.ffmpegProcess) {
    recording.ffmpegProcess.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (recording.ffmpegProcess) {
        recording.ffmpegProcess.on('close', () => resolve());
        setTimeout(resolve, 3000);
      } else {
        resolve();
      }
    });
  }

  // Stop intervals
  if (recording.manifestInterval) clearInterval(recording.manifestInterval);
  if (recording.diskCheckInterval) clearInterval(recording.diskCheckInterval);

  // Clean up all temp files without saving
  for (const chunk of recording.chunks) {
    const chunkPath = path.join(recording.tempDir, chunk);
    if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
  }
  const tempManifest = path.join(recording.tempDir, 'recording-manifest.json');
  if (fs.existsSync(tempManifest)) fs.unlinkSync(tempManifest);
  try { fs.rmdirSync(recording.tempDir); } catch {}

  releasePowerSaveBlocker();
  log('info', `Recording ${recording.sessionId} cancelled and discarded`);
  activeRecording = null;
  return { success: true };
}

export async function stopRecording(): Promise<{ success: boolean; recordingId?: string; error?: string }> {
  if (!activeRecording) {
    return { success: false, error: 'No recording in progress' };
  }

  const recording = activeRecording;
  recording.isPaused = true; // Prevent new chunks from starting

  // Stop ffmpeg
  if (recording.ffmpegProcess) {
    recording.ffmpegProcess.kill('SIGTERM');
    // Wait for process to exit
    await new Promise<void>(resolve => {
      if (recording.ffmpegProcess) {
        recording.ffmpegProcess.on('close', () => resolve());
        setTimeout(resolve, 3000); // Timeout
      } else {
        resolve();
      }
    });
  }

  // Stop intervals
  if (recording.manifestInterval) clearInterval(recording.manifestInterval);
  if (recording.diskCheckInterval) clearInterval(recording.diskCheckInterval);
  releasePowerSaveBlocker();

  // Write final manifest
  writeManifest();

  // Merge chunks
  const recordingId = crypto.randomUUID();
  const outputDir = path.join(getOutputDir(), recordingId);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'audio.m4a');

  try {
    await mergeChunks(recording.tempDir, recording.chunks, outputPath);

    // Verify merged file
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      throw new Error('Merged file is empty');
    }

    // Write recording manifest (subtract paused time)
    const totalElapsed = Date.now() - recording.startTime;
    const duration = Math.floor((totalElapsed - recording.totalPausedMs) / 1000);
    const manifest = {
      id: recordingId,
      title: recording.title || '',
      date: new Date(recording.startTime).toISOString(),
      duration,
      fileSize: stats.size,
      audioPath: outputPath,
      status: 'recorded' as const,
      calendarEventId: recording.calendarEventId,
      calendarEventProvider: recording.calendarEventProvider,
      userContext: recording.userContext,
      notebook: recording.notebook || getSetting('activeNotebook') || 'Personal',
      speakerNames: {},
    };

    writeJsonAtomic(path.join(outputDir, 'manifest.json'), manifest);

    // Clean up temp files
    for (const chunk of recording.chunks) {
      const chunkPath = path.join(recording.tempDir, chunk);
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    }
    const tempManifest = path.join(recording.tempDir, 'recording-manifest.json');
    if (fs.existsSync(tempManifest)) fs.unlinkSync(tempManifest);
    try { fs.rmdirSync(recording.tempDir); } catch {}

    log('info', `Recording saved: ${recordingId}`, { duration, fileSize: stats.size });

    activeRecording = null;
    return { success: true, recordingId };
  } catch (err) {
    log('error', 'Failed to merge recording', err);
    activeRecording = null;
    return { success: false, error: `Merge failed: ${err}` };
  }
}

async function mergeChunks(tempDir: string, chunks: string[], outputPath: string): Promise<void> {
  const ffmpegPath = getFFmpegPath();

  if (chunks.length === 0) {
    throw new Error('No chunks to merge');
  }

  if (chunks.length === 1) {
    // Single chunk — just convert directly
    const inputPath = path.join(tempDir, chunks[0]);
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', inputPath,
        '-af', 'highpass=f=80,afftdn=nf=-25',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-ac', '1',
        '-y',
        outputPath,
      ]);

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  // Multiple chunks — create concat file and merge
  const concatFile = path.join(tempDir, 'concat.txt');
  const concatContent = chunks
    .map(c => `file '${path.join(tempDir, c)}'`)
    .join('\n');
  fs.writeFileSync(concatFile, concatContent);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-af', 'highpass=f=80,afftdn=nf=-25',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-ac', '1',
      '-y',
      outputPath,
    ]);

    proc.on('close', (code) => {
      // Clean up concat file
      try { fs.unlinkSync(concatFile); } catch {}
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg merge exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// --- Crash recovery ---
// Salvage chunk files left behind by a crash: validate each chunk, merge the
// good ones into a normal recording, and clean up the temp session dir.

// Decode-check a chunk with ffmpeg. A chunk that was being written when the
// app died can be truncated or corrupt; feeding it to the concat merge would
// fail the whole merge, so corrupt chunks are skipped instead.
function isChunkDecodable(chunkPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(getFFmpegPath(), ['-v', 'error', '-i', chunkPath, '-f', 'null', '-']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function recoverCrashedSessions(): Promise<string[]> {
  const sessions = await checkCrashRecovery();
  const recovered: string[] = [];
  for (const session of sessions) {
    try {
      const recordingId = await recoverSession(session);
      if (recordingId) recovered.push(recordingId);
    } catch (err) {
      log('error', `Failed to recover session ${session.sessionId}`, err);
    }
  }
  return recovered;
}

async function recoverSession(session: RecoverableSession): Promise<string | null> {
  const { manifest, tempDir } = session;

  const validChunks: string[] = [];
  for (const chunk of manifest.chunks) {
    if (await isChunkDecodable(path.join(tempDir, chunk))) {
      validChunks.push(chunk);
    } else {
      log('warn', `Skipping corrupt chunk ${chunk} in session ${session.sessionId}`);
    }
  }

  if (validChunks.length === 0) {
    // Nothing decodable — the leftover files are unusable, so clear them out
    // rather than re-attempting recovery on every launch.
    log('warn', `Session ${session.sessionId} had no recoverable audio; discarding temp files`);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    return null;
  }

  const recordingId = crypto.randomUUID();
  const outputDir = path.join(getOutputDir(), recordingId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'audio.m4a');

  try {
    await mergeChunks(tempDir, validChunks, outputPath);
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Recovered audio file is empty');

    writeJsonAtomic(path.join(outputDir, 'manifest.json'), {
      id: recordingId,
      title: manifest.title ? `${manifest.title} (recovered)` : 'Recovered recording',
      date: manifest.startTime || new Date().toISOString(),
      duration: manifest.currentDuration || 0,
      fileSize: stats.size,
      audioPath: outputPath,
      status: 'recorded' as const,
      calendarEventId: manifest.calendarEventId,
      calendarEventProvider: manifest.calendarEventProvider,
      userContext: manifest.userContext,
      notebook: manifest.notebook || getSetting('activeNotebook') || 'Personal',
      speakerNames: {},
      recovered: true,
    });
  } catch (err) {
    // Keep the temp chunks so a fix or manual merge is still possible.
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
    throw err;
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  log('info', `Recovered crashed session ${session.sessionId} as recording ${recordingId}`, {
    chunks: validChunks.length,
    skipped: manifest.chunks.length - validChunks.length,
  });
  return recordingId;
}

function getElapsedMs(): number {
  if (!activeRecording) return 0;
  const now = Date.now();
  const totalElapsed = now - activeRecording.startTime;
  const currentPause = activeRecording.isPaused && activeRecording.pausedAt > 0
    ? now - activeRecording.pausedAt
    : 0;
  return totalElapsed - activeRecording.totalPausedMs - currentPause;
}

export function getRecordingStatus(): { recording: boolean; duration: number; chunkCount: number; isPaused: boolean } {
  if (!activeRecording) {
    return { recording: false, duration: 0, chunkCount: 0, isPaused: false };
  }

  return {
    recording: true,
    duration: Math.floor(getElapsedMs() / 1000),
    chunkCount: activeRecording.chunks.length,
    isPaused: activeRecording.isPaused,
  };
}

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

// A real microphone always has a noise floor (~-60 dB here). A device that is
// delivering nothing — wrong/virtual input, or muted hardware — reads as pure
// digital silence (~-91 dB). Anything at or below this threshold means "no
// signal", not merely "quiet room", so it's safe to warn without false alarms.
const SILENCE_DB_THRESHOLD = -85;

// Measure a finished chunk's mean volume and, the first time a recording looks
// silent, warn the renderer. Runs async/non-blocking; never interrupts capture.
function checkChunkForSilence(chunkPath: string): void {
  if (!activeRecording || activeRecording.silenceWarned) return;
  const sessionId = activeRecording.sessionId;

  let stderr = '';
  const proc = spawn(getFFmpegPath(), ['-v', 'error', '-i', chunkPath, '-af', 'volumedetect', '-f', 'null', '-'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  proc.on('error', (err) => log('warn', 'Silence check failed to run', err));
  proc.on('close', () => {
    // Recording may have stopped or already been warned while we measured.
    if (!activeRecording || activeRecording.sessionId !== sessionId || activeRecording.silenceWarned) return;
    const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    if (!match) return;
    const meanDb = parseFloat(match[1]);
    if (meanDb <= SILENCE_DB_THRESHOLD) {
      activeRecording.silenceWarned = true;
      const device = activeRecording.inputDevice === 'default' ? 'the default microphone' : `"${activeRecording.inputDevice}"`;
      log('warn', 'Silent audio detected during recording', { meanDb, device: activeRecording.inputDevice });
      sendToRenderer(
        'recording:audio-warning',
        `No audio is being captured from ${device}. The recording so far is silent — check that the right input device is selected and not muted.`,
      );
    }
  });
}

// Test system audio device — captures a few seconds via ffmpeg and returns peak level
export function testSystemAudio(deviceId: string, durationSec: number = 4): Promise<{ success: boolean; peakLevel?: number; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  // Address the device by name; ":default" resolves the true OS default input.
  // (avfoundation indices are unstable — see startChunk for the full rationale.)
  const devId = deviceId === 'default' ? 'default' : deviceId;

  return new Promise((resolve) => {
    // Use volumedetect filter to measure audio levels
    const args = [
      '-f', 'avfoundation',
      '-i', `:${devId}`,
      '-t', String(durationSec),
      '-af', 'volumedetect',
      '-f', 'null',
      '-',
    ];

    log('info', 'Testing system audio device', { deviceId, args });

    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      // Stream intermediate levels to renderer
      const rmsMatch = data.toString().match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (rmsMatch) {
        const db = parseFloat(rmsMatch[1]);
        sendToRenderer('audio:test-level', { deviceId, db });
      }
    });

    proc.on('close', (code) => {
      // Parse volumedetect output
      const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
      const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);

      if (maxMatch) {
        const maxDb = parseFloat(maxMatch[1]);
        const meanDb = meanMatch ? parseFloat(meanMatch[1]) : -91;
        // Convert dB to 0-1 range: -91dB = silence, 0dB = max
        const peakLevel = Math.max(0, Math.min(1, (maxDb + 91) / 91));
        log('info', 'System audio test complete', { maxDb, meanDb, peakLevel });
        resolve({ success: true, peakLevel });
      } else if (code !== 0) {
        log('error', 'System audio test failed', { code, stderr: stderr.slice(-200) });
        resolve({ success: false, error: 'Could not capture from device' });
      } else {
        resolve({ success: true, peakLevel: 0 });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// List all saved recordings
export function listRecordings(): any[] {
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return [];

  const recordings: any[] = [];
  try {
    const dirs = fs.readdirSync(outputDir);
    for (const dir of dirs) {
      const manifestPath = path.join(outputDir, dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          recordings.push(manifest);
        } catch {}
      }
    }
  } catch {}

  return recordings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getRecording(id: string): any | null {
  const manifestPath = path.join(getOutputDir(), id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteRecording(id: string): { success: boolean; error?: string } {
  const recordingDir = path.join(getOutputDir(), id);
  if (!fs.existsSync(recordingDir)) {
    return { success: false, error: 'Recording not found' };
  }

  try {
    fs.rmSync(recordingDir, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to delete: ${err}` };
  }
}
