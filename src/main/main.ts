import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron';
import * as path from 'path';
import { setupIpcHandlers } from './ipc';
import { initializeStore } from './store';
import { initializeLogger, log } from './logger';
import { checkCrashRecovery } from './recorder';

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  initializeLogger();
  log('info', 'MeetingMind starting up');

  initializeStore();
  setupIpcHandlers();

  createWindow();

  // Check for crash recovery
  const recoverable = await checkCrashRecovery();
  if (recoverable.length > 0 && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('crash-recovery', recoverable);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
