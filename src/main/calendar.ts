import { app, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as url from 'url';
import { log } from './logger';
import { getSetting, setSetting } from './store';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  description: string;
  provider: 'google' | 'microsoft' | 'ics';
}

interface CacheEntry {
  events: CalendarEvent[];
  timestamp: number;
}

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let cachedEvents: CacheEntry | null = null;

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'calendar-cache.json');
}

function loadCache(): CacheEntry | null {
  try {
    const cachePath = getCachePath();
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Date.now() - data.timestamp < CACHE_TTL) {
        return data;
      }
    }
  } catch {}
  return null;
}

function saveCache(events: CalendarEvent[]): void {
  const entry: CacheEntry = { events, timestamp: Date.now() };
  cachedEvents = entry;
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify(entry, null, 2));
  } catch {}
}

export async function getCalendarEvents(bypassCache = false): Promise<CalendarEvent[]> {
  // Check cache first (only if not bypassed, and only non-empty caches)
  if (!bypassCache) {
    if (cachedEvents && cachedEvents.events.length > 0 && Date.now() - cachedEvents.timestamp < CACHE_TTL) {
      log('info', `Returning ${cachedEvents.events.length} cached calendar events`);
      return cachedEvents.events;
    }

    const cached = loadCache();
    if (cached && cached.events.length > 0) {
      cachedEvents = cached;
      log('info', `Returning ${cached.events.length} disk-cached calendar events`);
      return cached.events;
    }
  }

  log('info', 'Fetching fresh calendar events');
  const events: CalendarEvent[] = [];

  // Fetch from ICS calendar if configured
  if (getSetting('icsCalendarEnabled') && getSetting('icsCalendarUrl')) {
    try {
      log('info', 'Fetching ICS calendar events...');
      const icsEvents = await fetchIcsEvents();
      log('info', `Got ${icsEvents.length} ICS events`);
      events.push(...icsEvents);
    } catch (err) {
      log('error', 'Failed to fetch ICS calendar events', err);
    }
  }

  // Fetch from Google Calendar if connected
  if (getSetting('googleCalendarEnabled')) {
    try {
      const googleEvents = await fetchGoogleEvents();
      events.push(...googleEvents);
    } catch (err) {
      log('error', 'Failed to fetch Google Calendar events', err);
    }
  }

  // Fetch from Microsoft Calendar if connected
  if (getSetting('microsoftCalendarEnabled')) {
    try {
      const msEvents = await fetchMicrosoftEvents();
      events.push(...msEvents);
    } catch (err) {
      log('error', 'Failed to fetch Microsoft Calendar events', err);
    }
  }

  // Sort by start time
  events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Only cache non-empty results
  if (events.length > 0) {
    saveCache(events);
  }

  log('info', `Returning ${events.length} calendar events total`);
  return events;
}

export function invalidateCalendarCache(): void {
  cachedEvents = null;
  try {
    const cachePath = getCachePath();
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {}
  log('info', 'Calendar cache invalidated');
}

// ============ ICS Calendar ============

function parseIcsDate(value: string): Date | null {
  // Handle DTSTART;TZID=...:20260309T140000 and DTSTART:20260309T140000Z
  const dateStr = value.includes(':') ? value.split(':').pop()! : value;
  const clean = dateStr.replace(/[^0-9TZ]/g, '');

  if (clean.length >= 15) {
    // Format: 20260309T140000 or 20260309T140000Z
    const year = parseInt(clean.slice(0, 4));
    const month = parseInt(clean.slice(4, 6)) - 1;
    const day = parseInt(clean.slice(6, 8));
    const hour = parseInt(clean.slice(9, 11));
    const min = parseInt(clean.slice(11, 13));
    const sec = parseInt(clean.slice(13, 15));

    if (clean.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, min, sec));
    }
    // Treat as local time if no Z suffix
    return new Date(year, month, day, hour, min, sec);
  } else if (clean.length === 8) {
    // All-day event: 20260309
    const year = parseInt(clean.slice(0, 4));
    const month = parseInt(clean.slice(4, 6)) - 1;
    const day = parseInt(clean.slice(6, 8));
    return new Date(year, month, day);
  }

  return null;
}

function parseIcsEvents(icsText: string, windowStart: Date, windowEnd: Date): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const eventBlocks = icsText.split('BEGIN:VEVENT');

  for (let i = 1; i < eventBlocks.length; i++) {
    const block = eventBlocks[i].split('END:VEVENT')[0];
    const lines = unfoldIcsLines(block);

    let summary = '';
    let description = '';
    let dtstart: Date | null = null;
    let dtend: Date | null = null;
    let uid = '';
    const attendees: string[] = [];

    for (const line of lines) {
      if (line.startsWith('SUMMARY')) {
        summary = extractIcsValue(line);
      } else if (line.startsWith('DESCRIPTION')) {
        description = extractIcsValue(line).replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      } else if (line.startsWith('DTSTART')) {
        dtstart = parseIcsDate(line);
      } else if (line.startsWith('DTEND')) {
        dtend = parseIcsDate(line);
      } else if (line.startsWith('UID')) {
        uid = extractIcsValue(line);
      } else if (line.startsWith('ATTENDEE')) {
        // ATTENDEE;CN=Name:mailto:email@example.com
        const cnMatch = line.match(/CN=([^;:]+)/i);
        const mailtoMatch = line.match(/mailto:([^\s;]+)/i);
        attendees.push(cnMatch ? cnMatch[1] : (mailtoMatch ? mailtoMatch[1] : ''));
      }
    }

    if (!dtstart) continue;
    if (!dtend) dtend = new Date(dtstart.getTime() + 60 * 60 * 1000); // default 1 hour

    // Filter to events within the window
    if (dtend.getTime() >= windowStart.getTime() && dtstart.getTime() <= windowEnd.getTime()) {
      events.push({
        id: uid || `ics-${i}`,
        title: summary || 'Untitled',
        startTime: dtstart.toISOString(),
        endTime: dtend.toISOString(),
        attendees: attendees.filter(Boolean),
        description: description.slice(0, 500),
        provider: 'ics',
      });
    }
  }

  return events;
}

function unfoldIcsLines(block: string): string[] {
  // ICS continuation lines start with a space or tab
  const raw = block.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');
  return raw.split('\n').map(l => l.trim()).filter(Boolean);
}

function extractIcsValue(line: string): string {
  // Handle lines like SUMMARY:My Meeting or SUMMARY;LANGUAGE=en:My Meeting
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return '';
  return line.slice(colonIdx + 1).trim();
}

async function fetchIcsEvents(): Promise<CalendarEvent[]> {
  const icsUrl = getSetting('icsCalendarUrl');
  if (!icsUrl) return [];

  log('info', 'Fetching ICS calendar', { url: icsUrl });

  const response = await fetch(icsUrl);
  if (!response.ok) {
    throw new Error(`ICS fetch failed: ${response.status} ${response.statusText}`);
  }

  const icsText = await response.text();

  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const events = parseIcsEvents(icsText, windowStart, windowEnd);
  log('info', `Parsed ${events.length} events from ICS feed`);
  return events;
}

// ============ Google Calendar ============

async function getGoogleTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const keytar = require('keytar');
    const tokens = await keytar.getPassword('MeetingMind', 'google-calendar-tokens');
    return tokens ? JSON.parse(tokens) : null;
  } catch {
    return null;
  }
}

async function saveGoogleTokens(tokens: any): Promise<void> {
  const keytar = require('keytar');
  await keytar.setPassword('MeetingMind', 'google-calendar-tokens', JSON.stringify(tokens));
}

async function fetchGoogleEvents(): Promise<CalendarEvent[]> {
  const tokens = await getGoogleTokens();
  if (!tokens) return [];

  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh token if needed
  oauth2Client.on('tokens', async (newTokens: any) => {
    const current = await getGoogleTokens();
    await saveGoogleTokens({ ...current, ...newTokens });
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = new Date();
  const timeMin = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // -2 hours
  const timeMax = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2 hours

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.data.items || []).map((event: any) => ({
      id: event.id,
      title: event.summary || 'Untitled',
      startTime: event.start?.dateTime || event.start?.date,
      endTime: event.end?.dateTime || event.end?.date,
      attendees: (event.attendees || []).map((a: any) => a.displayName || a.email),
      description: event.description || '',
      provider: 'google' as const,
    }));
  } catch (err) {
    log('error', 'Google Calendar API error', err);
    return [];
  }
}

export async function connectGoogle(): Promise<{ success: boolean; error?: string }> {
  // Note: In a real app, you'd register an OAuth client and use real credentials.
  // This is the framework — the user needs to set up a Google Cloud project
  // and configure their own client ID and secret.
  try {
    const { google } = require('googleapis');

    // These would be configured by the user or bundled with the app
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return { success: false, error: 'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.' };
    }

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      'http://localhost:18234/oauth/callback'
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events.readonly'],
      prompt: 'consent',
    });

    // Start local server to receive callback
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        if (parsedUrl.pathname === '/oauth/callback') {
          const code = parsedUrl.query.code as string;

          try {
            const { tokens } = await oauth2Client.getToken(code);
            await saveGoogleTokens(tokens);
            setSetting('googleCalendarEnabled', true);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Connected!</h1><p>You can close this window.</p></body></html>');

            server.close();
            resolve({ success: true });
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Error</h1><p>Failed to connect.</p></body></html>');
            server.close();
            resolve({ success: false, error: err.message });
          }
        }
      });

      server.listen(18234, () => {
        shell.openExternal(authUrl);
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'OAuth timed out' });
      }, 120000);
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ============ Microsoft Calendar ============

async function getMicrosoftTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const keytar = require('keytar');
    const tokens = await keytar.getPassword('MeetingMind', 'microsoft-calendar-tokens');
    return tokens ? JSON.parse(tokens) : null;
  } catch {
    return null;
  }
}

async function saveMicrosoftTokens(tokens: any): Promise<void> {
  const keytar = require('keytar');
  await keytar.setPassword('MeetingMind', 'microsoft-calendar-tokens', JSON.stringify(tokens));
}

async function fetchMicrosoftEvents(): Promise<CalendarEvent[]> {
  const tokens = await getMicrosoftTokens();
  if (!tokens) return [];

  const { Client } = require('@microsoft/microsoft-graph-client');

  const client = Client.init({
    authProvider: (done: any) => {
      done(null, tokens.access_token);
    },
  });

  const now = new Date();
  const startDateTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const endDateTime = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  try {
    const response = await client
      .api('/me/calendarView')
      .query({ startDateTime, endDateTime })
      .select('id,subject,start,end,attendees,bodyPreview')
      .orderby('start/dateTime')
      .get();

    return (response.value || []).map((event: any) => ({
      id: event.id,
      title: event.subject || 'Untitled',
      startTime: event.start?.dateTime,
      endTime: event.end?.dateTime,
      attendees: (event.attendees || []).map((a: any) =>
        a.emailAddress?.name || a.emailAddress?.address || ''
      ),
      description: event.bodyPreview || '',
      provider: 'microsoft' as const,
    }));
  } catch (err) {
    log('error', 'Microsoft Calendar API error', err);
    return [];
  }
}

export async function connectMicrosoft(): Promise<{ success: boolean; error?: string }> {
  try {
    const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || '';

    if (!CLIENT_ID) {
      return { success: false, error: 'Microsoft OAuth credentials not configured. Set MICROSOFT_CLIENT_ID environment variable.' };
    }

    const REDIRECT_URI = 'http://localhost:18235/oauth/callback';
    const SCOPES = 'Calendars.Read offline_access';

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&response_mode=query`;

    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        if (parsedUrl.pathname === '/oauth/callback') {
          const code = parsedUrl.query.code as string;

          try {
            const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: CLIENT_ID,
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
                scope: SCOPES,
              }),
            });

            const tokens = await tokenResponse.json() as any;
            if (tokens.error) throw new Error(tokens.error_description);

            await saveMicrosoftTokens(tokens);
            setSetting('microsoftCalendarEnabled', true);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Connected!</h1><p>You can close this window.</p></body></html>');

            server.close();
            resolve({ success: true });
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Error</h1><p>Failed to connect.</p></body></html>');
            server.close();
            resolve({ success: false, error: err.message });
          }
        }
      });

      server.listen(18235, () => {
        shell.openExternal(authUrl);
      });

      setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'OAuth timed out' });
      }, 120000);
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function disconnectCalendar(provider: string): Promise<{ success: boolean }> {
  try {
    const keytar = require('keytar');
    if (provider === 'google') {
      await keytar.deletePassword('MeetingMind', 'google-calendar-tokens');
      setSetting('googleCalendarEnabled', false);
    } else if (provider === 'microsoft') {
      await keytar.deletePassword('MeetingMind', 'microsoft-calendar-tokens');
      setSetting('microsoftCalendarEnabled', false);
    }
    cachedEvents = null;
    return { success: true };
  } catch {
    return { success: true };
  }
}
