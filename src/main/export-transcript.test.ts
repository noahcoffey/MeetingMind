jest.mock('./logger', () => ({ log: jest.fn() }));
jest.mock('./recording-manager', () => ({ getRecording: jest.fn() }));
jest.mock('electron', () => ({
  clipboard: { writeText: jest.fn(), write: jest.fn() },
  shell: { openExternal: jest.fn() },
  dialog: { showSaveDialog: jest.fn() },
  BrowserWindow: jest.fn(),
}));

import { buildTranscriptMarkdown } from './export';

const recording = {
  title: 'Weekly Sync',
  date: '2026-08-24T15:00:00.000Z',
  duration: 1830,
  speakerNames: { 'Speaker 1': 'Noah', 'Speaker 2': 'Dana' },
};

const transcript = {
  utterances: [
    { speaker: 'Speaker 1', start: 0, text: 'Morning everyone.' },
    { speaker: 'Speaker 2', start: 65000, text: 'Morning.' },
    { speaker: 'Speaker 3', start: 130000, text: 'Hi.' },
  ],
};

describe('buildTranscriptMarkdown', () => {
  test('resolves speaker names into the transcript lines', () => {
    const md = buildTranscriptMarkdown(recording, transcript);
    expect(md).toContain('**Noah:** Morning everyone.');
    expect(md).toContain('**Dana:** Morning.');
  });

  test('leaves unlabeled speakers as their original key', () => {
    const md = buildTranscriptMarkdown(recording, transcript);
    expect(md).toContain('**Speaker 3:** Hi.');
    expect(md).toContain('Speaker 3 (unidentified)');
  });

  test('includes a header with title, duration and speaker legend', () => {
    const md = buildTranscriptMarkdown(recording, transcript);
    expect(md).toContain('# Transcript: Weekly Sync');
    expect(md).toContain('**Duration:** 30m');
    expect(md).toContain('**Speakers:** Noah, Dana');
  });

  test('formats timestamps as HH:MM:SS offsets', () => {
    const md = buildTranscriptMarkdown(recording, transcript);
    expect(md).toContain('[00:00:00]');
    expect(md).toContain('[00:01:05]');
  });

  test('prefers the calendar event title when present', () => {
    const md = buildTranscriptMarkdown(
      { ...recording, calendarEvent: { title: 'Board Meeting' } },
      transcript
    );
    expect(md).toContain('# Transcript: Board Meeting');
  });

  test('marks speakers as not identified when nothing is labeled', () => {
    const md = buildTranscriptMarkdown({ ...recording, speakerNames: {} }, transcript);
    expect(md).toContain('(not identified)');
    expect(md).toContain('**Speaker 1:** Morning everyone.');
  });

  test('falls back to plain text when there are no utterances', () => {
    const md = buildTranscriptMarkdown(recording, { text: 'A flat transcript.' });
    expect(md).toContain('A flat transcript.');
  });

  test('handles a missing transcript body', () => {
    const md = buildTranscriptMarkdown(recording, {});
    expect(md).toContain('_No transcript available._');
  });
});
