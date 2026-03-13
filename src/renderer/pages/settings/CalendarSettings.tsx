import React from 'react';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
}

export default function CalendarSettings({ settings, updateSetting }: Props) {
  return (
    <>
      <label className="form-label settings-toggle">
        <input
          type="checkbox"
          checked={settings.icsCalendarEnabled || false}
          onChange={e => updateSetting('icsCalendarEnabled', e.target.checked)}
        />
        Use ICS Calendar URL
      </label>
      {settings.icsCalendarEnabled && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <input
            type="url"
            className="form-input"
            placeholder="https://calendar.example.com/feed.ics"
            value={settings.icsCalendarUrl || ''}
            onChange={e => updateSetting('icsCalendarUrl', e.target.value)}
          />
          <div className="form-hint">
            Paste a webcal/ICS URL. Events within ±2 hours show on the Record screen.
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>
        Or connect via OAuth:
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => window.meetingMind.connectGoogleCalendar()}>
          Google Calendar
        </button>
        <button className="btn btn-secondary" onClick={() => window.meetingMind.connectMicrosoftCalendar()}>
          Microsoft 365
        </button>
      </div>
    </>
  );
}
