// Sends a meeting's generated notes to Club Tools (the Kiwanis secretary toolkit, `sok`,
// at tools.avonkiwanis.org). Club Tools holds them in an inbox, suggests the club meeting
// recorded that day, and an admin accepts them into that meeting's Minutes doc there —
// so a send never writes minutes by itself.
//
// Endpoint: POST {base}/api/meetingmind/submissions with a personal API token
// (`Authorization: Bearer sok_...`, created under Settings in Club Tools). Re-sending a
// recording updates its inbox entry while it is still pending and is ignored after it
// was accepted or dismissed.
import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';

export const DEFAULT_CLUBTOOLS_URL = 'https://tools.avonkiwanis.org';
const KEYTAR_SERVICE = 'MeetingMind';
const KEYTAR_ACCOUNT = 'clubtools';

/** Recorded on the manifest as `clubtools` after each send attempt. */
export interface ClubToolsStatus {
  // sent = waiting in the Club Tools inbox; accepted/dismissed = an admin already handled it
  status: 'sent' | 'accepted' | 'dismissed' | 'error';
  at: string;
  detail?: string;
  submissionId?: string;
}

export interface ClubToolsSubmission {
  externalId: string;
  title: string;
  recordedAt: string;
  notebook: string | null;
  notesMarkdown: string;
}

export function buildSubmission(
  recording: { id: string; title?: string; date: string; notebook?: string; calendarEvent?: { title?: string } },
  notes: string,
): ClubToolsSubmission {
  return {
    externalId: recording.id,
    // Club Tools stores titles as VARCHAR(191)
    title: (recording.title || recording.calendarEvent?.title || 'Untitled Meeting').slice(0, 191),
    recordedAt: new Date(recording.date).toISOString(),
    notebook: recording.notebook || null,
    notesMarkdown: notes,
  };
}

/** What a Club Tools reply means for the recording. */
export function interpretResponse(httpStatus: number, json: any): ClubToolsStatus {
  const at = new Date().toISOString();
  if ((httpStatus === 200 || httpStatus === 201) && json?.ok) {
    if (json.status === 'accepted') {
      return { status: 'accepted', at, submissionId: json.id, detail: 'Already accepted into the minutes in Club Tools — left unchanged.' };
    }
    if (json.status === 'dismissed') {
      return { status: 'dismissed', at, submissionId: json.id, detail: 'Dismissed in Club Tools — left unchanged.' };
    }
    return {
      status: 'sent',
      at,
      submissionId: json.id,
      detail: json.updated
        ? 'Updated in the Club Tools inbox, waiting to be accepted.'
        : 'In the Club Tools inbox, waiting to be accepted.',
    };
  }
  if (httpStatus === 401) {
    return { status: 'error', at, detail: 'Club Tools rejected the API token. Create a new one under Settings in Club Tools.' };
  }
  if (httpStatus === 403) {
    return { status: 'error', at, detail: 'The Club Tools API token belongs to a user who is not an admin.' };
  }
  return { status: 'error', at, detail: json?.error || `Club Tools returned HTTP ${httpStatus}` };
}

function sendToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

async function getApiToken(): Promise<string | null> {
  try {
    const keytar = require('keytar');
    return await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    return null;
  }
}

function recordStatus(recordingId: string, status: ClubToolsStatus): void {
  const recording = getRecording(recordingId);
  if (!recording) return;
  const manifestPath = path.join(path.dirname(recording.audioPath), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.clubtools = status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err: any) {
    log('warn', 'Failed to record Club Tools status', { recordingId, error: err.message });
  }
  sendToRenderer('clubtools:status', { recordingId, clubtools: status });
}

export async function sendToClubTools(
  recordingId: string,
): Promise<{ success: boolean; status?: ClubToolsStatus['status']; detail?: string; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const notesPath = path.join(path.dirname(recording.audioPath), 'notes.md');
  let notes = '';
  try {
    if (fs.existsSync(notesPath)) notes = fs.readFileSync(notesPath, 'utf-8');
  } catch (err: any) {
    return { success: false, error: `Could not read notes: ${err.message}` };
  }
  if (!notes.trim()) return { success: false, error: 'No notes have been generated for this recording yet.' };

  const token = await getApiToken();
  if (!token) return { success: false, error: 'Club Tools API token is not set. Add it in Settings → Club Tools.' };

  const baseUrl = (getSetting('clubtoolsBaseUrl') || DEFAULT_CLUBTOOLS_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/meetingmind/submissions`;

  let status: ClubToolsStatus;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSubmission(recording, notes)),
    });
    const json = await response.json().catch(() => ({}));
    status = interpretResponse(response.status, json);
    log(status.status === 'error' ? 'error' : 'info', 'Club Tools send', {
      recordingId, httpStatus: response.status, status: status.status,
    });
  } catch (err: any) {
    status = { status: 'error', at: new Date().toISOString(), detail: `Could not reach Club Tools: ${err.message}` };
    log('error', 'Club Tools send network error', { recordingId, error: err.message });
  }

  recordStatus(recordingId, status);
  return status.status === 'error'
    ? { success: false, status: status.status, error: status.detail }
    : { success: true, status: status.status, detail: status.detail };
}
