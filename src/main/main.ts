import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { setupIpcHandlers } from './ipc';
import { initializeStore, getSetting } from './store';
import { initializeLogger, log } from './logger';
import { checkCrashRecovery } from './recorder';
import { createTray, destroyTray, updateTray } from './tray';
import { getRecordingStatus, startRecording, stopRecording, pauseRecording, resumeRecording } from './recording-manager';

// Register media:// as a privileged scheme before app ready
// so audio/video elements can load from it.
// NOTE: standard must be false — standard schemes parse the first path
// segment as a hostname (lowercased), which mangles absolute file paths.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // On macOS, hide window instead of destroying when closed (keep app alive in tray)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerGlobalShortcuts(): void {
  const hotkeyRecord = getSetting('globalHotkey') || 'CommandOrControl+Shift+R';
  const hotkeyPause = getSetting('globalHotkeyPause') || 'CommandOrControl+Shift+P';

  // Toggle recording: start if idle, stop if recording
  const registeredRecord = globalShortcut.register(hotkeyRecord, async () => {
    const status = getRecordingStatus();
    if (status.recording) {
      log('info', 'Global hotkey: stopping recording');
      const result = await stopRecording();
      if (result.success) {
        updateTray();
        // Show window so user can see the result
        showWindow();
      }
    } else {
      log('info', 'Global hotkey: starting recording');
      const deviceId = getSetting('defaultInputDevice') || 'default';
      const result = startRecording(deviceId);
      if (result.success) {
        updateTray();
      }
    }
  });

  if (!registeredRecord) {
    log('warn', `Failed to register global shortcut: ${hotkeyRecord}`);
  }

  // Toggle pause/resume
  const registeredPause = globalShortcut.register(hotkeyPause, () => {
    const status = getRecordingStatus();
    if (!status.recording) return;

    if (status.isPaused) {
      log('info', 'Global hotkey: resuming recording');
      resumeRecording();
    } else {
      log('info', 'Global hotkey: pausing recording');
      pauseRecording();
    }
    updateTray();
  });

  if (!registeredPause) {
    log('warn', `Failed to register global shortcut: ${hotkeyPause}`);
  }
}

function showWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// Track whether the app is truly quitting vs. just closing the window
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  initializeLogger();
  log('info', 'MeetingMind starting up');

  // Set dock icon (macOS) — needed during development; packaged builds use icon.icns
  if (process.platform === 'darwin') {
    const iconPath = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build', 'icon.png');
    if (fs.existsSync(iconPath)) {
      app.dock?.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  // Register custom protocol for serving local audio files to the renderer.
  // Handles range requests manually so audio seeking works correctly.
  // (net.fetch with file:// doesn't return seekable responses.)
  protocol.handle('media', (request) => {
    const filePath = decodeURIComponent(request.url.replace(/^media:\/\//, ''));

    if (!fs.existsSync(filePath)) {
      log('error', `Media file not found: ${filePath}`);
      return new Response('Not found', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const buffer = Buffer.alloc(chunkSize);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, chunkSize, start);
        fs.closeSync(fd);

        return new Response(new Uint8Array(buffer), {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          },
        });
      }
    }

    // Full file response — use Uint8Array so Electron's Response handles it correctly
    const data = fs.readFileSync(filePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    });
  });

  initializeStore();
  setupIpcHandlers();

  createWindow();

  // Set up tray icon
  if (getSetting('showTrayIcon')) {
    createTray();
  }

  // Register global keyboard shortcuts
  registerGlobalShortcuts();

  // Check for crash recovery
  const recoverable = await checkCrashRecovery();
  if (recoverable.length > 0 && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('crash-recovery', recoverable);
    });
  }

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows are closed (keep alive for tray)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  destroyTray();
});
