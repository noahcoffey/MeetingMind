jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
  },
}));

jest.mock('./logger', () => ({
  log: jest.fn(),
}));

jest.mock('./store', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('./recording-manager', () => ({
  getRecording: jest.fn(),
}));

import { truncateTranscript } from './meeting-qa';

describe('truncateTranscript', () => {
  test('returns short transcripts unchanged', () => {
    const transcript = 'Speaker 1: hello\nSpeaker 2: hi';
    expect(truncateTranscript(transcript)).toEqual({ text: transcript, truncated: false });
  });

  test('truncates very long transcripts and marks the omission', () => {
    const line = 'Speaker 1: this is one utterance in a very long meeting\n';
    const transcript = line.repeat(10000); // ~570k chars
    const result = truncateTranscript(transcript);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(160_000);
    expect(result.text).toContain('[... middle of the transcript omitted for length ...]');
  });

  test('keeps the beginning and end of the transcript', () => {
    const filler = 'Speaker 1: filler talk that goes on and on during the meeting\n';
    const transcript =
      'Speaker 1: opening agenda item\n' +
      filler.repeat(10000) +
      'Speaker 2: final decision was approved';
    const result = truncateTranscript(transcript);

    expect(result.text).toContain('Speaker 1: opening agenda item');
    expect(result.text).toContain('Speaker 2: final decision was approved');
  });

  test('cuts at line boundaries so utterances stay intact', () => {
    const line = 'Speaker 1: utterance\n';
    const transcript = line.repeat(10000);
    const result = truncateTranscript(transcript);

    const [head, tail] = result.text.split('[... middle of the transcript omitted for length ...]');
    expect(head.trimEnd().endsWith('Speaker 1: utterance')).toBe(true);
    expect(tail.trimStart().startsWith('Speaker 1: utterance')).toBe(true);
  });
});
