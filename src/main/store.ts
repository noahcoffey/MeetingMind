import Store from 'electron-store';

export interface AppSettings {
  userName: string;
  defaultInputDevice: string;
  recordingOutputFolder: string;
  obsidianVaultPath: string;
  obsidianSubfolder: string;
  obsidianDailyNotesFolder: string;
  notesProvider: 'cli' | 'api';
  claudeModel: string;
  notesPromptTemplate: string;
  autoTranscribe: boolean;
  icsCalendarUrl: string;
  icsCalendarEnabled: boolean;
  googleCalendarEnabled: boolean;
  microsoftCalendarEnabled: boolean;
  onboardingComplete: boolean;
  autoSaveToObsidian: boolean;
  globalHotkey: string;
  globalHotkeyPause: string;
  showTrayIcon: boolean;
}

const defaults: AppSettings = {
  userName: '',
  defaultInputDevice: 'default',
  recordingOutputFolder: '',
  obsidianVaultPath: '',
  obsidianSubfolder: 'Meeting Notes',
  obsidianDailyNotesFolder: '',
  notesProvider: 'cli',
  claudeModel: 'claude-sonnet-4-20250514',
  notesPromptTemplate: '',
  autoTranscribe: false,
  icsCalendarUrl: '',
  icsCalendarEnabled: false,
  googleCalendarEnabled: false,
  microsoftCalendarEnabled: false,
  onboardingComplete: false,
  autoSaveToObsidian: false,
  globalHotkey: 'CommandOrControl+Shift+R',
  globalHotkeyPause: 'CommandOrControl+Shift+P',
  showTrayIcon: true,
};

let store: Store<AppSettings>;

export function initializeStore(): void {
  store = new Store<AppSettings>({
    defaults,
    name: 'settings',
  });

  // Set default recording output folder if empty
  if (!store.get('recordingOutputFolder')) {
    const os = require('os');
    const path = require('path');
    store.set('recordingOutputFolder', path.join(os.homedir(), 'Documents', 'MeetingMind'));
  }
}

export function getStore(): Store<AppSettings> {
  return store;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return store.get(key);
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  store.set(key, value);
}
