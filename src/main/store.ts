import Store from 'electron-store';
import { DEFAULT_MODEL, currentModelId } from './claude-models';

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
  // Pause the automatic pipeline after transcription until the speakers have
  // names, so notes (and the MeetingHub push) attribute things to real people.
  speakerReviewBeforeNotes: boolean;
  /** Delete a meeting's audio this many days after it was recorded (0 = keep forever). Transcript and notes are kept. */
  retentionDays: number;
  // Ask Claude to propose who each diarized speaker is, from the attendee list
  // and the transcript. When every speaker resolves with high confidence the
  // review step is skipped.
  speakerIdentifyWithClaude: boolean;
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
  // Off by default: it points at a private, self-hosted service, so the settings
  // tab and per-recording actions stay hidden until a user explicitly opts in.
  meetinghubEnabled: boolean;
  meetinghubBaseUrl: string;
  meetinghubNotebooks: string[]; // notebooks for which notes auto-push after generation
  // Club Tools (the Kiwanis secretary toolkit, sok) inbox sync. Same shape as MeetingHub:
  // the API token (sok_...) lives in the Keychain under account 'clubtools', and the
  // settings tab stays hidden until enabled.
  clubtoolsEnabled: boolean;
  clubtoolsBaseUrl: string;
  clubtoolsNotebooks: string[]; // notebooks whose notes are sent to Club Tools after generation
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
  claudeModel: DEFAULT_MODEL,
  notesPromptTemplate: '',
  autoTranscribe: false,
  speakerReviewBeforeNotes: true,
  retentionDays: 60,
  speakerIdentifyWithClaude: true,
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
  meetinghubEnabled: false,
  meetinghubBaseUrl: '',
  meetinghubNotebooks: [],
  clubtoolsEnabled: false,
  clubtoolsBaseUrl: '',
  clubtoolsNotebooks: [],
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

  // Move a saved model ID from an older version to the current model of the
  // same tier. Retired IDs are rejected by the API and the CLI outright.
  const savedModel = store.get('claudeModel');
  const current = currentModelId(savedModel);
  if (savedModel && current !== savedModel) {
    store.set('claudeModel', current);
  }
}

/** Every real setting name, for checking writes that come from the renderer. */
export function settingKeys(): Set<string> {
  return new Set(Object.keys(defaults));
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
