// Pin a timezone with a non-zero offset and a DST transition, so the local-vs-UTC
// day distinction is actually exercised. Must happen before any Date is created.
process.env.TZ = 'America/New_York';

import {
  RECENT_WINDOW_DAYS,
  dayKeyLocal,
  dayBoundsMs,
  recentWindowMs,
  monthGrid,
  countsByDay,
  addMonths,
  monthOfDay,
  monthOrdinal,
  formatDayShort,
} from './meeting-dates';

describe('dayKeyLocal', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 21:00 local on Aug 12 is already Aug 13 in UTC.
    const iso = '2026-08-13T01:00:00.000Z';
    expect(new Date(iso).toISOString().slice(0, 10)).toBe('2026-08-13'); // the trap
    expect(dayKeyLocal(iso)).toBe('2026-08-12');
  });

  it('handles the other direction (early-morning local, same UTC day)', () => {
    expect(dayKeyLocal('2026-08-12T13:00:00.000Z')).toBe('2026-08-12');
  });

  it('zero-pads months and days', () => {
    expect(dayKeyLocal('2026-01-05T17:00:00.000Z')).toBe('2026-01-05');
  });

  it('accepts epoch ms and Date objects', () => {
    const d = new Date(2026, 7, 12, 21, 0, 0);
    expect(dayKeyLocal(d)).toBe('2026-08-12');
    expect(dayKeyLocal(d.getTime())).toBe('2026-08-12');
  });
});

describe('dayBoundsMs', () => {
  it('spans local midnight to the last millisecond of the day', () => {
    const { startMs, endMs } = dayBoundsMs('2026-08-12');
    expect(dayKeyLocal(startMs)).toBe('2026-08-12');
    expect(dayKeyLocal(endMs)).toBe('2026-08-12');
    expect(new Date(startMs).getHours()).toBe(0);
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('includes a 21:00-local meeting whose ISO date reads as the next UTC day', () => {
    const { startMs, endMs } = dayBoundsMs('2026-08-12');
    const t = new Date('2026-08-13T01:00:00.000Z').getTime();
    expect(t).toBeGreaterThanOrEqual(startMs);
    expect(t).toBeLessThanOrEqual(endMs);
  });

  it('is one hour longer on the day DST ends', () => {
    // 2026-11-01 is the US fall-back date: a 25-hour local day.
    const { startMs, endMs } = dayBoundsMs('2026-11-01');
    expect(endMs - startMs).toBe(25 * 60 * 60 * 1000 - 1);
  });
});

describe('recentWindowMs', () => {
  it('covers exactly 14 calendar days ending today', () => {
    const now = new Date(2026, 7, 20, 14, 30).getTime();
    const { startMs, endMs } = recentWindowMs(now);
    expect(dayKeyLocal(startMs)).toBe('2026-08-07');
    expect(dayKeyLocal(endMs)).toBe('2026-08-20');
  });

  it('counts days, not milliseconds, across a DST boundary', () => {
    // Window runs Oct 23 -> Nov 5; DST ends Nov 1, so it is 14 days + 1 hour.
    const now = new Date(2026, 10, 5, 9, 0).getTime();
    const { startMs, endMs } = recentWindowMs(now);
    expect(dayKeyLocal(startMs)).toBe('2026-10-23');
    expect(dayKeyLocal(endMs)).toBe('2026-11-05');
    expect(endMs - startMs).toBe(14 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000 - 1);
  });

  it('rolls back across a month boundary', () => {
    const now = new Date(2026, 2, 3, 9, 0).getTime(); // Mar 3
    expect(dayKeyLocal(recentWindowMs(now).startMs)).toBe('2026-02-18');
  });

  it('rolls back across a year boundary', () => {
    const now = new Date(2026, 0, 5, 9, 0).getTime(); // Jan 5
    expect(dayKeyLocal(recentWindowMs(now).startMs)).toBe('2025-12-23');
  });

  it('honours a custom window length', () => {
    const now = new Date(2026, 7, 20, 9, 0).getTime();
    expect(dayKeyLocal(recentWindowMs(now, 1).startMs)).toBe('2026-08-20');
  });

  it('defaults to RECENT_WINDOW_DAYS', () => {
    const now = new Date(2026, 7, 20, 9, 0).getTime();
    expect(recentWindowMs(now)).toEqual(recentWindowMs(now, RECENT_WINDOW_DAYS));
  });
});

describe('monthGrid', () => {
  it('has no leading blanks when the month starts on a Sunday', () => {
    // Feb 2026 starts on a Sunday.
    const cells = monthGrid(2026, 2);
    expect(cells[0]).toBe('2026-02-01');
  });

  it('pads a month that starts on a Saturday out to six rows', () => {
    // Aug 2026 starts on a Saturday and has 31 days: 6 + 31 = 37 -> 42 cells.
    const cells = monthGrid(2026, 8);
    expect(cells.length).toBe(42);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-08-01');
    expect(cells[36]).toBe('2026-08-31');
    expect(cells[37]).toBeNull();
  });

  it('gives February 29 days in a leap year and 28 otherwise', () => {
    expect(monthGrid(2024, 2).filter(Boolean).length).toBe(29);
    expect(monthGrid(2026, 2).filter(Boolean).length).toBe(28);
  });

  it('always returns whole weeks, for every month of a year', () => {
    for (let m = 1; m <= 12; m++) {
      const cells = monthGrid(2026, m);
      expect(cells.length % 7).toBe(0);
      const days = cells.filter(Boolean) as string[];
      expect(days.every(d => d.startsWith(`2026-${String(m).padStart(2, '0')}-`))).toBe(true);
    }
  });

  it('never emits a UTC-shifted day key', () => {
    const cells = monthGrid(2026, 3).filter(Boolean) as string[];
    expect(cells).toContain('2026-03-08'); // spring-forward day
    expect(cells.length).toBe(31);
  });
});

describe('countsByDay', () => {
  it('buckets instants by local day', () => {
    const counts = countsByDay([
      { ms: new Date('2026-08-13T01:00:00.000Z').getTime() }, // 21:00 local Aug 12
      { ms: new Date('2026-08-12T14:00:00.000Z').getTime() }, // 10:00 local Aug 12
      { ms: new Date('2026-08-14T14:00:00.000Z').getTime() },
    ]);
    expect(counts).toEqual({ '2026-08-12': 2, '2026-08-14': 1 });
  });

  it('returns an empty map for no items', () => {
    expect(countsByDay([])).toEqual({});
  });
});

describe('addMonths', () => {
  it('rolls the year forward', () => {
    expect(addMonths(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
  });

  it('rolls the year backward', () => {
    expect(addMonths(2026, 2, -3)).toEqual({ year: 2025, month: 11 });
  });

  it('steps by one in both directions', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('monthOfDay / monthOrdinal', () => {
  it('reads the month off a day key', () => {
    expect(monthOfDay('2026-08-12')).toEqual({ year: 2026, month: 8 });
  });

  it('orders months across a year boundary', () => {
    expect(monthOrdinal(2026, 1)).toBeGreaterThan(monthOrdinal(2025, 12));
    expect(monthOrdinal(2026, 1) - monthOrdinal(2025, 12)).toBe(1);
  });
});

describe('formatDayShort', () => {
  it('formats the local day, not a UTC-shifted one', () => {
    expect(formatDayShort('2026-08-12')).toBe('Aug 12');
    expect(formatDayShort('2026-01-01')).toBe('Jan 1');
  });
});
