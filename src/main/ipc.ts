import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { getSetting, setSetting } from './store';
import { log } from './logger';
import { dictate, DictationOptions } from './dictation';
import { isWhisperXReady, installWhisperXDeps } from './whisperx-setup';
import {
  startRecording,
  stopRecording,
  cancelRecording,
  pauseRecording,
  resumeRecording,
  getRecordingStatus,
  listRecordings,
  getRecording,
  deleteRecording,
  testSystemAudio,
  isPathInsideRecordingsDir,
  listRecordingIndex,
  type MsRange,
  importRecording,
  type ImportOptions,
} from './recording-manager';
import { startTranscription, getTranscriptionStatus } from './transcription';
import { generateNotes, getNotes, updateNotes, saveNotes, saveToObsidian, analyzeSentiment } from './notes-generator';
import { sendToMeetingHub, getMeetingHubActivity, clearMeetingHubActivity } from './meetinghub';
import { prepareSpeakerReview, identifySpeakers, listAwaitingReview } from './speaker-review';
import { getCalendarEvents, invalidateCalendarCache, connectGoogle, connectMicrosoft, disconnectCalendar } from './calendar';
import { listSystemAudioDevices } from './system-audio';
import { copyNotesToClipboard, exportNotesAsPDF, emailNotes, copyTranscriptToClipboard, exportTranscriptAsMarkdown } from './export';
import { searchRecordings } from './search';
import { setTags, getAllTags } from './tagger';
import { getAnalyticsStats, generateTrendInsights } from './analytics';
import { createProject, renameProject, deleteProject, moveToProject, generateProjectSummary, getProjectSummary, updateProjectsForNotebookRename, deleteProjectsForNotebook } from './project-manager';
import { generateWeeklyHighlights, getHighlightsPreview, listSavedHighlights, getSavedHighlight, deleteSavedHighlight } from './weekly-highlights';
import { askQuestion, getQuestions, deleteQuestion, appendQAToObsidian } from './meeting-qa';
import * as fs from 'fs';
import * as path from 'path';
import { isUuid, RENDERER_KEY_SERVICES, isSafeExternalUrl, checkSettingWrite, isTrustedSenderUrl } from './ipc-guard';
import { settingKeys } from './store';

// Channels whose first argument is a recording ID, and those whose first is a
// project ID. Both are always crypto.randomUUID() values; anything else is
// refused before it reaches a path.join.
const RECORDING_ID_FIRST = new Set([
  'recordings:get', 'recordings:delete', 'recordings:renameTitle', 'recordings:moveToNotebook', 'recordings:setTags',
  'transcription:start', 'transcription:status', 'transcription:getTranscript',
  'notes:generate', 'notes:get', 'notes:update', 'notes:save', 'notes:saveObsidian',
  'meetinghub:send',
  'export:clipboard', 'export:pdf', 'export:email', 'export:transcriptClipboard', 'export:transcriptFile',
  'speakers:rename', 'speakers:prepareForNotes', 'speakers:identify',
  'projects:moveRecording', 'sentiment:analyze',
  'qa:ask', 'qa:list', 'qa:delete', 'qa:saveToObsidian',
]);
const PROJECT_ID_FIRST = new Set(['projects:rename', 'projects:delete', 'projects:generateSummary', 'projects:getSummary']);

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown;

// ipcMain.handle, plus: only our own page may call, and IDs are checked.
function handle(channel: string, handler: Handler): void {
  const dev = process.env.NODE_ENV === 'development';
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url;
    if (!isTrustedSenderUrl(senderUrl, dev)) {
      log('warn', 'Blocked IPC from an untrusted page', { channel, senderUrl });
      throw new Error('Not allowed');
    }
    if (RECORDING_ID_FIRST.has(channel) && !isUuid(args[0])) {
      log('warn', 'Blocked IPC with an invalid recording id', { channel });
      throw new Error('Invalid recording id');
    }
    if (PROJECT_ID_FIRST.has(channel) && !isUuid(args[0])) {
      log('warn', 'Blocked IPC with an invalid project id', { channel });
      throw new Error('Invalid project id');
    }
    if (channel === 'projects:moveRecording' && args[1] !== null && !isUuid(args[1])) {
      throw new Error('Invalid project id');
    }
    return handler(event, ...args);
  });
}

export function setupIpcHandlers(): void {
  // Settings handlers
  handle('settings:get', () => {
    const Store = require('electron-store');
    const store = new Store({ name: 'settings' });
    return store.store;
  });

  handle('settings:set', (_event, key: string, value: unknown) => {
    const problem = checkSettingWrite(key, value, settingKeys());
    if (problem) {
      log('warn', 'Rejected settings write', { key, problem });
      return false;
    }
    setSetting(key as any, value as any);
    // Invalidate calendar cache when calendar settings change
    if (key === 'icsCalendarUrl' || key === 'icsCalendarEnabled' || key === 'googleCalendarEnabled' || key === 'microsoftCalendarEnabled') {
      invalidateCalendarCache();
    }
    return true;
  });

  // Keychain. The renderer can store and remove keys, and ask whether one is
  // saved — it never gets a key back.
  handle('keytar:has', async (_event, service: string) => {
    if (!RENDERER_KEY_SERVICES.has(service)) return false;
    try {
      const keytar = require('keytar');
      return !!(await keytar.getPassword('MeetingMind', service));
    } catch (err) {
      log('error', `Failed to check key for ${service}`, err);
      return false;
    }
  });

  handle('keytar:set', async (_event, service: string, value: string) => {
    if (!RENDERER_KEY_SERVICES.has(service) || typeof value !== 'string') return false;
    try {
      const keytar = require('keytar');
      await keytar.setPassword('MeetingMind', service, value);
      return true;
    } catch (err) {
      log('error', `Failed to set key for ${service}`, err);
      return false;
    }
  });

  handle('keytar:delete', async (_event, service: string) => {
    if (!RENDERER_KEY_SERVICES.has(service)) return false;
    try {
      const keytar = require('keytar');
      return await keytar.deletePassword('MeetingMind', service);
    } catch (err) {
      log('error', `Failed to delete key for ${service}`, err);
      return false;
    }
  });

  // File operations
  handle('file:openInFinder', async (_event, filePath: string) => {
    // Only reveal files inside the recordings directory — don't let the
    // renderer point Finder at arbitrary paths.
    if (!isPathInsideRecordingsDir(filePath)) {
      log('warn', `Blocked openInFinder outside recordings dir: ${filePath}`);
      return;
    }
    shell.showItemInFolder(filePath);
  });

  handle('shell:openExternal', async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) {
      log('warn', 'Blocked openExternal for a non-https URL', { url: String(url).slice(0, 200) });
      return;
    }
    shell.openExternal(url);
  });

  handle('file:openInObsidian', async (_event, vaultName: string, filePath: string) => {
    const encodedFile = encodeURIComponent(filePath);
    const encodedVault = encodeURIComponent(vaultName);
    shell.openExternal(`obsidian://open?vault=${encodedVault}&file=${encodedFile}`);
  });

  handle('file:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  handle('file:selectAudioFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg'] }],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Audio devices
  handle('audio:getDevices', async () => {
    return []; // Handled in renderer via navigator.mediaDevices
  });

  handle('audio:getSystemDevices', async () => {
    return listSystemAudioDevices();
  });

  // Audio test
  handle('audio:testSystem', async (_event, deviceId: string) => {
    return testSystemAudio(deviceId);
  });

  // Recording handlers
  handle('recording:start', async (_event, deviceId?: string, systemAudioDeviceId?: string, calendarEventId?: string, userContext?: string, title?: string, notebook?: string, calendarEventProvider?: string) => {
    return startRecording(deviceId || 'default', systemAudioDeviceId, calendarEventId, userContext, title, notebook, calendarEventProvider);
  });

  handle('recording:stop', async () => {
    return stopRecording();
  });

  handle('recording:import', async (_event, filePath: string, opts?: ImportOptions) => {
    return importRecording(filePath, opts);
  });

  handle('recording:cancel', async () => {
    return cancelRecording();
  });

  handle('recording:pause', async () => {
    return pauseRecording();
  });

  handle('recording:resume', async () => {
    return resumeRecording();
  });

  handle('recording:status', async () => {
    return getRecordingStatus();
  });

  // Recordings library
  handle('recordings:list', async (_event, range?: MsRange) => {
    return listRecordings(range);
  });

  handle('recordings:index', async () => {
    return listRecordingIndex();
  });

  handle('recordings:get', async (_event, id: string) => {
    return getRecording(id);
  });

  handle('recordings:delete', async (_event, id: string) => {
    return deleteRecording(id);
  });

  // Transcription
  handle('transcription:start', async (_event, recordingId: string, opts?: { forceNormalize?: boolean }) => {
    return startTranscription(recordingId, opts || {});
  });

  handle('transcription:status', async (_event, recordingId: string) => {
    return getTranscriptionStatus(recordingId);
  });

  // Live dictation (experiment): one utterance of raw PCM in, cleaned text out.
  handle('dictation:transcribe', async (_event, pcm: Uint8Array, opts: DictationOptions) => {
    try {
      const result = await dictate(pcm, opts);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // WhisperX local transcription setup
  handle('whisperx:checkReady', () => ({ ready: isWhisperXReady() }));

  handle('whisperx:setup', async () => {
    const broadcast = (message: string, pct: number) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('transcription:progress', { status: 'processing', message, progress: pct });
      }
    };
    try {
      await installWhisperXDeps(broadcast);
      return { success: true };
    } catch (err: any) {
      // Errors don't JSON-serialize their message, so pass it explicitly.
      log('error', 'WhisperX setup failed', { error: err?.message || String(err) });
      return { success: false, error: err?.message || 'WhisperX setup failed' };
    }
  });

  // Notes
  handle('notes:generate', async (_event, recordingId: string) => {
    return generateNotes(recordingId);
  });

  handle('notes:get', async (_event, recordingId: string) => {
    return getNotes(recordingId);
  });

  handle('notes:update', async (_event, recordingId: string, content: string) => {
    return updateNotes(recordingId, content);
  });

  handle('notes:save', async (_event, recordingId: string, filename: string) => {
    return saveNotes(recordingId, filename);
  });

  handle('notes:saveObsidian', async (_event, recordingId: string, filename: string) => {
    return saveToObsidian(recordingId, filename);
  });

  // MeetingHub note sync
  handle('meetinghub:send', async (_event, recordingId: string) => {
    return sendToMeetingHub(recordingId, { manual: true });
  });

  handle('meetinghub:getActivity', async () => {
    return getMeetingHubActivity();
  });

  handle('meetinghub:clearActivity', async () => {
    return clearMeetingHubActivity();
  });

  // Calendar
  handle('calendar:getEvents', async (_event, bypassCache?: boolean) => {
    return getCalendarEvents(bypassCache);
  });

  handle('calendar:connectGoogle', async () => {
    return connectGoogle();
  });

  handle('calendar:connectMicrosoft', async () => {
    return connectMicrosoft();
  });

  handle('calendar:disconnect', async (_event, provider: string) => {
    return disconnectCalendar(provider);
  });

  // Export
  handle('export:clipboard', async (_event, recordingId: string) => {
    return copyNotesToClipboard(recordingId);
  });

  handle('export:pdf', async (_event, recordingId: string) => {
    return exportNotesAsPDF(recordingId);
  });

  handle('export:email', async (_event, recordingId: string) => {
    return emailNotes(recordingId);
  });

  handle('export:transcriptClipboard', async (_event, recordingId: string) => {
    return copyTranscriptToClipboard(recordingId);
  });

  handle('export:transcriptFile', async (_event, recordingId: string) => {
    return exportTranscriptAsMarkdown(recordingId);
  });

  // Speaker renaming
  handle('speakers:rename', async (_event, recordingId: string, oldName: string, newName: string) => {
    const recording = getRecording(recordingId);
    if (!recording) return { success: false, error: 'Recording not found' };

    const outputDir = path.dirname(recording.audioPath);
    const manifestPath = path.join(outputDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.speakerNames) manifest.speakerNames = {};
      // Renaming a speaker back to its own label clears it.
      if (newName.trim() === oldName || /^Speaker \d+$/i.test(newName.trim())) delete manifest.speakerNames[oldName];
      else manifest.speakerNames[oldName] = newName.trim();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Add to global speaker directory if not already present
      if (newName.trim() && !newName.startsWith('Speaker ')) {
        const directory: string[] = getSetting('speakerDirectory') || [];
        if (!directory.includes(newName.trim())) {
          directory.push(newName.trim());
          directory.sort((a, b) => a.localeCompare(b));
          setSetting('speakerDirectory', directory);
        }
      }

      return { success: true };
    }

    return { success: false, error: 'Manifest not found' };
  });

  // Speaker directory
  handle('speakers:getDirectory', async () => {
    return getSetting('speakerDirectory') || [];
  });

  // Speaker review gate (see speaker-review.ts)
  handle('speakers:prepareForNotes', async (_event, recordingId: string) => {
    return prepareSpeakerReview(recordingId);
  });

  handle('speakers:identify', async (_event, recordingId: string) => {
    return identifySpeakers(recordingId);
  });

  handle('speakers:listAwaitingReview', async () => {
    return listAwaitingReview();
  });

  // Rename recording title
  handle('recordings:renameTitle', async (_event, recordingId: string, newTitle: string) => {
    const recording = getRecording(recordingId);
    if (!recording) return { success: false, error: 'Recording not found' };

    const outputDir = path.dirname(recording.audioPath);
    const manifestPath = path.join(outputDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.title = newTitle;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      return { success: true };
    }

    return { success: false, error: 'Manifest not found' };
  });

  // Move recording to notebook
  handle('recordings:moveToNotebook', async (_event, recordingId: string, notebook: string) => {
    const recording = getRecording(recordingId);
    if (!recording) return { success: false, error: 'Recording not found' };

    const outputDir = path.dirname(recording.audioPath);
    const manifestPath = path.join(outputDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.notebook = notebook;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      return { success: true };
    }

    return { success: false, error: 'Manifest not found' };
  });

  // Transcript data (utterances for transcript viewer)
  handle('transcription:getTranscript', async (_event, recordingId: string) => {
    const recording = getRecording(recordingId);
    if (!recording) return null;
    const outputDir = path.dirname(recording.audioPath);
    const transcriptPath = path.join(outputDir, 'transcript.json');
    if (fs.existsSync(transcriptPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
        return data.utterances || [];
      } catch { return []; }
    }
    return [];
  });

  // Search
  handle('search:query', async (_event, query: string) => {
    return searchRecordings(query);
  });

  // Tags
  handle('recordings:setTags', async (_event, recordingId: string, tags: string[]) => {
    return setTags(recordingId, tags);
  });

  handle('recordings:getAllTags', async () => {
    return getAllTags();
  });

  // Projects
  handle('projects:list', async () => {
    return getSetting('projects') || [];
  });

  handle('projects:create', async (_event, name: string, notebook: string) => {
    return createProject(name, notebook);
  });

  handle('projects:rename', async (_event, id: string, name: string) => {
    return renameProject(id, name);
  });

  handle('projects:delete', async (_event, id: string) => {
    return deleteProject(id);
  });

  handle('projects:moveRecording', async (_event, recordingId: string, projectId: string | null) => {
    return moveToProject(recordingId, projectId);
  });

  handle('projects:generateSummary', async (_event, projectId: string) => {
    return generateProjectSummary(projectId);
  });

  handle('projects:getSummary', async (_event, projectId: string) => {
    return getProjectSummary(projectId);
  });

  handle('projects:notebookRenamed', async (_event, oldName: string, newName: string) => {
    updateProjectsForNotebookRename(oldName, newName);
  });

  handle('projects:notebookDeleted', async (_event, notebookName: string) => {
    deleteProjectsForNotebook(notebookName);
  });

  // Sentiment
  handle('sentiment:analyze', async (_event, recordingId: string) => {
    return analyzeSentiment(recordingId);
  });

  // Analytics
  handle('analytics:getStats', async () => {
    return getAnalyticsStats();
  });

  handle('analytics:getTrends', async () => {
    return generateTrendInsights();
  });

  // Weekly Highlights
  handle('highlights:preview', async (_event, startDate: string, endDate: string) => {
    return getHighlightsPreview(startDate, endDate);
  });

  handle('highlights:generate', async (_event, startDate: string, endDate: string) => {
    return generateWeeklyHighlights(startDate, endDate);
  });

  handle('highlights:list', async () => {
    return listSavedHighlights();
  });

  handle('highlights:get', async (_event, id: string) => {
    return getSavedHighlight(id);
  });

  handle('highlights:delete', async (_event, id: string) => {
    return deleteSavedHighlight(id);
  });

  // Meeting Q&A
  handle('qa:ask', async (_event, recordingId: string, question: string) => {
    return askQuestion(recordingId, question);
  });

  handle('qa:list', async (_event, recordingId: string) => {
    return getQuestions(recordingId);
  });

  handle('qa:delete', async (_event, recordingId: string, qaId: string) => {
    return deleteQuestion(recordingId, qaId);
  });

  handle('qa:saveToObsidian', async (_event, recordingId: string, qaId: string) => {
    return appendQAToObsidian(recordingId, qaId);
  });

  log('info', 'IPC handlers registered');
}
