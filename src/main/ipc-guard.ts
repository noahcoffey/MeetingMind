// Checks on what the renderer can ask main to do. The renderer is our own
// page, but it renders text other people wrote (transcripts, calendar
// invites, LLM output), so main treats each request as untrusted input: the
// arguments are validated here, and only our own page may call at all.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recordings and projects are named by crypto.randomUUID(). */
export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * A name that can only ever mean one directory directly inside its parent —
 * no separators, no `.`/`..`. The last line of defence for anything that
 * becomes `path.join(root, id)`.
 */
export function isSafePathSegment(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

/** Keychain accounts the renderer may set, delete or ask about. Calendar OAuth tokens stay main-only. */
export const RENDERER_KEY_SERVICES = new Set([
  'anthropic',
  'assemblyai',
  'openai',
  'deepgram',
  'huggingface',
  'meetinghub',
]);

/** URLs the app will hand to the OS to open. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** A MeetingHub base URL the API key may be sent to: https, or plain http to this machine. */
export function isAllowedMeetingHubUrl(value: unknown): boolean {
  if (value === '' || value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Whether a settings write from the renderer should be accepted: the key has
 * to be a real setting, and a few values that steer where data or keys go
 * are checked.
 */
export function checkSettingWrite(key: unknown, value: unknown, knownKeys: Set<string>): string | null {
  if (typeof key !== 'string' || !knownKeys.has(key)) return `Unknown setting: ${String(key)}`;
  if (key === 'meetinghubBaseUrl' && !isAllowedMeetingHubUrl(value)) {
    return 'MeetingHub URL must use https://';
  }
  if ((key === 'recordingOutputFolder' || key === 'obsidianVaultPath') && value !== '' &&
      (typeof value !== 'string' || !value.startsWith('/') || value === '/')) {
    return `${key} must be an absolute folder path`;
  }
  return null;
}

/** Only our own page may call into main: the bundled renderer, or the dev server in development. */
export function isTrustedSenderUrl(url: string | undefined, dev: boolean): boolean {
  if (!url) return false;
  if (dev && url.startsWith('http://localhost:9000/')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html');
  } catch {
    return false;
  }
}
