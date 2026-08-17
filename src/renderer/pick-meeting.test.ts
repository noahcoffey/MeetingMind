import { pickCurrentMeeting } from './pick-meeting';

const at = (hour: number, minute = 0) => new Date(2026, 7, 17, hour, minute).toISOString();
const NOW = new Date(2026, 7, 17, 14, 51).getTime();

const allDay = {
  id: 'all-day',
  title: 'Performance | Release Review packets',
  startTime: new Date(2026, 7, 17, 0, 0).toISOString(),
  endTime: new Date(2026, 7, 18, 0, 0).toISOString(),
};
const live = { id: 'live', title: 'Dev & QA Office Hours', startTime: at(14, 30), endTime: at(15) };
const next = { id: 'next', title: 'Prep Work', startTime: at(15), endTime: at(16, 30) };
const later = { id: 'later', title: 'Enter & Approve Time', startTime: at(16, 30), endTime: at(17) };

describe('pickCurrentMeeting', () => {
  it('picks the meeting happening now', () => {
    expect(pickCurrentMeeting([allDay, live, next], NOW)?.id).toBe('live');
  });

  it('ignores all-day blocks, which span every "now"', () => {
    expect(pickCurrentMeeting([allDay], NOW)).toBeNull();
  });

  it('falls back to the next meeting starting soon', () => {
    expect(pickCurrentMeeting([allDay, next, later], NOW)?.id).toBe('next');
  });

  it('leaves it blank when the next meeting is beyond the window', () => {
    expect(pickCurrentMeeting([allDay, later], NOW)).toBeNull();
  });

  it('prefers the most recently started of overlapping meetings', () => {
    const long = { id: 'long', title: 'Focus block', startTime: at(13), endTime: at(16) };
    expect(pickCurrentMeeting([long, live], NOW)?.id).toBe('live');
  });

  it('survives an empty or malformed calendar', () => {
    expect(pickCurrentMeeting([], NOW)).toBeNull();
    expect(pickCurrentMeeting([{ id: 'x', title: 'x', startTime: '', endTime: '' }], NOW)).toBeNull();
  });
});
