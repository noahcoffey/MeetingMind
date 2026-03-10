import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { searchRecordings } from './search';

// Mock dependencies
jest.mock('./store', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

import { getSetting } from './store';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;

describe('searchRecordings', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-search-test-'));
    mockGetSetting.mockReturnValue(tempDir as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createRecording(id: string, manifest: Record<string, unknown>, files?: Record<string, string>) {
    const dir = path.join(tempDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    if (files) {
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
      }
    }
  }

  test('returns empty array for empty query', () => {
    expect(searchRecordings('')).toEqual([]);
    expect(searchRecordings('  ')).toEqual([]);
  });

  test('matches recording by title', () => {
    createRecording('rec-1', {
      id: 'rec-1',
      title: 'Weekly Standup Meeting',
      date: '2025-01-01T10:00:00Z',
    });

    const results = searchRecordings('standup');
    expect(results).toHaveLength(1);
    expect(results[0].recordingId).toBe('rec-1');
    expect(results[0].matchType).toBe('title');
    expect(results[0].score).toBeGreaterThanOrEqual(100);
  });

  test('matches recording by tag', () => {
    createRecording('rec-2', {
      id: 'rec-2',
      title: 'Some Meeting',
      date: '2025-01-01T10:00:00Z',
      tags: ['engineering', 'sprint-planning'],
    });

    const results = searchRecordings('sprint');
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('tag');
    expect(results[0].score).toBeGreaterThanOrEqual(80);
  });

  test('matches recording by notes content', () => {
    createRecording('rec-3', {
      id: 'rec-3',
      title: 'Team Sync',
      date: '2025-01-01T10:00:00Z',
    }, {
      'notes.md': '# Meeting Notes\n\nDiscussed the new authentication system and SSO integration.',
    });

    const results = searchRecordings('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('notes');
    expect(results[0].snippet).toContain('**authentication**');
  });

  test('matches recording by transcript', () => {
    createRecording('rec-4', {
      id: 'rec-4',
      title: 'Design Review',
      date: '2025-01-01T10:00:00Z',
    }, {
      'transcript.json': JSON.stringify({
        utterances: [
          { speaker: 'A', text: 'We need to redesign the dashboard layout.' },
          { speaker: 'B', text: 'I agree, the current one is confusing.' },
        ],
      }),
    });

    const results = searchRecordings('dashboard');
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('transcript');
    expect(results[0].score).toBeGreaterThanOrEqual(40);
  });

  test('returns multiple match types for same recording', () => {
    createRecording('rec-5', {
      id: 'rec-5',
      title: 'Budget Review',
      date: '2025-01-01T10:00:00Z',
      tags: ['budget'],
    }, {
      'notes.md': 'Reviewed the Q4 budget allocations.',
    });

    const results = searchRecordings('budget');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const matchTypes = results.map(r => r.matchType);
    expect(matchTypes).toContain('title');
    expect(matchTypes).toContain('tag');
  });

  test('ranks title matches above notes matches', () => {
    createRecording('title-match', {
      id: 'title-match',
      title: 'Deployment Pipeline',
      date: '2025-01-01T10:00:00Z',
    });
    createRecording('notes-match', {
      id: 'notes-match',
      title: 'Random Meeting',
      date: '2025-01-01T10:00:00Z',
    }, {
      'notes.md': 'We discussed the deployment pipeline improvements.',
    });

    const results = searchRecordings('deployment');
    expect(results[0].matchType).toBe('title');
    expect(results[1].matchType).toBe('notes');
  });

  test('is case insensitive', () => {
    createRecording('rec-case', {
      id: 'rec-case',
      title: 'API Design Discussion',
      date: '2025-01-01T10:00:00Z',
    });

    expect(searchRecordings('api')).toHaveLength(1);
    expect(searchRecordings('API')).toHaveLength(1);
    expect(searchRecordings('Api')).toHaveLength(1);
  });

  test('limits results to 20', () => {
    for (let i = 0; i < 25; i++) {
      createRecording(`rec-${i}`, {
        id: `rec-${i}`,
        title: `Meeting about widgets number ${i}`,
        date: '2025-01-01T10:00:00Z',
      });
    }

    const results = searchRecordings('widgets');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  test('handles recordings with no manifest gracefully', () => {
    const dir = path.join(tempDir, 'broken-rec');
    fs.mkdirSync(dir, { recursive: true });
    // No manifest.json

    const results = searchRecordings('anything');
    expect(results).toEqual([]);
  });

  test('handles malformed manifest JSON', () => {
    const dir = path.join(tempDir, 'bad-json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'not json{{{');

    expect(() => searchRecordings('test')).not.toThrow();
  });

  test('gives recency bonus to recent recordings', () => {
    const today = new Date().toISOString();
    const oldDate = '2020-01-01T10:00:00Z';

    createRecording('recent', {
      id: 'recent',
      title: 'Project Sync',
      date: today,
    });
    createRecording('old', {
      id: 'old',
      title: 'Project Sync',
      date: oldDate,
    });

    const results = searchRecordings('project');
    expect(results[0].recordingId).toBe('recent');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
