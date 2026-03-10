import { getAnalyticsStats } from './analytics';

// Mock dependencies
jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('./recording-manager', () => ({
  listRecordings: jest.fn(),
}));

import { listRecordings } from './recording-manager';

const mockListRecordings = listRecordings as jest.MockedFunction<typeof listRecordings>;

describe('getAnalyticsStats', () => {
  test('returns zero stats when no recordings', () => {
    mockListRecordings.mockReturnValue([]);

    const stats = getAnalyticsStats();
    expect(stats.totalRecordings).toBe(0);
    expect(stats.totalDurationSeconds).toBe(0);
    expect(stats.averageDurationSeconds).toBe(0);
    expect(stats.meetingsPerWeekday).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.longestMeeting).toBeNull();
    expect(stats.shortestMeeting).toBeNull();
    expect(stats.recentTrend).toBe('stable');
  });

  test('calculates total and average duration', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: '2025-06-10T10:00:00Z', duration: 1800 },
      { id: '2', title: 'B', date: '2025-06-11T10:00:00Z', duration: 3600 },
      { id: '3', title: 'C', date: '2025-06-12T10:00:00Z', duration: 600 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.totalRecordings).toBe(3);
    expect(stats.totalDurationSeconds).toBe(6000);
    expect(stats.averageDurationSeconds).toBe(2000);
  });

  test('identifies longest and shortest meetings', () => {
    mockListRecordings.mockReturnValue([
      { id: 'short', title: 'Quick Sync', date: '2025-06-10T10:00:00Z', duration: 300 },
      { id: 'long', title: 'All Hands', date: '2025-06-11T10:00:00Z', duration: 7200 },
      { id: 'mid', title: 'Standup', date: '2025-06-12T10:00:00Z', duration: 900 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.longestMeeting).toEqual({ id: 'long', title: 'All Hands', duration: 7200 });
    expect(stats.shortestMeeting).toEqual({ id: 'short', title: 'Quick Sync', duration: 300 });
  });

  test('counts meetings per weekday', () => {
    // 2025-06-09 is Monday, 2025-06-10 is Tuesday
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: '2025-06-09T10:00:00Z', duration: 600 }, // Monday
      { id: '2', title: 'B', date: '2025-06-09T14:00:00Z', duration: 600 }, // Monday
      { id: '3', title: 'C', date: '2025-06-10T10:00:00Z', duration: 600 }, // Tuesday
    ]);

    const stats = getAnalyticsStats();
    expect(stats.meetingsPerWeekday[1]).toBe(2); // Monday
    expect(stats.meetingsPerWeekday[2]).toBe(1); // Tuesday
    expect(stats.meetingsPerWeekday[0]).toBe(0); // Sunday
  });

  test('counts top tags', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: '2025-06-10T10:00:00Z', duration: 600, tags: ['engineering', 'sprint'] },
      { id: '2', title: 'B', date: '2025-06-11T10:00:00Z', duration: 600, tags: ['engineering', 'review'] },
      { id: '3', title: 'C', date: '2025-06-12T10:00:00Z', duration: 600, tags: ['engineering'] },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.topTags[0]).toEqual({ tag: 'engineering', count: 3 });
    expect(stats.topTags.length).toBe(3);
  });

  test('handles recordings with missing duration', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: '2025-06-10T10:00:00Z' },
      { id: '2', title: 'B', date: '2025-06-11T10:00:00Z', duration: 1200 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.totalDurationSeconds).toBe(1200);
    expect(stats.totalRecordings).toBe(2);
  });

  test('generates 12 weeks of meetingsPerWeek data', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: new Date().toISOString(), duration: 1800 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.meetingsPerWeek).toHaveLength(12);
  });

  test('handles single recording for trend calculation', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: new Date().toISOString(), duration: 600 },
    ]);

    const stats = getAnalyticsStats();
    // With just one recording in last 4 weeks and none in prev 4, should be increasing
    expect(['increasing', 'stable']).toContain(stats.recentTrend);
  });

  test('uses Untitled for recordings without title', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', date: '2025-06-10T10:00:00Z', duration: 600 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.longestMeeting?.title).toBe('Untitled');
  });

  test('returns zero cost stats when no transcription cost data', () => {
    mockListRecordings.mockReturnValue([
      { id: '1', title: 'A', date: '2025-06-10T10:00:00Z', duration: 600 },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.totalTranscriptionCost).toBe(0);
    expect(stats.averageTranscriptionCost).toBe(0);
    expect(stats.transcriptionCostPerWeek).toHaveLength(12);
    expect(stats.transcriptionCostPerWeek.every(w => w.cost === 0)).toBe(true);
  });

  test('calculates total and average transcription cost', () => {
    mockListRecordings.mockReturnValue([
      {
        id: '1', title: 'A', date: new Date().toISOString(), duration: 1800,
        transcriptionCost: { estimatedCost: 0.085 },
      },
      {
        id: '2', title: 'B', date: new Date().toISOString(), duration: 3600,
        transcriptionCost: { estimatedCost: 0.17 },
      },
      {
        id: '3', title: 'C', date: new Date().toISOString(), duration: 600,
      },
    ]);

    const stats = getAnalyticsStats();
    expect(stats.totalTranscriptionCost).toBeCloseTo(0.255, 3);
    expect(stats.averageTranscriptionCost).toBeCloseTo(0.1275, 3);
  });

  test('buckets transcription cost per week', () => {
    const now = new Date();
    mockListRecordings.mockReturnValue([
      {
        id: '1', title: 'A', date: now.toISOString(), duration: 3600,
        transcriptionCost: { estimatedCost: 0.17 },
      },
    ]);

    const stats = getAnalyticsStats();
    // The last week bucket should have the cost
    const lastWeek = stats.transcriptionCostPerWeek[stats.transcriptionCostPerWeek.length - 1];
    expect(lastWeek.cost).toBeGreaterThan(0);
  });

  test('zero cost stats when no recordings', () => {
    mockListRecordings.mockReturnValue([]);

    const stats = getAnalyticsStats();
    expect(stats.totalTranscriptionCost).toBe(0);
    expect(stats.averageTranscriptionCost).toBe(0);
    expect(stats.transcriptionCostPerWeek).toEqual([]);
  });
});
