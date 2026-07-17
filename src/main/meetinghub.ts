import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';

// Status MeetingMind records on a recording's manifest after a push attempt.
// `skipped` means we deliberately did not send (e.g. a Google/Microsoft calendar
// recording, which MeetingHub keys on iCal UID and cannot match).
export interface MeetingHubStatus {
  status: 'sent' | 'pending' | 'skipped' | 'error';
  at: string;
  detail?: string;
  sourceId?: string;
  meetingId?: string;
  pendingId?: string;
}

// One row in the MeetingHub activity log (in-app viewer). Captures every push
// attempt, whether or not an HTTP request was actually made (httpStatus is null
// for skipped/no-key attempts that never hit the network).
export interface MeetingHubLogEntry {
  id: string;
  at: string;
  trigger: 'auto' | 'manual';
  recordingId: string;
  recordingTitle: string;
  outcome: 'sent' | 'pending' | 'skipped' | 'error';
  sourceId?: string;
  endpoint?: string;
  httpStatus: number | null;
  notesChars?: number;
  detail?: string;
  // Full request/response payloads for inspection. `request` is present once a
  // body was built (i.e. we reached the HTTP call). `response` is present when
  // the server replied (absent for network errors and pre-HTTP outcomes).
  request?: { method: string; url: string; body: Record<string, unknown> };
  response?: { status: number; statusText?: string; body: unknown };
}

const KEYTAR_SERVICE = 'MeetingMind';
const KEYTAR_ACCOUNT = 'meetinghub';
const ACTIVITY_LOG_LIMIT = 200; // keep the most recent N entries

function sendToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

async function getApiKey(): Promise<string | null> {
  try {
    const keytar = require('keytar');
    return await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    return null;
  }
}

function getActivityLogPath(): string {
  return path.join(app.getPath('userData'), 'meetinghub-activity.json');
}

export function getMeetingHubActivity(): MeetingHubLogEntry[] {
  const logPath = getActivityLogPath();
  if (!fs.existsSync(logPath)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function clearMeetingHubActivity(): { success: boolean } {
  try {
    const logPath = getActivityLogPath();
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    sendToRenderer('meetinghub:activity', { cleared: true });
    return { success: true };
  } catch (err: any) {
    log('warn', 'Failed to clear MeetingHub activity log', { error: err.message });
    return { success: false };
  }
}

// Newest-first, bounded append. A corrupt/unreadable log is replaced rather than
// blocking the push it's trying to record.
function appendActivity(entry: MeetingHubLogEntry): void {
  const logPath = getActivityLogPath();
  const entries = getMeetingHubActivity();
  entries.unshift(entry);
  const trimmed = entries.slice(0, ACTIVITY_LOG_LIMIT);
  try {
    fs.writeFileSync(logPath, JSON.stringify(trimmed, null, 2));
  } catch (err: any) {
    log('warn', 'Failed to write MeetingHub activity log', { error: err.message });
  }
  sendToRenderer('meetinghub:activity', { entry });
}

function recordStatus(recordingId: string, status: MeetingHubStatus): void {
  const recording = getRecording(recordingId);
  if (!recording) return;
  const manifestPath = path.join(path.dirname(recording.audioPath), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.meetinghub = status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err: any) {
    log('warn', 'Failed to record MeetingHub status', { recordingId, error: err.message });
  }
  sendToRenderer('meetinghub:status', { recordingId, meetinghub: status });
}

// Push a recording's generated notes to MeetingHub's ingest endpoint.
// Idempotent on the server: re-sending the same sourceId never duplicates or
// clobbers existing notes (see MeetingHub's MEETINGMIND_API.md).
export async function sendToMeetingHub(
  recordingId: string,
  opts: { manual?: boolean } = {},
): Promise<{ success: boolean; status?: MeetingHubStatus['status']; detail?: string; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const trigger: MeetingHubLogEntry['trigger'] = opts.manual ? 'manual' : 'auto';
  const recordingTitle = recording.title || recording.calendarEvent?.title || 'Untitled Meeting';

  // Log every attempt outcome to the activity feed, keeping the manifest status
  // and the log in lock-step.
  const logOutcome = (
    outcome: MeetingHubLogEntry['outcome'],
    fields: {
      sourceId?: string;
      endpoint?: string;
      httpStatus?: number | null;
      notesChars?: number;
      detail?: string;
      request?: MeetingHubLogEntry['request'];
      response?: MeetingHubLogEntry['response'];
    },
  ) => {
    appendActivity({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      trigger,
      recordingId,
      recordingTitle,
      outcome,
      sourceId: fields.sourceId,
      endpoint: fields.endpoint,
      httpStatus: fields.httpStatus ?? null,
      notesChars: fields.notesChars,
      detail: fields.detail,
      request: fields.request,
      response: fields.response,
    });
  };

  const notesPath = path.join(path.dirname(recording.audioPath), 'notes.md');
  if (!fs.existsSync(notesPath)) {
    const error = 'No notes have been generated for this recording yet.';
    logOutcome('error', { httpStatus: null, detail: error });
    return { success: false, error };
  }
  let notes: string;
  try {
    notes = fs.readFileSync(notesPath, 'utf-8');
  } catch (err: any) {
    const error = `Could not read notes: ${err.message}`;
    logOutcome('error', { httpStatus: null, detail: error });
    return { success: false, error };
  }
  if (!notes.trim()) {
    const error = 'Notes file is empty.';
    logOutcome('error', { httpStatus: null, detail: error });
    return { success: false, error };
  }
  const notesChars = notes.length;

  // Determine sourceId. MeetingHub keys calendar meetings on the iCal UID, which
  // for ICS-feed events is exactly the value we stored as calendarEventId.
  // Google/Microsoft event ids are NOT iCal UIDs, so those are skipped.
  const provider = recording.calendarEventProvider as string | undefined;
  let sourceId: string;
  if (recording.calendarEventId) {
    if (provider === 'google' || provider === 'microsoft') {
      const detail = `Skipped: ${provider} calendar meetings can't be matched by MeetingHub (no iCal UID).`;
      const status: MeetingHubStatus = { status: 'skipped', at: new Date().toISOString(), detail };
      recordStatus(recordingId, status);
      logOutcome('skipped', { httpStatus: null, notesChars, detail });
      log('info', 'MeetingHub push skipped (non-ICS calendar)', { recordingId, provider });
      return { success: true, status: 'skipped', detail };
    }
    // provider === 'ics' (or undefined for legacy recordings, where the
    // configured feed is ICS) — calendarEventId is the iCal UID.
    sourceId = recording.calendarEventId;
  } else {
    // Manual meeting with no calendar link — use MeetingMind's own stable id.
    sourceId = recording.id;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    const error = 'MeetingHub API key is not set. Add it in Settings → MeetingHub.';
    logOutcome('error', { sourceId, httpStatus: null, notesChars, detail: error });
    if (opts.manual) return { success: false, error };
    log('warn', 'MeetingHub auto-push skipped: no API key configured', { recordingId });
    return { success: false, error };
  }

  const baseUrl = (getSetting('meetinghubBaseUrl') || 'https://hub.noahcoffey.com').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/ingest`;

  const body: Record<string, unknown> = {
    sourceId,
    notesGenerated: notes,
    // title/startTime are only used by MeetingHub for the unmatched case, but
    // they're harmless to always include and improve the review-inbox display.
    title: recordingTitle,
    startTime: recording.date,
    // MeetingHub workspace routing: the notebook name maps to a MeetingHub
    // workspace (matched by name, case-insensitive). Unknown names are
    // harmless — the push just lands untagged in the review inbox.
    workspace: recording.notebook || getSetting('activeNotebook') || 'Personal',
  };
  const request: MeetingHubLogEntry['request'] = { method: 'POST', url: endpoint, body };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Read the raw text first so we still capture a non-JSON body for the log.
    const rawText = await response.text();
    let json: any = {};
    let parsedBody: unknown = rawText;
    try {
      json = rawText ? JSON.parse(rawText) : {};
      parsedBody = json;
    } catch {
      json = {};
    }
    const responseInfo: MeetingHubLogEntry['response'] = {
      status: response.status,
      statusText: response.statusText,
      body: parsedBody,
    };

    if (response.status === 200) {
      const detail = json.written
        ? 'Notes saved to MeetingHub.'
        : 'Matched in MeetingHub (notes already present — left unchanged).';
      const status: MeetingHubStatus = {
        status: 'sent', at: new Date().toISOString(), detail, sourceId, meetingId: json.meetingId,
      };
      recordStatus(recordingId, status);
      logOutcome('sent', { sourceId, endpoint, httpStatus: 200, notesChars, detail, request, response: responseInfo });
      log('info', 'MeetingHub push matched', { recordingId, sourceId, written: json.written });
      return { success: true, status: 'sent', detail };
    }

    if (response.status === 202) {
      const detail = 'Queued in MeetingHub for review (no matching meeting yet).';
      const status: MeetingHubStatus = {
        status: 'pending', at: new Date().toISOString(), detail, sourceId, pendingId: json.pendingId,
      };
      recordStatus(recordingId, status);
      logOutcome('pending', { sourceId, endpoint, httpStatus: 202, notesChars, detail, request, response: responseInfo });
      log('info', 'MeetingHub push queued for review', { recordingId, sourceId });
      return { success: true, status: 'pending', detail };
    }

    const error = json.error || `MeetingHub returned HTTP ${response.status}`;
    const status: MeetingHubStatus = { status: 'error', at: new Date().toISOString(), detail: error, sourceId };
    recordStatus(recordingId, status);
    logOutcome('error', { sourceId, endpoint, httpStatus: response.status, notesChars, detail: error, request, response: responseInfo });
    log('error', 'MeetingHub push failed', { recordingId, httpStatus: response.status, error });
    return { success: false, status: 'error', error };
  } catch (err: any) {
    const error = `Could not reach MeetingHub: ${err.message}`;
    const status: MeetingHubStatus = { status: 'error', at: new Date().toISOString(), detail: error, sourceId };
    recordStatus(recordingId, status);
    logOutcome('error', { sourceId, endpoint, httpStatus: null, notesChars, detail: error, request });
    log('error', 'MeetingHub push network error', { recordingId, error: err.message });
    return { success: false, status: 'error', error };
  }
}
