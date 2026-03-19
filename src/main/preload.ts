import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),

  // Secure storage (keytar)
  getApiKey: (service: string) => ipcRenderer.invoke('keytar:get', service),
  setApiKey: (service: string, value: string) => ipcRenderer.invoke('keytar:set', service, value),
  deleteApiKey: (service: string) => ipcRenderer.invoke('keytar:delete', service),

  // Audio devices
  getAudioDevices: () => ipcRenderer.invoke('audio:getDevices'),
  getSystemAudioDevices: () => ipcRenderer.invoke('audio:getSystemDevices'),

  // Recording
  startRecording: (deviceId?: string, systemAudioDeviceId?: string, calendarEventId?: string, userContext?: string, title?: string, notebook?: string) => ipcRenderer.invoke('recording:start', deviceId, systemAudioDeviceId, calendarEventId, userContext, title, notebook),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  pauseRecording: () => ipcRenderer.invoke('recording:pause'),
  resumeRecording: () => ipcRenderer.invoke('recording:resume'),
  getRecordingStatus: () => ipcRenderer.invoke('recording:status'),

  // Recordings library
  getRecordings: () => ipcRenderer.invoke('recordings:list'),
  getRecording: (id: string) => ipcRenderer.invoke('recordings:get', id),
  deleteRecording: (id: string) => ipcRenderer.invoke('recordings:delete', id),

  // Transcription
  startTranscription: (recordingId: string) => ipcRenderer.invoke('transcription:start', recordingId),
  getTranscriptionStatus: (recordingId: string) => ipcRenderer.invoke('transcription:status', recordingId),

  // Transcript data
  getTranscript: (recordingId: string) => ipcRenderer.invoke('transcription:getTranscript', recordingId),

  // Rename recording title
  renameRecording: (recordingId: string, newTitle: string) => ipcRenderer.invoke('recordings:renameTitle', recordingId, newTitle),
  moveToNotebook: (recordingId: string, notebook: string) => ipcRenderer.invoke('recordings:moveToNotebook', recordingId, notebook),

  // Notes generation
  generateNotes: (recordingId: string) => ipcRenderer.invoke('notes:generate', recordingId),
  getNotes: (recordingId: string) => ipcRenderer.invoke('notes:get', recordingId),
  updateNotes: (recordingId: string, content: string) => ipcRenderer.invoke('notes:update', recordingId, content),
  saveNotes: (recordingId: string, filename: string) => ipcRenderer.invoke('notes:save', recordingId, filename),
  saveToObsidian: (recordingId: string, filename: string) => ipcRenderer.invoke('notes:saveObsidian', recordingId, filename),

  // Calendar
  getCalendarEvents: (bypassCache?: boolean) => ipcRenderer.invoke('calendar:getEvents', bypassCache),
  connectGoogleCalendar: () => ipcRenderer.invoke('calendar:connectGoogle'),
  connectMicrosoftCalendar: () => ipcRenderer.invoke('calendar:connectMicrosoft'),
  disconnectCalendar: (provider: string) => ipcRenderer.invoke('calendar:disconnect', provider),

  // Speaker renaming & directory
  renameSpeaker: (recordingId: string, oldName: string, newName: string) =>
    ipcRenderer.invoke('speakers:rename', recordingId, oldName, newName),
  getSpeakerDirectory: () => ipcRenderer.invoke('speakers:getDirectory'),

  // Export
  copyNotesToClipboard: (recordingId: string) => ipcRenderer.invoke('export:clipboard', recordingId),
  exportAsPDF: (recordingId: string) => ipcRenderer.invoke('export:pdf', recordingId),
  emailNotes: (recordingId: string) => ipcRenderer.invoke('export:email', recordingId),

  // Search
  searchRecordings: (query: string) => ipcRenderer.invoke('search:query', query),

  // Tags
  setRecordingTags: (recordingId: string, tags: string[]) => ipcRenderer.invoke('recordings:setTags', recordingId, tags),
  getAllTags: () => ipcRenderer.invoke('recordings:getAllTags'),

  // Analytics
  getAnalyticsStats: () => ipcRenderer.invoke('analytics:getStats'),
  getTrendInsights: () => ipcRenderer.invoke('analytics:getTrends'),

  // File operations
  openInFinder: (filePath: string) => ipcRenderer.invoke('file:openInFinder', filePath),
  openInObsidian: (vaultName: string, filePath: string) =>
    ipcRenderer.invoke('file:openInObsidian', vaultName, filePath),
  selectFolder: () => ipcRenderer.invoke('file:selectFolder'),

  // Meeting Q&A
  askQuestion: (recordingId: string, question: string) => ipcRenderer.invoke('qa:ask', recordingId, question),
  getQuestions: (recordingId: string) => ipcRenderer.invoke('qa:list', recordingId),
  deleteQuestion: (recordingId: string, qaId: string) => ipcRenderer.invoke('qa:delete', recordingId, qaId),
  saveQAToObsidian: (recordingId: string, qaId: string) => ipcRenderer.invoke('qa:saveToObsidian', recordingId, qaId),

  // Weekly Highlights
  getHighlightsPreview: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('highlights:preview', startDate, endDate),
  generateHighlights: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('highlights:generate', startDate, endDate),
  listSavedHighlights: () => ipcRenderer.invoke('highlights:list'),
  getSavedHighlight: (id: string) => ipcRenderer.invoke('highlights:get', id),
  deleteSavedHighlight: (id: string) => ipcRenderer.invoke('highlights:delete', id),

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'recording:level',
      'recording:chunk',
      'recording:timer',
      'recording:paused',
      'recording:disk-warning',
      'transcription:progress',
      'notes:stream',
      'notes:complete',
      'crash-recovery',
      'highlights:stream',
      'highlights:complete',
      'qa:stream',
      'qa:complete',
      'qa:error',
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('meetingMind', api);

export type MeetingMindAPI = typeof api;
