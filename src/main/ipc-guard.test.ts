import {
  isUuid, isSafePathSegment, isSafeExternalUrl, isAllowedMeetingHubUrl,
  checkSettingWrite, isTrustedSenderUrl, RENDERER_KEY_SERVICES,
} from './ipc-guard';

describe('recording ids', () => {
  test('accepts the UUIDs recordings are named with', () => {
    expect(isUuid('0032dea4-28a3-49a1-b392-f9e066e6df0f')).toBe(true);
  });

  test('refuses anything that could walk out of the recordings folder', () => {
    for (const bad of ['..', '../..', '../../..', '/', '', 'a/b', '0032dea4-28a3-49a1-b392-f9e066e6df0f/..', null, undefined, 42]) {
      expect(isUuid(bad)).toBe(false);
      expect(isSafePathSegment(bad)).toBe(false);
    }
  });

  test('a safe segment is one plain name', () => {
    expect(isSafePathSegment('rec-1')).toBe(true);
    expect(isSafePathSegment('.hidden')).toBe(false);
    expect(isSafePathSegment('a\\b')).toBe(false);
  });
});

describe('external URLs', () => {
  test('opens https and mailto', () => {
    expect(isSafeExternalUrl('https://hf.co/pyannote/speaker-diarization-community-1')).toBe(true);
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  test('refuses everything that could run or read something', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'smb://host/share', 'x-apple.systempreferences:', 'not a url', 7]) {
      expect(isSafeExternalUrl(bad)).toBe(false);
    }
  });
});

describe('settings writes', () => {
  const keys = new Set(['meetinghubBaseUrl', 'clubtoolsBaseUrl', 'recordingOutputFolder', 'obsidianVaultPath', 'theme']);

  test('only real settings', () => {
    expect(checkSettingWrite('theme', 'dark', keys)).toBeNull();
    expect(checkSettingWrite('__proto__', {}, keys)).toMatch(/Unknown/);
    expect(checkSettingWrite('madeUp', 1, keys)).toMatch(/Unknown/);
  });

  test('the MeetingHub key only goes over https (or to this machine)', () => {
    expect(isAllowedMeetingHubUrl('https://hub.example.com')).toBe(true);
    expect(isAllowedMeetingHubUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedMeetingHubUrl('')).toBe(true);
    expect(checkSettingWrite('meetinghubBaseUrl', 'http://evil.example.com', keys)).toMatch(/https/);
  });

  test('the Club Tools token only goes over https (or to this machine)', () => {
    expect(checkSettingWrite('clubtoolsBaseUrl', 'https://tools.avonkiwanis.org', keys)).toBeNull();
    expect(checkSettingWrite('clubtoolsBaseUrl', 'http://localhost:3000', keys)).toBeNull();
    expect(checkSettingWrite('clubtoolsBaseUrl', 'http://tools.avonkiwanis.org', keys)).toMatch(/https/);
  });

  test('folders must be absolute and not the disk root', () => {
    expect(checkSettingWrite('recordingOutputFolder', '/Users/noah/Documents/MeetingMind', keys)).toBeNull();
    expect(checkSettingWrite('recordingOutputFolder', '/', keys)).not.toBeNull();
    expect(checkSettingWrite('obsidianVaultPath', 'relative/path', keys)).not.toBeNull();
    expect(checkSettingWrite('obsidianVaultPath', '', keys)).toBeNull();
  });
});

describe('IPC senders', () => {
  test('only our bundled page, or the dev server in development', () => {
    expect(isTrustedSenderUrl('file:///Applications/MeetingMind.app/Contents/Resources/app.asar/dist/renderer/index.html', false)).toBe(true);
    expect(isTrustedSenderUrl('file:///Users/noah/Downloads/evil.html', false)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:9000/', false)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:9000/', true)).toBe(true);
    expect(isTrustedSenderUrl('https://example.com/renderer/index.html', false)).toBe(false);
    expect(isTrustedSenderUrl(undefined, false)).toBe(false);
  });
});

test('the renderer can save the Club Tools token', () => {
  expect(RENDERER_KEY_SERVICES.has('clubtools')).toBe(true);
});

test('calendar tokens are not among the keys the renderer can touch', () => {
  expect(RENDERER_KEY_SERVICES.has('google-calendar-tokens')).toBe(false);
  expect(RENDERER_KEY_SERVICES.has('microsoft-calendar-tokens')).toBe(false);
});
