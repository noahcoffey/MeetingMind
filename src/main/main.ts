import { app, BrowserWindow, globalShortcut, ipcMain, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import { setupIpcHandlers } from './ipc';
import { initializeStore, getSetting } from './store';
import { initializeLogger, log } from './logger';
import { checkCrashRecovery } from './recorder';
import { createTray, destroyTray, updateTray } from './tray';
import { getRecordingStatus, startRecording, stopRecording, pauseRecording, resumeRecording } from './recording-manager';

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

  // Register custom protocol for serving local audio files to the renderer
  protocol.handle('media', (request) => {
    const filePath = decodeURIComponent(request.url.replace('media://', ''));
    return net.fetch(`file://${filePath}`);
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
