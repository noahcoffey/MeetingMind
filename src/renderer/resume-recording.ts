// The Record page keeps its timer in three refs: when the recording started,
// how long it has spent paused, and when the current pause began. A page that
// picks up a recording already in progress (it was remounted, or the renderer
// reloaded) only has main's elapsed time to go on, so it rebuilds those refs
// from that: a start time that far back, no past pauses, and — if the
// recording is paused right now — a pause that begins now, so the clock holds.
export interface TimerRefs {
  startTime: number;
  pausedDuration: number;
  pauseStart: number;
}

export function timerRefsFromStatus(elapsedSeconds: number, isPaused: boolean, now: number): TimerRefs {
  return {
    startTime: now - Math.max(0, elapsedSeconds) * 1000,
    pausedDuration: 0,
    pauseStart: isPaused ? now : 0,
  };
}

/** Seconds the page's timer shows for these refs at `now`. */
export function elapsedFromRefs(refs: TimerRefs, now: number): number {
  const currentPause = refs.pauseStart ? now - refs.pauseStart : 0;
  return Math.floor((now - refs.startTime - refs.pausedDuration - currentPause) / 1000);
}
