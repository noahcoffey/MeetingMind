import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { log } from './logger';
import { getSetting } from './store';
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
  ffmpegProcess: ChildProcess | null;
  manifestInterval: ReturnType<typeof setInterval> | null;
  diskCheckInterval: ReturnType<typeof setInterval> | null;
  isPaused: boolean;
  pausedAt: number;          // timestamp when paused, 0 if not paused
  totalPausedMs: number;     // accumulated paused milliseconds
  calendarEventId?: string;
  userContext?: string;
  title?: string;
}

let activeRecording: ActiveRecording | null = null;

function getTempDir(): string {
  return path.join(app.getPath('userData'), 'recordings', 'temp');
}

function getFFmpegPath(): string {
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

function getOutputDir(): string {
  const customDir = getSetting('recordingOutputFolder');
  return customDir || path.join(os.homedir(), 'Documents', 'MeetingMind', 'recordings');
}

export function startRecording(deviceId: string, calendarEventId?: string, userContext?: string, title?: string): { success: boolean; sessionId?: string; error?: string } {
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
    ffmpegProcess: null,
    manifestInterval: null,
    diskCheckInterval: null,
    isPaused: false,
    pausedAt: 0,
    totalPausedMs: 0,
    calendarEventId,
    userContext,
    title,
  };

  log('info', `Starting recording session ${sessionId}`, { deviceId });

  // Start first chunk
  startChunk();

  // Start manifest writing
  activeRecording.manifestInterval = setInterval(() => {
    writeManifest();
  }, MANIFEST_INTERVAL_MS);

  // Start disk space monitoring
  activeRecording.diskCheckInterval = setInterval(() => {
    checkDiskSpace();
  }, DISK_CHECK_INTERVAL_MS);

  return { success: true, sessionId };
}

function startChunk(): void {
  if (!activeRecording) return;

  const chunkName = `chunk-${String(activeRecording.chunkIndex + 1).padStart(3, '0')}.wav`;
  const chunkPath = path.join(activeRecording.tempDir, chunkName);
  const ffmpegPath = getFFmpegPath();

  // Build ffmpeg command to record from input device
  // On macOS, use avfoundation to capture audio
  const args = [
    '-f', 'avfoundation',
    '-i', `:${activeRecording.inputDevice === 'default' ? '0' : activeRecording.inputDevice}`,
    '-ac', '1',           // mono
    '-ar', '44100',       // 44.1kHz
    '-t', String(CHUNK_DURATION_SEC), // chunk duration
    '-y',                 // overwrite
    chunkPath,
  ];

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
      if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0) {
        activeRecording.chunks.push(chunkName);
        sendToRenderer('recording:chunk', activeRecording.chunks.length);
        writeManifest();
        log('info', `Chunk ${chunkName} saved`, { size: fs.statSync(chunkPath).size });
      }

      // If we're still recording and this was a natural end (not a stop), start next chunk
      if (activeRecording && !activeRecording.isPaused && code === 0) {
        activeRecording.chunkIndex++;
        startChunk();
      }
    } else {
      log('error', `ffmpeg chunk recording failed with code ${code}`);
    }
  });

  proc.on('error', (err) => {
    log('error', 'ffmpeg process error', err);
  });
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
    userContext: activeRecording.userContext,
  };

  const manifestPath = path.join(activeRecording.tempDir, 'recording-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
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
      userContext: recording.userContext,
      speakerNames: {},
    };

    fs.writeFileSync(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

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

// Audio level monitoring using a separate ffmpeg process
let levelProcess: ChildProcess | null = null;

export function startLevelMonitor(deviceId: string): void {
  const ffmpegPath = getFFmpegPath();

  const args = [
    '-f', 'avfoundation',
    '-i', `:${deviceId === 'default' ? '0' : deviceId}`,
    '-af', 'volumedetect',
    '-f', 'null',
    '-t', '0.1',  // very short capture
    '-',
  ];

  // We'll use a simpler approach — the audio level is sent from the renderer
  // using Web Audio API analyser, since the renderer has access to getUserMedia
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
