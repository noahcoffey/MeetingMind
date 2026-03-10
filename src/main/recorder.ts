import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import * as crypto from 'crypto';

export interface RecordingManifest {
  sessionId: string;
  startTime: string;
  currentDuration: number;
  chunks: string[];
  inputDevice: string;
  title?: string;
  calendarEventId?: string;
  userContext?: string;
}

export interface RecoverableSession {
  sessionId: string;
  manifest: RecordingManifest;
  tempDir: string;
}

function getTempRecordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings', 'temp');
}

export async function checkCrashRecovery(): Promise<RecoverableSession[]> {
  const tempDir = getTempRecordingsDir();
  const recoverable: RecoverableSession[] = [];

  if (!fs.existsSync(tempDir)) {
    return recoverable;
  }

  try {
    const sessions = fs.readdirSync(tempDir);
    for (const sessionId of sessions) {
      const sessionDir = path.join(tempDir, sessionId);
      const manifestPath = path.join(sessionDir, 'recording-manifest.json');

      if (fs.existsSync(manifestPath)) {
        try {
          const manifest: RecordingManifest = JSON.parse(
            fs.readFileSync(manifestPath, 'utf-8')
          );

          // Check if there are actual chunk files
          const chunks = manifest.chunks.filter(c =>
            fs.existsSync(path.join(sessionDir, c))
          );

          if (chunks.length > 0) {
            log('info', `Found recoverable session: ${sessionId} with ${chunks.length} chunks`);
            recoverable.push({
              sessionId,
              manifest: { ...manifest, chunks },
              tempDir: sessionDir,
            });
          }
        } catch (err) {
          log('error', `Failed to parse manifest for session ${sessionId}`, err);
        }
      }
    }
  } catch (err) {
    log('error', 'Error checking crash recovery', err);
  }

  return recoverable;
}

export function getRecordingsOutputDir(): string {
  const os = require('os');
  return path.join(os.homedir(), 'Documents', 'MeetingMind', 'recordings');
}

export function getNotesOutputDir(): string {
  const os = require('os');
  return path.join(os.homedir(), 'Documents', 'MeetingMind', 'notes');
}
