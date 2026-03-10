import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setTags, getAllTags } from './tagger';

// Mock dependencies
jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

import { getSetting } from './store';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;

describe('setTags', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tagger-test-'));
    mockGetSetting.mockReturnValue(tempDir as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createRecording(id: string, manifest: Record<string, unknown>) {
    const dir = path.join(tempDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  }

  test('sets tags on a recording manifest', () => {
    createRecording('rec-1', { id: 'rec-1', title: 'Test' });

    const result = setTags('rec-1', ['engineering', 'sprint']);
    expect(result.success).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'rec-1', 'manifest.json'), 'utf-8'));
    expect(manifest.tags).toEqual(['engineering', 'sprint']);
  });

  test('overwrites existing tags', () => {
    createRecording('rec-2', { id: 'rec-2', title: 'Test', tags: ['old-tag'] });

    setTags('rec-2', ['new-tag']);

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'rec-2', 'manifest.json'), 'utf-8'));
    expect(manifest.tags).toEqual(['new-tag']);
  });

  test('returns failure for nonexistent recording', () => {
    const result = setTags('nonexistent', ['tag']);
    expect(result.success).toBe(false);
  });

  test('can set empty tags array', () => {
    createRecording('rec-3', { id: 'rec-3', title: 'Test', tags: ['remove-me'] });

    const result = setTags('rec-3', []);
    expect(result.success).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'rec-3', 'manifest.json'), 'utf-8'));
    expect(manifest.tags).toEqual([]);
  });
});

describe('getAllTags', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tagger-tags-'));
    mockGetSetting.mockReturnValue(tempDir as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createRecording(id: string, manifest: Record<string, unknown>) {
    const dir = path.join(tempDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  }

  test('returns empty array when no recordings', () => {
    expect(getAllTags()).toEqual([]);
  });

  test('collects unique tags from all recordings', () => {
    createRecording('rec-1', { tags: ['engineering', 'sprint'] });
    createRecording('rec-2', { tags: ['engineering', 'design'] });
    createRecording('rec-3', { tags: ['sprint', 'planning'] });

    const tags = getAllTags();
    expect(tags).toEqual(['design', 'engineering', 'planning', 'sprint']); // sorted
  });

  test('handles recordings without tags', () => {
    createRecording('rec-1', { title: 'No tags here' });
    createRecording('rec-2', { tags: ['has-tag'] });

    const tags = getAllTags();
    expect(tags).toEqual(['has-tag']);
  });

  test('ignores non-string tags', () => {
    createRecording('rec-1', { tags: ['valid', 123, null, 'also-valid'] });

    const tags = getAllTags();
    expect(tags).toEqual(['also-valid', 'valid']);
  });

  test('handles malformed manifest JSON', () => {
    const dir = path.join(tempDir, 'bad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{bad json');

    expect(() => getAllTags()).not.toThrow();
    expect(getAllTags()).toEqual([]);
  });
});
