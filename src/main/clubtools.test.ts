jest.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
jest.mock('./logger', () => ({ log: jest.fn() }));
jest.mock('./store', () => ({ getSetting: jest.fn() }));
jest.mock('./recording-manager', () => ({ getRecording: jest.fn() }));

import { buildSubmission, interpretResponse } from './clubtools';

describe('buildSubmission', () => {
  test('keys the submission on the recording id so re-sends update one inbox entry', () => {
    const sub = buildSubmission(
      { id: 'rec-1', title: 'Kiwanis Club Meeting', date: '2026-11-05T17:12:00.000Z', notebook: 'Kiwanis' },
      '## Notes',
    );
    expect(sub).toEqual({
      externalId: 'rec-1',
      title: 'Kiwanis Club Meeting',
      recordedAt: '2026-11-05T17:12:00.000Z',
      notebook: 'Kiwanis',
      notesMarkdown: '## Notes',
    });
  });

  test('falls back to the calendar title, then a placeholder', () => {
    expect(buildSubmission({ id: 'a', date: '2026-11-05T17:12:00Z', calendarEvent: { title: 'Board' } }, 'x').title).toBe('Board');
    expect(buildSubmission({ id: 'a', date: '2026-11-05T17:12:00Z' }, 'x').title).toBe('Untitled Meeting');
  });
});

describe('interpretResponse', () => {
  test('a new or updated pending entry is "sent"', () => {
    expect(interpretResponse(201, { ok: true, id: 's1', status: 'pending', created: true })).toMatchObject({ status: 'sent', submissionId: 's1' });
    expect(interpretResponse(200, { ok: true, id: 's1', status: 'pending', updated: true }).detail).toMatch(/Updated/);
  });

  test('notes an admin already handled are reported as such', () => {
    expect(interpretResponse(200, { ok: true, id: 's1', status: 'accepted' }).status).toBe('accepted');
    expect(interpretResponse(200, { ok: true, id: 's1', status: 'dismissed' }).status).toBe('dismissed');
  });

  test('auth and server failures are errors with a useful message', () => {
    expect(interpretResponse(401, { error: 'Unauthorized' })).toMatchObject({ status: 'error', detail: expect.stringMatching(/token/) });
    expect(interpretResponse(403, {}).detail).toMatch(/admin/);
    expect(interpretResponse(400, { ok: false, error: 'Invalid payload' }).detail).toBe('Invalid payload');
    expect(interpretResponse(502, {}).detail).toMatch(/502/);
  });
});
