import { pickSpeakerQuotes } from './speaker-quotes';

const u = (text: string, start: number) => ({ text, start, end: start + 1000 });

describe('pickSpeakerQuotes', () => {
  it('prefers a self-introduction that names an attendee', () => {
    const lines = [
      u('Yeah.', 0),
      u('Okay so the first thing on the agenda is the roadmap review for next quarter.', 1000),
      u("Hi everyone, this is Dana, sorry I'm late.", 2000),
      u('Sure, that works for me.', 3000),
    ];
    const picked = pickSpeakerQuotes(lines, { names: ['Dana Whitfield', 'Noah Coffey'] });
    expect(picked[0].text).toContain('this is Dana');
  });

  it('skips tiny lines when longer ones exist', () => {
    const lines = [u('Yeah.', 0), u('Mm-hm.', 1), u('We should ship the migration before the board meeting on Friday.', 2)];
    const picked = pickSpeakerQuotes(lines, { max: 1 });
    expect(picked[0].text).toContain('migration');
  });

  it('returns at most max quotes, spread through the meeting', () => {
    const lines = Array.from({ length: 20 }, (_, i) => u(`Line number ${i} with enough words to count as real content here.`, i * 1000));
    const picked = pickSpeakerQuotes(lines, { max: 3 });
    expect(picked.map(p => p.start)).toEqual([0, 10000, 16000]);
  });

  it('handles an empty list', () => {
    expect(pickSpeakerQuotes([])).toEqual([]);
  });
});
