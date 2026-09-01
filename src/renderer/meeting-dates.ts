/**
 * Local-calendar date helpers for the Meetings list and its month calendar.
 *
 * Everything here is deliberately timezone-naive in one specific way: a "day" is
 * always the user's *local* calendar day. A meeting recorded at 21:00 local on
 * Aug 12 has a `date` of `2026-08-13T01:00:00Z`, and it belongs to Aug 12.
 *
 * Two rules keep that true, and both are load-bearing:
 *
 *   1. Never `new Date('YYYY-MM-DD')` — that parses as UTC midnight, so calling
 *      `setHours` on it afterwards shifts by the local offset. Build local dates
 *      only with `new Date(y, m - 1, d)`.
 *   2. Never `toISOString().slice(0, 10)` to make a day key — that reports the
 *      UTC day. Read local dates only via getFullYear/getMonth/getDate and pad
 *      by hand.
 *
 * The main process never does any of this: it receives epoch milliseconds and
 * compares numbers. (It could not import this module anyway — tsconfig.main.json
 * pins rootDir to src/main.)
 */

/** A local calendar day, 'YYYY-MM-DD'. */
export type DayKey = string;

/** How far back the Meetings list reaches by default. */
export const RECENT_WINDOW_DAYS = 14;

export interface MsRange {
  startMs: number;
  endMs: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseDayKey(day: DayKey): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, date };
}

/** The local calendar day an instant falls on. */
export function dayKeyLocal(input: string | number | Date): DayKey {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight through 23:59:59.999 of a day, as epoch ms. */
export function dayBoundsMs(day: DayKey): MsRange {
  const { year, month, date } = parseDayKey(day);
  return {
    startMs: new Date(year, month - 1, date, 0, 0, 0, 0).getTime(),
    endMs: new Date(year, month - 1, date, 23, 59, 59, 999).getTime(),
  };
}

/**
 * The default window: local midnight `days - 1` days ago through the end of
 * today — exactly `days` calendar days, regardless of any DST shift inside it.
 */
export function recentWindowMs(now: number = Date.now(), days: number = RECENT_WINDOW_DAYS): MsRange {
  const n = new Date(now);
  const y = n.getFullYear();
  const m = n.getMonth();
  const d = n.getDate();
  return {
    startMs: new Date(y, m, d - (days - 1), 0, 0, 0, 0).getTime(),
    endMs: new Date(y, m, d, 23, 59, 59, 999).getTime(),
  };
}

/** The month a day belongs to. `month` is 1-12. */
export function monthOfDay(day: DayKey): { year: number; month: number } {
  const { year, month } = parseDayKey(day);
  return { year, month };
}

/** Comparable ordinal for a month, so callers can bound paging without Date math. */
export function monthOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** `delta` months from a month, rolling the year over in both directions. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * A Sunday-start month grid padded with nulls to whole weeks, so the caller can
 * render it straight into a 7-column grid. `month` is 1-12.
 */
export function monthGrid(year: number, month: number): (DayKey | null)[] {
  const leading = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month, 0).getDate(); // day 0 of next month
  const cells: (DayKey | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Bucket instants into per-local-day counts. */
export function countsByDay(items: { ms: number }[]): Record<DayKey, number> {
  const counts: Record<DayKey, number> = {};
  for (const item of items) {
    const key = dayKeyLocal(item.ms);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** 'August 2026' */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** 'Aug 12' */
export function formatDayShort(day: DayKey): string {
  const { year, month, date } = parseDayKey(day);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
