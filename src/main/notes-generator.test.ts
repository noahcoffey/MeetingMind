import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
  },
}));

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

jest.mock('./tagger', () => ({
  autoTagRecording: jest.fn(() => Promise.resolve([])),
}));

import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { getNotes, saveNotes, saveToObsidian, generateNotes } from './notes-generator';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockGetRecording = getRecording as jest.MockedFunction<typeof getRecording>;

describe('getNotes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-notes-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns notes content when file exists', () => {
    const notesContent = '# Meeting Notes\n\nSome notes here.';
    fs.writeFileSync(path.join(tempDir, 'notes.md'), notesContent);

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const notes = getNotes('rec-1');
    expect(notes).toBe(notesContent);
  });

  test('returns null when recording not found', () => {
    mockGetRecording.mockReturnValue(null);
    expect(getNotes('nonexistent')).toBeNull();
  });

  test('returns null when notes file does not exist', () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    expect(getNotes('rec-1')).toBeNull();
  });
});

describe('saveNotes', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-savenotes-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-output-'));
    jest.clearAllMocks();
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'recordingOutputFolder') return outputDir as any;
      return '' as any;
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test('saves notes to output directory', async () => {
    const notesContent = '# Test Notes';
    fs.writeFileSync(path.join(tempDir, 'notes.md'), notesContent);

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = await saveNotes('rec-1', 'test-notes.md');
    expect(result.success).toBe(true);
    expect(result.path).toContain('test-notes.md');

    const saved = fs.readFileSync(result.path!, 'utf-8');
    expect(saved).toBe(notesContent);
  });

  test('returns error when recording not found', async () => {
    mockGetRecording.mockReturnValue(null);
    const result = await saveNotes('nonexistent', 'test.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when notes file missing', async () => {
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = await saveNotes('rec-1', 'test.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('saveToObsidian', () => {
  let tempDir: string;
  let vaultDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-obsidian-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-vault-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('saves notes to Obsidian vault subfolder', async () => {
    const notesContent = '# Obsidian Test';
    fs.writeFileSync(path.join(tempDir, 'notes.md'), notesContent);

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'obsidianVaultPath') return vaultDir as any;
      if (key === 'obsidianSubfolder') return 'Meeting Notes' as any;
      if (key === 'obsidianDailyNotesFolder') return '' as any;
      return '' as any;
    });

    const result = await saveToObsidian('rec-1', 'test-meeting.md');
    expect(result.success).toBe(true);

    const savedPath = path.join(vaultDir, 'Meeting Notes', 'test-meeting.md');
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath, 'utf-8')).toBe(notesContent);
  });

  test('returns error when vault path not configured', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-1', audioPath: '/tmp/audio.m4a' });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'obsidianVaultPath') return '' as any;
      return '' as any;
    });

    const result = await saveToObsidian('rec-1', 'test.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('vault path');
  });

  test('injects backlink into existing daily note', async () => {
    const notesContent = '# Meeting';
    fs.writeFileSync(path.join(tempDir, 'notes.md'), notesContent);

    const today = new Date().toISOString().slice(0, 10);
    const dailyNotePath = path.join(vaultDir, `${today}.md`);
    fs.writeFileSync(dailyNotePath, '# Daily Note\n\n## Meetings\n- existing item');

    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'obsidianVaultPath') return vaultDir as any;
      if (key === 'obsidianSubfolder') return 'Meeting Notes' as any;
      if (key === 'obsidianDailyNotesFolder') return '' as any;
      return '' as any;
    });

    await saveToObsidian('rec-1', 'team-sync.md');

    const dailyContent = fs.readFileSync(dailyNotePath, 'utf-8');
    expect(dailyContent).toContain('[[Meeting Notes/team-sync]]');
  });

  test('returns error when recording not found', async () => {
    mockGetRecording.mockReturnValue(null);
    const result = await saveToObsidian('nonexistent', 'test.md');
    expect(result.success).toBe(false);
  });
});

describe('saveNotes filename sanitization', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sanitize-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-output-'));
    jest.clearAllMocks();
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'recordingOutputFolder') return outputDir as any;
      return '' as any;
    });
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });
    fs.writeFileSync(path.join(tempDir, 'notes.md'), '# Test');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test('strips Obsidian-incompatible characters from filename', async () => {
    const result = await saveNotes('rec-1', 'Meeting: Q1 Review / Plan [Draft] #1.md');
    expect(result.success).toBe(true);
    // Filename portion should not contain : / [ ] #
    const filename = path.basename(result.path!);
    expect(filename).not.toMatch(/[:*?"<>|#^\[\]]/);
    expect(fs.existsSync(result.path!)).toBe(true);
  });

  test('handles filename that is all special characters', async () => {
    const result = await saveNotes('rec-1', ':/[]#.md');
    expect(result.success).toBe(true);
    // Should fall back to "Untitled Meeting"
    expect(result.path).toContain('Untitled Meeting.md');
  });

  test('collapses multiple spaces in filename', async () => {
    const result = await saveNotes('rec-1', 'Meeting   with   spaces.md');
    expect(result.success).toBe(true);
    expect(result.path).toContain('Meeting with spaces.md');
  });
});

describe('generateNotes', () => {
  test('returns error when recording not found', async () => {
    mockGetRecording.mockReturnValue(null);
    const result = await generateNotes('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when transcript missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gen-'));
    mockGetRecording.mockReturnValue({
      id: 'rec-1',
      audioPath: path.join(tempDir, 'audio.m4a'),
    });

    const result = await generateNotes('rec-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Transcript not found');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
