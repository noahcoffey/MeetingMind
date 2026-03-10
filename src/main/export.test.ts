// Test the markdownToHtml converter by extracting it via the export module
// Since markdownToHtml is private, we test it indirectly through copyNotesToClipboard
// and also test the module's public API behavior

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

// Mock electron modules
jest.mock('electron', () => ({
  clipboard: {
    writeText: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
  BrowserWindow: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { clipboard } from 'electron';
import { copyNotesToClipboard, emailNotes } from './export';
import { getRecording } from './recording-manager';

const mockGetRecording = getRecording as jest.MockedFunction<typeof getRecording>;
const mockWriteText = clipboard.writeText as jest.MockedFunction<typeof clipboard.writeText>;

describe('copyNotesToClipboard', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-export-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('copies notes content to clipboard', () => {
    const notesContent = '# Meeting Notes\n\nAction items discussed.';
    fs.writeFileSync(path.join(tempDir, 'notes.md'), notesContent);

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = copyNotesToClipboard('rec-1');
    expect(result.success).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith(notesContent);
  });

  test('returns error when recording not found', () => {
    mockGetRecording.mockReturnValue(null);

    const result = copyNotesToClipboard('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when notes file missing', () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });
    // No notes.md file created

    const result = copyNotesToClipboard('rec-1');
    expect(result.success).toBe(false);
  });
});

describe('emailNotes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-email-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns error when recording not found', () => {
    mockGetRecording.mockReturnValue(null);

    const result = emailNotes('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when notes missing', () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      title: 'Test',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = emailNotes('rec-1');
    expect(result.success).toBe(false);
  });

  test('opens email with notes content', () => {
    const { shell } = require('electron');
    fs.writeFileSync(path.join(tempDir, 'notes.md'), 'Meeting summary here.');
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({
      calendarEvent: {
        title: 'Team Sync',
        attendees: ['alice@test.com', 'bob@test.com'],
      },
    }));

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      title: 'Team Sync',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = emailNotes('rec-1');
    expect(result.success).toBe(true);
    expect(shell.openExternal).toHaveBeenCalled();

    const mailtoUrl = shell.openExternal.mock.calls[0][0];
    expect(mailtoUrl).toContain('mailto:');
    expect(mailtoUrl).toContain('alice@test.com');
    expect(mailtoUrl).toContain('bob@test.com');
    expect(mailtoUrl).toContain('Team%20Sync');
  });
});
