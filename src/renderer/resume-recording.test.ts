import { timerRefsFromStatus, elapsedFromRefs } from './resume-recording';

const NOW = 1_000_000_000;

describe('timerRefsFromStatus', () => {
  it('picks the clock up where main has it', () => {
    const refs = timerRefsFromStatus(3391, false, NOW);
    expect(elapsedFromRefs(refs, NOW)).toBe(3391);
    expect(elapsedFromRefs(refs, NOW + 5000)).toBe(3396);
  });

  it('holds the clock while the recording is paused', () => {
    const refs = timerRefsFromStatus(600, true, NOW);
    expect(refs.pauseStart).toBe(NOW);
    expect(elapsedFromRefs(refs, NOW + 60_000)).toBe(600);
  });

  it('carries on from the paused time once resumed', () => {
    const refs = timerRefsFromStatus(600, true, NOW);
    // What applyPausedState(false) does on resume, a minute later.
    const resumed = { ...refs, pausedDuration: refs.pausedDuration + 60_000, pauseStart: 0 };
    expect(elapsedFromRefs(resumed, NOW + 60_000)).toBe(600);
    expect(elapsedFromRefs(resumed, NOW + 70_000)).toBe(610);
  });

  it('never starts in the future', () => {
    expect(timerRefsFromStatus(-5, false, NOW).startTime).toBe(NOW);
  });
});
