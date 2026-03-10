import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let logFilePath: string;
let logStream: fs.WriteStream;

export function initializeLogger(): void {
  const logDir = path.join(app.getPath('home'), 'Library', 'Logs', 'MeetingMind');
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, 'app.log');
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
}

export function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;

  if (logStream) {
    logStream.write(entry);
  }

  if (level === 'error') {
    console.error(entry.trim());
  } else {
    console.log(entry.trim());
  }
}
