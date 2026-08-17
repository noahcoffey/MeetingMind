// Loopback control channel.
//
// A tiny HTTP server on 127.0.0.1 that lets a local companion — the Stream Deck
// key this was written for — see whether a recording is running and drive it:
// pause/resume, stop, or bring the window forward on the Record page.
//
// It is deliberately small and deliberately fenced in:
//   - bound to 127.0.0.1 only, on an ephemeral port (never fights for one)
//   - every request must carry a token from a 0600 file in Application Support
//   - no route does anything the tray menu cannot already do
//
// The port and token live in `control.json` next to the rest of the app's
// state, which is how a client finds the server at all.

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log } from './logger';
import {
  getRecordingStatus,
  pauseRecording,
  resumeRecording,
  stopRecordingExternally,
} from './recording-manager';

const TOKEN_HEADER = 'x-meetingmind-token';

export interface ControlDeps {
  /** Bring the main window to the front, creating it if it is gone. */
  showWindow(): void;
  /** Push an event to the renderer (no-op when there is no window yet). */
  sendToRenderer(channel: string, data?: unknown): void;
  /** Refresh the tray icon after a state change. */
  updateTray(): void;
}

let server: Server | null = null;
let token = '';

function controlFilePath(): string {
  return path.join(app.getPath('userData'), 'control.json');
}

function writeControlFile(port: number): void {
  const file = controlFilePath();
  try {
    fs.writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }, null, 2), {
      mode: 0o600,
    });
    // writeFileSync only applies `mode` when it creates the file, so an older
    // file would silently keep its old permissions.
    fs.chmodSync(file, 0o600);
  } catch (err) {
    log('error', 'Failed to write control file', err);
  }
}

function removeControlFile(): void {
  try {
    fs.unlinkSync(controlFilePath());
  } catch {}
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  const supplied = req.headers[TOKEN_HEADER];
  if (typeof supplied !== 'string' || supplied.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

function statusBody(): Record<string, unknown> {
  const status = getRecordingStatus();
  return {
    ok: true,
    recording: status.recording,
    paused: status.isPaused,
    duration: status.duration,
    chunks: status.chunkCount,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: ControlDeps): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const route = url.pathname.replace(/\/+$/, '') || '/';

  switch (route) {
    case '/status':
      return json(res, 200, statusBody());

    // Pause if running, resume if paused. One route, because the caller is a
    // single key that means "the other thing".
    case '/pause': {
      const status = getRecordingStatus();
      if (!status.recording) return json(res, 409, { ok: false, error: 'not recording' });
      const result = status.isPaused ? resumeRecording() : pauseRecording();
      deps.updateTray();
      log('info', `Control: ${status.isPaused ? 'resumed' : 'paused'} recording`);
      return json(res, result.success ? 200 : 409, { ...statusBody(), ok: result.success, error: result.error });
    }

    case '/stop': {
      if (!getRecordingStatus().recording) {
        return json(res, 409, { ok: false, error: 'not recording' });
      }
      const result = await stopRecordingExternally();
      deps.updateTray();
      log('info', 'Control: stopped recording', result);
      // Surface the result the way a person would expect after hitting stop.
      if (result.success) deps.showWindow();
      return json(res, result.success ? 200 : 500, {
        ok: result.success,
        recordingId: result.recordingId,
        error: result.error,
      });
    }

    // Bring the app forward on the Record page. `?select=next` also stages the
    // meeting that is happening now, or the one about to.
    case '/focus': {
      deps.showWindow();
      deps.sendToRenderer('control:navigate-record', {
        selectNext: url.searchParams.get('select') === 'next',
      });
      return json(res, 200, statusBody());
    }

    // Start recording whatever is staged. The renderer has to do it: the
    // selected meeting, the title, the notebook and the chosen devices all live
    // on the Record page, and starting from here would drop every one of them.
    case '/start': {
      const status = getRecordingStatus();
      if (status.recording) return json(res, 409, { ...statusBody(), ok: false, error: 'already recording' });
      deps.showWindow();
      deps.sendToRenderer('control:navigate-record', { selectNext: true });
      // Let the page mount and the staged meeting settle before pressing its
      // own Record button -- a start that races the staging records an
      // untitled meeting, which is worse than a start that takes half a second.
      setTimeout(() => deps.sendToRenderer('control:start-recording'), 500);
      log('info', 'Control: starting recording');
      return json(res, 200, { ok: true, starting: true });
    }

    default:
      return json(res, 404, { ok: false, error: 'unknown route' });
  }
}

export function startControlServer(deps: ControlDeps): void {
  if (server) return;
  token = crypto.randomBytes(24).toString('hex');

  server = createServer((req, res) => {
    if (!authorized(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    handle(req, res, deps).catch((err) => {
      log('error', 'Control request failed', err);
      json(res, 500, { ok: false, error: String(err) });
    });
  });

  server.on('error', (err) => {
    log('error', 'Control server error', err);
    server = null;
    removeControlFile();
  });

  // Port 0: the OS picks a free one and we publish it. Nothing to collide with,
  // and no port number to keep in sync between two repos.
  server.listen(0, '127.0.0.1', () => {
    const address = server?.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    writeControlFile(port);
    log('info', `Control server listening on 127.0.0.1:${port}`);
  });
}

export function stopControlServer(): void {
  removeControlFile();
  if (!server) return;
  server.close();
  server = null;
}
