export interface MeetingMindAPI {
  getSettings: () => Promise<Record<string, unknown>>;
  setSetting: (key: string, value: unknown) => Promise<boolean>;
  getApiKey: (service: string) => Promise<string | null>;
  setApiKey: (service: string, value: string) => Promise<boolean>;
  deleteApiKey: (service: string) => Promise<boolean>;
  getAudioDevices: () => Promise<MediaDeviceInfo[]>;
  startRecording: (deviceId?: string) => Promise<{ success: boolean; error?: string }>;
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
  generateNotes: (recordingId: string) => Promise<{ success: boolean; error?: string }>;
  getNotes: (recordingId: string) => Promise<string | null>;
  saveNotes: (recordingId: string, filename: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveToObsidian: (recordingId: string, filename: string) => Promise<{ success: boolean; error?: string }>;
  getCalendarEvents: (bypassCache?: boolean) => Promise<CalendarEvent[]>;
  connectGoogleCalendar: () => Promise<{ success: boolean; error?: string }>;
  connectMicrosoftCalendar: () => Promise<{ success: boolean; error?: string }>;
  disconnectCalendar: (provider: string) => Promise<{ success: boolean }>;
  renameSpeaker: (recordingId: string, oldName: string, newName: string) => Promise<{ success: boolean }>;
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

declare global {
  interface Window {
    meetingMind: MeetingMindAPI;
  }
}
