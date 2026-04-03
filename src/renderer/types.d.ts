export interface AudioDevice {
  index: number;
  name: string;
  isVirtual: boolean;
}

export interface MeetingMindAPI {
  getSettings: () => Promise<Record<string, unknown>>;
  setSetting: (key: string, value: unknown) => Promise<boolean>;
  getApiKey: (service: string) => Promise<string | null>;
  setApiKey: (service: string, value: string) => Promise<boolean>;
  deleteApiKey: (service: string) => Promise<boolean>;
  getAudioDevices: () => Promise<MediaDeviceInfo[]>;
  getSystemAudioDevices: () => Promise<AudioDevice[]>;
  startRecording: (deviceId?: string, systemAudioDeviceId?: string, calendarEventId?: string, userContext?: string, title?: string, notebook?: string) => Promise<{ success: boolean; error?: string }>;
  stopRecording: () => Promise<{ success: boolean; error?: string; recordingId?: string }>;
  cancelRecording: () => Promise<{ success: boolean; error?: string }>;
  pauseRecording: () => Promise<{ success: boolean; error?: string }>;
  resumeRecording: () => Promise<{ success: boolean; error?: string }>;
  getRecordingStatus: () => Promise<{ recording: boolean; duration: number; chunkCount: number; isPaused: boolean }>;
  getRecordings: () => Promise<Recording[]>;
  getRecording: (id: string) => Promise<Recording | null>;
  deleteRecording: (id: string) => Promise<{ success: boolean; error?: string }>;
  startTranscription: (recordingId: string) => Promise<{ success: boolean; error?: string }>;
  getTranscriptionStatus: (recordingId: string) => Promise<{ status: string; progress?: number }>;
  getTranscript: (recordingId: string) => Promise<TranscriptUtterance[]>;
  generateNotes: (recordingId: string) => Promise<{ success: boolean; error?: string }>;
  getNotes: (recordingId: string) => Promise<string | null>;
  saveNotes: (recordingId: string, filename: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveToObsidian: (recordingId: string, filename: string) => Promise<{ success: boolean; error?: string }>;
  getCalendarEvents: (bypassCache?: boolean) => Promise<CalendarEvent[]>;
  connectGoogleCalendar: () => Promise<{ success: boolean; error?: string }>;
  connectMicrosoftCalendar: () => Promise<{ success: boolean; error?: string }>;
  disconnectCalendar: (provider: string) => Promise<{ success: boolean }>;
  renameRecording: (recordingId: string, newTitle: string) => Promise<{ success: boolean; error?: string }>;
  renameSpeaker: (recordingId: string, oldName: string, newName: string) => Promise<{ success: boolean }>;
  getSpeakerDirectory: () => Promise<string[]>;
  copyNotesToClipboard: (recordingId: string) => Promise<{ success: boolean; error?: string }>;
  exportAsPDF: (recordingId: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  emailNotes: (recordingId: string) => Promise<{ success: boolean; error?: string }>;
  searchRecordings: (query: string) => Promise<SearchResult[]>;
  setRecordingTags: (recordingId: string, tags: string[]) => Promise<{ success: boolean }>;
  getAllTags: () => Promise<string[]>;
  getAnalyticsStats: () => Promise<AnalyticsStats>;
  getTrendInsights: () => Promise<string>;
  analyzeSentiment: (recordingId: string) => Promise<{ success: boolean; sentiment?: { label: string; explanation: string; analyzedAt: string }; error?: string }>;
  getHighlightsPreview: (startDate: string, endDate: string) => Promise<HighlightsPreview>;
  generateHighlights: (startDate: string, endDate: string) => Promise<{ success: boolean; report?: string; error?: string; meetingCount?: number }>;
  listSavedHighlights: () => Promise<SavedHighlight[]>;
  getSavedHighlight: (id: string) => Promise<string | null>;
  deleteSavedHighlight: (id: string) => Promise<boolean>;
  getProjects: () => Promise<Project[]>;
  createProject: (name: string, notebook: string) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<{ success: boolean }>;
  deleteProject: (id: string) => Promise<{ success: boolean }>;
  moveToProject: (recordingId: string, projectId: string | null) => Promise<{ success: boolean }>;
  generateProjectSummary: (projectId: string) => Promise<{ success: boolean; summary?: string; error?: string }>;
  getProjectSummary: (projectId: string) => Promise<string | null>;
  openInFinder: (filePath: string) => Promise<void>;
  openInObsidian: (vaultName: string, filePath: string) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeAllListeners: (channel: string) => void;
}

export interface Recording {
  id: string;
  title: string;
  date: string;
  duration: number;
  fileSize: number;
  audioPath: string;
  status: 'recorded' | 'transcribing' | 'transcribed' | 'generating' | 'complete';
  calendarEvent?: CalendarEvent;
  userContext?: string;
  speakerNames?: Record<string, string>;
  tags?: string[];
  notebook?: string;
  project?: string;
  transcriptionCost?: {
    provider?: string;
    audioDurationSeconds: number;
    audioDurationHours: number;
    costPerHour: number;
    estimatedCost: number;
    timestamp: string;
  };
  sentiment?: {
    label: string;
    explanation: string;
    analyzedAt: string;
  };
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  description: string;
  provider: 'google' | 'microsoft' | 'ics';
}

export interface TranscriptUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface SearchResult {
  recordingId: string;
  title: string;
  date: string;
  matchType: 'title' | 'tag' | 'notes' | 'transcript';
  snippet: string;
  score: number;
}

export interface AnalyticsStats {
  totalRecordings: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  meetingsPerWeekday: number[];
  meetingsPerWeek: { week: string; count: number; totalMinutes: number }[];
  topTags: { tag: string; count: number }[];
  longestMeeting: { id: string; title: string; duration: number } | null;
  shortestMeeting: { id: string; title: string; duration: number } | null;
  recentTrend: 'increasing' | 'decreasing' | 'stable';
  sentimentDistribution: { label: string; count: number }[];
}

export interface HighlightsPreview {
  meetingCount: number;
  withNotes: number;
  withoutNotes: number;
  meetings: { title: string; date: string; hasNotes: boolean }[];
}

export interface SavedHighlight {
  id: string;
  startDate: string;
  endDate: string;
  label: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  notebook: string;
  createdAt: string;
  lastSummaryAt: string | null;
}

declare global {
  interface Window {
    meetingMind: MeetingMindAPI;
  }
}
