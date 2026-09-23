jest.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false } }));
jest.mock('./logger', () => ({ log: jest.fn() }));
jest.mock('./store', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));
jest.mock('./recording-manager', () => ({ getOutputDir: jest.fn(() => '/tmp/none'), getRecording: jest.fn() }));
jest.mock('./claude-cli', () => ({ runClaudePrompt: jest.fn() }));

import { attendeeDisplayName, candidateNames, decideGate, parseSuggestions, buildIdentifyPrompt } from './speaker-review';

describe('attendeeDisplayName', () => {
  it('keeps a plain name', () => {
    expect(attendeeDisplayName('Dana Whitfield')).toBe('Dana Whitfield');
  });
  it('derives a name from an email', () => {
    expect(attendeeDisplayName('dana.whitfield@example.com')).toBe('Dana Whitfield');
    expect(attendeeDisplayName('jsmith2@example.com')).toBe('Jsmith2');
  });
  it('flips "Last, First"', () => {
    expect(attendeeDisplayName('Whitfield, Dana')).toBe('Dana Whitfield');
  });
  it('strips quotes', () => {
    expect(attendeeDisplayName('"Dana Whitfield"')).toBe('Dana Whitfield');
  });
});

describe('candidateNames', () => {
  it('puts the recorder first and de-duplicates case-insensitively', () => {
    const rec = { calendarEvent: { attendees: ['noah coffey', 'dana.whitfield@example.com', 'Dana Whitfield'] } };
    expect(candidateNames(rec, 'Noah Coffey', ['Priya Patel', 'Dana Whitfield'])).toEqual([
      'Noah Coffey', 'Dana Whitfield', 'Priya Patel',
    ]);
  });
});

describe('decideGate', () => {
  const two = ['Speaker 1', 'Speaker 2'];
  it('proceeds when the gate is off', () => {
    expect(decideGate({ gateEnabled: false, speakers: two, speakerNames: {}, candidates: [] }).proceed).toBe(true);
  });
  it('proceeds for a single speaker', () => {
    expect(decideGate({ gateEnabled: true, speakers: ['Speaker 1'], speakerNames: {}, candidates: [] }).reason).toBe('single-speaker');
  });
  it('proceeds when everyone is already named', () => {
    const d = decideGate({ gateEnabled: true, speakers: two, speakerNames: { 'Speaker 1': 'Noah', 'Speaker 2': 'Dana' }, candidates: [] });
    expect(d.reason).toBe('all-named');
  });
  it('pauses with no suggestions', () => {
    expect(decideGate({ gateEnabled: true, speakers: two, speakerNames: {}, candidates: ['Noah'] }).proceed).toBe(false);
  });
  it('applies high-confidence suggestions that match the attendee list', () => {
    const d = decideGate({
      gateEnabled: true, speakers: two, speakerNames: {},
      suggestions: {
        'Speaker 1': { name: 'Noah Coffey', confidence: 'high', reason: '' },
        'Speaker 2': { name: 'dana whitfield', confidence: 'high', reason: '' },
      },
      candidates: ['Noah Coffey', 'Dana Whitfield'],
    });
    expect(d.proceed).toBe(true);
    expect(d.apply).toEqual({ 'Speaker 1': 'Noah Coffey', 'Speaker 2': 'dana whitfield' });
  });
  it('pauses on a medium-confidence or off-list suggestion', () => {
    const base = { gateEnabled: true, speakers: two, speakerNames: {}, candidates: ['Noah Coffey', 'Dana Whitfield'] };
    expect(decideGate({ ...base, suggestions: {
      'Speaker 1': { name: 'Noah Coffey', confidence: 'high', reason: '' },
      'Speaker 2': { name: 'Dana Whitfield', confidence: 'medium', reason: '' },
    } }).proceed).toBe(false);
    expect(decideGate({ ...base, suggestions: {
      'Speaker 1': { name: 'Noah Coffey', confidence: 'high', reason: '' },
      'Speaker 2': { name: 'Someone Else', confidence: 'high', reason: '' },
    } }).proceed).toBe(false);
  });
  it('pauses when two speakers resolve to one person', () => {
    const d = decideGate({ gateEnabled: true, speakers: two, speakerNames: {}, candidates: ['Noah Coffey'], suggestions: {
      'Speaker 1': { name: 'Noah Coffey', confidence: 'high', reason: '' },
      'Speaker 2': { name: 'Noah Coffey', confidence: 'high', reason: '' },
    } });
    expect(d.proceed).toBe(false);
  });
  it('only needs suggestions for the unnamed speakers', () => {
    const d = decideGate({ gateEnabled: true, speakers: two, speakerNames: { 'Speaker 1': 'Noah Coffey' }, candidates: ['Noah Coffey', 'Dana Whitfield'], suggestions: {
      'Speaker 2': { name: 'Dana Whitfield', confidence: 'high', reason: '' },
    } });
    expect(d.proceed).toBe(true);
    expect(d.apply).toEqual({ 'Speaker 2': 'Dana Whitfield' });
  });
});

describe('parseSuggestions', () => {
  const speakers = ['Speaker 1', 'Speaker 2'];
  it('parses clean JSON', () => {
    const s = parseSuggestions('{"speakers":{"Speaker 1":{"name":"Dana","confidence":"high","reason":"intro"},"Speaker 2":{"name":null,"confidence":"low","reason":""}}}', speakers);
    expect(s['Speaker 1']).toEqual({ name: 'Dana', confidence: 'high', reason: 'intro' });
    expect(s['Speaker 2'].name).toBeNull();
  });
  it('parses fenced JSON with prose around it', () => {
    const s = parseSuggestions('Here you go:\n```json\n{"Speaker 1":{"name":"Dana","confidence":"HIGH","reason":"x"}}\n```\nDone.', speakers);
    expect(s['Speaker 1'].confidence).toBe('high');
    expect(s['Speaker 2']).toBeUndefined();
  });
  it('treats "unknown" as null and odd confidences as low', () => {
    const s = parseSuggestions('{"Speaker 1":{"name":"Unknown","confidence":"certain","reason":""}}', speakers);
    expect(s['Speaker 1']).toEqual({ name: null, confidence: 'low', reason: '' });
  });
  it('throws on garbage', () => {
    expect(() => parseSuggestions('no json here', speakers)).toThrow();
  });
});

describe('buildIdentifyPrompt', () => {
  it('includes the attendee list, recorder, and timestamps', () => {
    const p = buildIdentifyPrompt({
      speakers: ['Speaker 1'],
      utterances: [{ speaker: 'Speaker 1', text: 'Hi, this is Dana.', start: 74000 }],
      candidates: ['Noah Coffey', 'Dana Whitfield'],
      userName: 'Noah Coffey',
      title: 'Roadmap',
      alreadyNamed: {},
    });
    expect(p).toContain('Dana Whitfield');
    expect(p).toContain('recorded this meeting is Noah Coffey');
    expect(p).toContain('[1:14] Speaker 1: Hi, this is Dana.');
  });
});
