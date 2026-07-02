import Store from 'electron-store';

export interface VocabularyEntry {
  term: string;
  variants: string[];
}

export interface Project {
  id: string;
  name: string;
  notebook: string;
  createdAt: string;
  lastSummaryAt: string | null;
}

export interface AppSettings {
  userName: string;
  defaultInputDevice: string;
  recordingOutputFolder: string;
  obsidianVaultPath: string;
  obsidianSubfolder: string;
  obsidianDailyNotesFolder: string;
  transcriptionProvider: 'assemblyai' | 'openai-whisper' | 'deepgram' | 'whisperx-local';
  // WhisperX local transcription (runs on-device via bundled Python).
  // The HuggingFace token for pyannote diarization is NOT stored here — it lives
  // in the macOS Keychain via keytar under the service name 'huggingface',
  // consistent with the other API keys ('assemblyai', 'openai', 'deepgram').
  whisperxModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3' | 'large-v3-turbo';
  whisperxLanguage: string; // ISO 639-1 language code, empty string = auto-detect
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
  showCostData: boolean;
  speakerDirectory: string[];
  customVocabulary: VocabularyEntry[];
  theme: 'dark' | 'light' | 'system' | 'ember' | 'forest' | 'nord' | 'violet' | 'ocean' | 'slate' | 'linen' | 'paper' | 'sandstone' | 'dawn';
  notebooks: string[];
  activeNotebook: string;
  projects: Project[];
  activeProjectFilter: string | null;
  autoNormalizeQuietAudio: boolean;
  normalizationMethod: 'peak' | 'loudnorm';
  // MeetingHub note sync. The ingest API key is NOT stored here — it lives in
  // the macOS Keychain via keytar under service 'MeetingMind', account 'meetinghub'.
  meetinghubBaseUrl: string;
  meetinghubNotebooks: string[]; // notebooks for which notes auto-push after generation
}

const defaults: AppSettings = {
  userName: '',
  defaultInputDevice: 'default',
  recordingOutputFolder: '',
  obsidianVaultPath: '',
  obsidianSubfolder: 'Meeting Notes',
  obsidianDailyNotesFolder: '',
  transcriptionProvider: 'assemblyai',
  whisperxModel: 'large-v3-turbo',
  whisperxLanguage: '',
  notesProvider: 'cli',
  claudeModel: 'claude-sonnet-4-6',
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
  showCostData: false,
  speakerDirectory: [],
  customVocabulary: [],
  theme: 'dark' as const,
  notebooks: ['Personal'],
  activeNotebook: 'Personal',
  projects: [],
  activeProjectFilter: null,
  autoNormalizeQuietAudio: true,
  normalizationMethod: 'loudnorm',
  meetinghubBaseUrl: 'https://hub.noahcoffey.com',
  meetinghubNotebooks: [],
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

  // Migrate retired Claude model IDs to their current equivalents. Older installs
  // persisted dated Sonnet 4 / Opus 4 IDs that are now deprecated and rejected by
  // the API and the Claude CLI ("model may not exist or you may not have access").
  const RETIRED_MODELS: Record<string, string> = {
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
    'claude-opus-4-20250514': 'claude-opus-4-8',
  };
  const currentModel = store.get('claudeModel');
  if (currentModel && RETIRED_MODELS[currentModel]) {
    store.set('claudeModel', RETIRED_MODELS[currentModel]);
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
