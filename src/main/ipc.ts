import { ipcMain, dialog, shell } from 'electron';
import { getSetting, setSetting } from './store';
import { log } from './logger';
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
} from './recording-manager';
import { startTranscription, getTranscriptionStatus } from './transcription';
import { generateNotes, getNotes, saveNotes, saveToObsidian } from './notes-generator';
import { getCalendarEvents, invalidateCalendarCache, connectGoogle, connectMicrosoft, disconnectCalendar } from './calendar';
import { listSystemAudioDevices } from './system-audio';
import { copyNotesToClipboard, exportNotesAsPDF, emailNotes } from './export';
import { searchRecordings } from './search';
import { setTags, getAllTags } from './tagger';
import { getAnalyticsStats, generateTrendInsights } from './analytics';
import { generateWeeklyHighlights, getHighlightsPreview, listSavedHighlights, getSavedHighlight, deleteSavedHighlight } from './weekly-highlights';
import * as fs from 'fs';
import * as path from 'path';

export function setupIpcHandlers(): void {
  // Settings handlers
  ipcMain.handle('settings:get', () => {
    const Store = require('electron-store');
    const store = new Store({ name: 'settings' });
    return store.store;
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    setSetting(key as any, value as any);
    // Invalidate calendar cache when calendar settings change
    if (key === 'icsCalendarUrl' || key === 'icsCalendarEnabled' || key === 'googleCalendarEnabled' || key === 'microsoftCalendarEnabled') {
      invalidateCalendarCache();
    }
    return true;
  });

  // Keytar handlers for secure API key storage
  ipcMain.handle('keytar:get', async (_event, service: string) => {
    try {
      const keytar = require('keytar');
      return await keytar.getPassword('MeetingMind', service);
    } catch (err) {
      log('error', `Failed to get key for ${service}`, err);
      return null;
    }
  });

  ipcMain.handle('keytar:set', async (_event, service: string, value: string) => {
    try {
      const keytar = require('keytar');
      await keytar.setPassword('MeetingMind', service, value);
      return true;
    } catch (err) {
      log('error', `Failed to set key for ${service}`, err);
      return false;
    }
  });

  ipcMain.handle('keytar:delete', async (_event, service: string) => {
    try {
      const keytar = require('keytar');
      return await keytar.deletePassword('MeetingMind', service);
    } catch (err) {
      log('error', `Failed to delete key for ${service}`, err);
      return false;
    }
  });

  // File operations
  ipcMain.handle('file:openInFinder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('file:openInObsidian', async (_event, vaultName: string, filePath: string) => {
    const encodedFile = encodeURIComponent(filePath);
    const encodedVault = encodeURIComponent(vaultName);
    shell.openExternal(`obsidian://open?vault=${encodedVault}&file=${encodedFile}`);
  });

  ipcMain.handle('file:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Audio devices
  ipcMain.handle('audio:getDevices', async () => {
    return []; // Handled in renderer via navigator.mediaDevices
  });

  ipcMain.handle('audio:getSystemDevices', async () => {
    return listSystemAudioDevices();
  });

  // Recording handlers
  ipcMain.handle('recording:start', async (_event, deviceId?: string, systemAudioDeviceId?: string, calendarEventId?: string, userContext?: string, title?: string) => {
    return startRecording(deviceId || 'default', systemAudioDeviceId, calendarEventId, userContext, title);
  });

  ipcMain.handle('recording:stop', async () => {
    return stopRecording();
  });

  ipcMain.handle('recording:cancel', async () => {
    return cancelRecording();
  });

  ipcMain.handle('recording:pause', async () => {
    return pauseRecording();
  });

  ipcMain.handle('recording:resume', async () => {
    return resumeRecording();
  });

  ipcMain.handle('recording:status', async () => {
    return getRecordingStatus();
  });

  // Recordings library
  ipcMain.handle('recordings:list', async () => {
    return listRecordings();
  });

  ipcMain.handle('recordings:get', async (_event, id: string) => {
    return getRecording(id);
  });

  ipcMain.handle('recordings:delete', async (_event, id: string) => {
    return deleteRecording(id);
  });

  // Transcription
  ipcMain.handle('transcription:start', async (_event, recordingId: string) => {
    return startTranscription(recordingId);
  });

  ipcMain.handle('transcription:status', async (_event, recordingId: string) => {
    return getTranscriptionStatus(recordingId);
  });

  // Notes
  ipcMain.handle('notes:generate', async (_event, recordingId: string) => {
    return generateNotes(recordingId);
  });

  ipcMain.handle('notes:get', async (_event, recordingId: string) => {
    return getNotes(recordingId);
  });

  ipcMain.handle('notes:save', async (_event, recordingId: string, filename: string) => {
    return saveNotes(recordingId, filename);
  });

  ipcMain.handle('notes:saveObsidian', async (_event, recordingId: string, filename: string) => {
    return saveToObsidian(recordingId, filename);
  });

  // Calendar
  ipcMain.handle('calendar:getEvents', async (_event, bypassCache?: boolean) => {
    return getCalendarEvents(bypassCache);
  });

  ipcMain.handle('calendar:connectGoogle', async () => {
    return connectGoogle();
  });

  ipcMain.handle('calendar:connectMicrosoft', async () => {
    return connectMicrosoft();
  });

  ipcMain.handle('calendar:disconnect', async (_event, provider: string) => {
    return disconnectCalendar(provider);
  });

  // Export
  ipcMain.handle('export:clipboard', async (_event, recordingId: string) => {
    return copyNotesToClipboard(recordingId);
  });

  ipcMain.handle('export:pdf', async (_event, recordingId: string) => {
    return exportNotesAsPDF(recordingId);
  });

  ipcMain.handle('export:email', async (_event, recordingId: string) => {
    return emailNotes(recordingId);
  });

  // Speaker renaming
  ipcMain.handle('speakers:rename', async (_event, recordingId: string, oldName: string, newName: string) => {
    const recording = getRecording(recordingId);
    if (!recording) return { success: false, error: 'Recording not found' };

    const outputDir = path.dirname(recording.audioPath);
    const manifestPath = path.join(outputDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.speakerNames) manifest.speakerNames = {};
      manifest.speakerNames[oldName] = newName;
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
  ipcMain.handle('speakers:getDirectory', async () => {
    return getSetting('speakerDirectory') || [];
  });

  // Rename recording title
  ipcMain.handle('recordings:renameTitle', async (_event, recordingId: string, newTitle: string) => {
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

  // Transcript data (utterances for transcript viewer)
  ipcMain.handle('transcription:getTranscript', async (_event, recordingId: string) => {
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
  ipcMain.handle('search:query', async (_event, query: string) => {
    return searchRecordings(query);
  });

  // Tags
  ipcMain.handle('recordings:setTags', async (_event, recordingId: string, tags: string[]) => {
    return setTags(recordingId, tags);
  });

  ipcMain.handle('recordings:getAllTags', async () => {
    return getAllTags();
  });

  // Analytics
  ipcMain.handle('analytics:getStats', async () => {
    return getAnalyticsStats();
  });

  ipcMain.handle('analytics:getTrends', async () => {
    return generateTrendInsights();
  });

  // Weekly Highlights
  ipcMain.handle('highlights:preview', async (_event, startDate: string, endDate: string) => {
    return getHighlightsPreview(startDate, endDate);
  });

  ipcMain.handle('highlights:generate', async (_event, startDate: string, endDate: string) => {
    return generateWeeklyHighlights(startDate, endDate);
  });

  ipcMain.handle('highlights:list', async () => {
    return listSavedHighlights();
  });

  ipcMain.handle('highlights:get', async (_event, id: string) => {
    return getSavedHighlight(id);
  });

  ipcMain.handle('highlights:delete', async (_event, id: string) => {
    return deleteSavedHighlight(id);
  });

  log('info', 'IPC handlers registered');
}
