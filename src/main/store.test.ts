import { initializeStore, getSetting, setSetting, getStore } from './store';

// electron-store works fine in Node.js without electron for testing
// but we need to give it a unique config name to avoid conflicts

describe('store', () => {
  beforeAll(() => {
    // Initialize with a test-specific store name to avoid touching real settings
    // We override by calling initializeStore which creates a 'settings' store
    initializeStore();
  });

  test('getSetting returns default values', () => {
    // These are defaults defined in store.ts
    expect(getSetting('notesProvider')).toBe('cli');
    expect(getSetting('autoTranscribe')).toBe(false);
    expect(getSetting('obsidianSubfolder')).toBe('Meeting Notes');
    expect(getSetting('showTrayIcon')).toBe(true);
    expect(getSetting('globalHotkey')).toBe('CommandOrControl+Shift+R');
    expect(getSetting('globalHotkeyPause')).toBe('CommandOrControl+Shift+P');
  });

  test('setSetting persists a value', () => {
    setSetting('userName', 'Test User');
    expect(getSetting('userName')).toBe('Test User');
  });

  test('setSetting overwrites previous value', () => {
    setSetting('claudeModel', 'claude-haiku-4-5-20251001');
    expect(getSetting('claudeModel')).toBe('claude-haiku-4-5-20251001');

    setSetting('claudeModel', 'claude-sonnet-4-20250514');
    expect(getSetting('claudeModel')).toBe('claude-sonnet-4-20250514');
  });

  test('setSetting handles boolean values', () => {
    setSetting('autoTranscribe', true);
    expect(getSetting('autoTranscribe')).toBe(true);

    setSetting('autoTranscribe', false);
    expect(getSetting('autoTranscribe')).toBe(false);
  });

  test('setSetting handles notesProvider enum', () => {
    setSetting('notesProvider', 'api');
    expect(getSetting('notesProvider')).toBe('api');

    setSetting('notesProvider', 'cli');
    expect(getSetting('notesProvider')).toBe('cli');
  });

  test('transcriptionProvider defaults to assemblyai', () => {
    expect(getSetting('transcriptionProvider')).toBe('assemblyai');
  });

  test('setSetting handles transcriptionProvider enum', () => {
    setSetting('transcriptionProvider', 'openai-whisper');
    expect(getSetting('transcriptionProvider')).toBe('openai-whisper');

    setSetting('transcriptionProvider', 'deepgram');
    expect(getSetting('transcriptionProvider')).toBe('deepgram');

    setSetting('transcriptionProvider', 'assemblyai');
    expect(getSetting('transcriptionProvider')).toBe('assemblyai');
  });

  test('getStore returns the store instance', () => {
    const store = getStore();
    expect(store).toBeDefined();
    expect(typeof store.get).toBe('function');
    expect(typeof store.set).toBe('function');
  });

  test('sets default recording output folder on init', () => {
    const folder = getSetting('recordingOutputFolder');
    expect(folder).toBeTruthy();
    expect(folder).toContain('MeetingMind');
  });
});
