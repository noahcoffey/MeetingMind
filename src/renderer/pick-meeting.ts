// Which meeting to stage when something outside the Record page asks for
// "the one I'm in" — the Stream Deck key, via the control server.

export interface PickableEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
}

/** How far ahead a meeting can start and still count as the one you're about to
 *  record. Beyond this it is later's problem, and staging it would be a wrong
 *  guess rather than a helpful one. */
export const UPCOMING_WINDOW_MS = 30 * 60 * 1000;

/** Anything this long is a day marker, a holiday, or an out-of-office block —
 *  not something anyone records. Calendars here carry no all-day flag (an ICS
 *  all-day event arrives as a plain 24-hour span), so length is the only tell,
 *  and without this check the day marker wins every "happening now" test. */
export const ALL_DAY_MS = 6 * 60 * 60 * 1000;

function span(event: PickableEvent): number {
  return new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
}

/**
 * The meeting happening now, else the next one starting soon. Null if neither —
 * better a blank title than the wrong meeting's, since the title follows the
 * recording all the way through to the notes.
 *
 * With meetings stacked on top of each other, the one that started most
 * recently wins: that is the one you just walked into.
 */
export function pickCurrentMeeting<T extends PickableEvent>(events: T[], now = Date.now()): T | null {
  const real = (events || []).filter(e => e?.startTime && e?.endTime && span(e) < ALL_DAY_MS);

  const live = real
    .filter(e => new Date(e.startTime).getTime() <= now && new Date(e.endTime).getTime() > now)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  if (live.length) return live[0];

  const soon = real
    .filter(e => {
      const start = new Date(e.startTime).getTime();
      return start > now && start - now <= UPCOMING_WINDOW_MS;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return soon[0] || null;
}
