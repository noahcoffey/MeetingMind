import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { getRecordingStatus, startRecording, stopRecording, pauseRecording, resumeRecording } from './recording-manager';
import { getSetting } from './store';
import { log } from './logger';

let tray: Tray | null = null;
let updateInterval: ReturnType<typeof setInterval> | null = null;

// 22x22 template icon: idle microphone (simple mic outline, works as macOS template)
const ICON_IDLE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAhklEQVQ4y+2UQQ6AIAxE' +
  'p8Yr6P0P5RXcuNCoIAi0uHCSTZv0Z5ppC/xbkdIC7AE2wBF4AEeSl6LYLGkraSupkXSU' +
  'dJV0CwtLzswBZgMnMzsBFyCr2u+AVwBrYK3qzwWsxHbAzsxawLUkVvUWuMW2R96nEf7/' +
  'hy8pLEGwByqSp6L41frt+gA9tCZBrOKBcgAAAABJRU5ErkJggg==';

// 22x22 template icon: recording (filled circle)
const ICON_RECORDING_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAbElEQVQ4y+3UsQ2AIBBG' +
  '4UdsBAt34CJu4AZu5VBu4AAWFhoT4kULCwu/5JK74OOKAz6NJP8BWAN74AKcgCtwI3kr' +
  'cpaUJLUBKkmHMueyYjObA7P3zAxYFBtJW0mronsP3Mvib3/3nyr66foA1hkjQdFViZcA' +
  'AAAASUVORK5CYII=';

// 22x22 template icon: paused (two vertical bars)
const ICON_PAUSED_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAP0lEQVQ4y2NgGAUDDRgZ' +
  'GBj+k6H+PwMDAxMDA8N/MjQzMTAwMJCj+T8ZYFTzqOZRzaOaRzWPah7VTB4AAFnvBQ3a' +
  'mBCsAAAAAElFTkSuQmCC';

function createNativeIcon(base64: string): Electron.NativeImage {
  const img = nativeImage.createFromDataURL(`data:image/png;base64,${base64}`);
  img.setTemplateImage(true);
  return img;
}

const iconIdle = createNativeIcon(ICON_IDLE_BASE64);
const iconRecording = createNativeIcon(ICON_RECORDING_BASE64);
const iconPaused = createNativeIcon(ICON_PAUSED_BASE64);

function showOrCreateWindow(): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    // Emit activate to trigger window creation in main.ts
    app.emit('activate');
  }
}

function buildContextMenu(): Menu {
  const status = getRecordingStatus();

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Show Window',
      click: () => showOrCreateWindow(),
    },
    { type: 'separator' },
  ];

  if (status.recording) {
    const durationMin = Math.floor(status.duration / 60);
    const durationSec = status.duration % 60;
    const timeStr = `${durationMin}:${String(durationSec).padStart(2, '0')}`;

    menuItems.push({
      label: status.isPaused ? `Recording Paused (${timeStr})` : `Recording... (${timeStr})`,
      enabled: false,
    });

    menuItems.push({
      label: 'Stop Recording',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: async () => {
        const result = await stopRecording();
        if (result.success) {
          log('info', 'Recording stopped via tray');
          updateTray();
          showOrCreateWindow();
        }
      },
    });

    menuItems.push({
      label: status.isPaused ? 'Resume Recording' : 'Pause Recording',
      accelerator: 'CmdOrCtrl+Shift+P',
      click: () => {
        if (status.isPaused) {
          resumeRecording();
        } else {
          pauseRecording();
        }
        updateTray();
      },
    });
  } else {
    menuItems.push({
      label: 'Start Recording',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: () => {
        const deviceId = getSetting('defaultInputDevice') || 'default';
        const result = startRecording(deviceId, undefined);
        if (result.success) {
          log('info', 'Recording started via tray');
          updateTray();
        }
      },
    });
  }

  menuItems.push({ type: 'separator' });
  menuItems.push({
    label: 'Quit MeetingMind',
    click: () => {
      app.quit();
    },
  });

  return Menu.buildFromTemplate(menuItems);
}

function updateTray(): void {
  if (!tray) return;

  const status = getRecordingStatus();

  if (status.recording) {
    tray.setImage(status.isPaused ? iconPaused : iconRecording);
    const durationMin = Math.floor(status.duration / 60);
    const durationSec = status.duration % 60;
    const timeStr = `${durationMin}:${String(durationSec).padStart(2, '0')}`;
    tray.setToolTip(status.isPaused ? `MeetingMind - Paused (${timeStr})` : `MeetingMind - Recording (${timeStr})`);
  } else {
    tray.setImage(iconIdle);
    tray.setToolTip('MeetingMind');
  }

  tray.setContextMenu(buildContextMenu());
}

export function createTray(): void {
  if (tray) return;

  tray = new Tray(iconIdle);
  tray.setToolTip('MeetingMind');
  tray.setContextMenu(buildContextMenu());

  tray.on('click', () => {
    showOrCreateWindow();
  });

  // Update tray every 2 seconds to keep duration current
  updateInterval = setInterval(() => {
    updateTray();
  }, 2000);

  log('info', 'Tray created');
}

export function destroyTray(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export { updateTray };
