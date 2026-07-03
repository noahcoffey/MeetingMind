import React, { useState, useEffect } from 'react';
import type { MeetingHubLogEntry } from '../../types';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  meetinghubKey: string;
  setMeetinghubKey: (v: string) => void;
  hasMeetinghubKey: boolean;
}

const OUTCOME_COLORS: Record<string, string> = {
  sent: 'var(--accent-green)',
  pending: '#e67e22',
  skipped: 'var(--text-muted)',
  error: '#e74c3c',
};

const OUTCOME_LABELS: Record<string, string> = {
  sent: 'Sent',
  pending: 'Review',
  skipped: 'Skipped',
  error: 'Failed',
};

function formatPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PayloadBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 8,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 320,
          overflow: 'auto',
        }}
      >
        {formatPayload(value)}
      </pre>
    </div>
  );
}

export default function MeetingHubSettings({
  settings, updateSetting,
  meetinghubKey, setMeetinghubKey, hasMeetinghubKey,
}: Props) {
  const notebooks: string[] = settings.notebooks || [];
  const enabled: string[] = settings.meetinghubNotebooks || [];
  const [activity, setActivity] = useState<MeetingHubLogEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function loadActivity() {
    try {
      setActivity(await window.meetingMind.getMeetingHubActivity());
    } catch {
      setActivity([]);
    }
  }

  useEffect(() => {
    loadActivity();
    const unsub = window.meetingMind.on('meetinghub:activity', () => loadActivity());
    return () => { unsub(); };
  }, []);

  async function handleClearActivity() {
    await window.meetingMind.clearMeetingHubActivity();
    loadActivity();
  }

  function toggleNotebook(nb: string) {
    const next = enabled.includes(nb)
      ? enabled.filter(n => n !== nb)
      : [...enabled, nb];
    updateSetting('meetinghubNotebooks', next);
  }

  return (
    <>
      <p className="form-hint" style={{ marginTop: 0, marginBottom: 16 }}>
        Push generated meeting notes to MeetingHub. Calendar meetings match on their
        iCal UID; manual meetings are staged in MeetingHub's review inbox. Sending is
        idempotent — re-sending never overwrites notes already present.
      </p>

      <div className="form-group">
        <label className="form-label">
          Ingest API Key {hasMeetinghubKey && <span className="key-saved">(saved)</span>}
        </label>
        <input
          type="password"
          className="form-input"
          placeholder={hasMeetinghubKey ? '••••••••••••••' : 'Enter the MeetingHub ingest API key'}
          value={meetinghubKey}
          onChange={e => setMeetinghubKey(e.target.value)}
        />
        <div className="form-hint">
          Stored in the macOS Keychain. Sent as a bearer token on every request.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Base URL</label>
        <input
          type="text"
          className="form-input"
          placeholder="https://your-meetinghub-instance.example.com"
          value={settings.meetinghubBaseUrl ?? ''}
          onChange={e => updateSetting('meetinghubBaseUrl', e.target.value)}
        />
        <div className="form-hint">
          Defaults to https://hub.noahcoffey.com. Use http://localhost:3100 for local dev.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Auto-send for notebooks</label>
        <div className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
          When notes finish generating for a recording in a checked notebook, they're
          pushed to MeetingHub automatically. Google/Microsoft calendar meetings are
          skipped (MeetingHub can't match them without an iCal UID).
        </div>
        {notebooks.length === 0 && (
          <div className="form-hint">No notebooks yet. Create one to enable auto-send.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notebooks.map(nb => (
            <label key={nb} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={enabled.includes(nb)}
                onChange={() => toggleNotebook(nb)}
              />
              {nb}
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="form-label" style={{ marginBottom: 0 }}>Recent activity</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={loadActivity}>Refresh</button>
            {activity.length > 0 && (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={handleClearActivity}>Clear</button>
            )}
          </div>
        </div>
        <div className="form-hint" style={{ marginTop: 4, marginBottom: 8 }}>
          Every push attempt to MeetingHub (auto and manual). Most recent first.
        </div>
        {activity.length === 0 ? (
          <div className="form-hint">No pushes yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map(entry => {
              const color = OUTCOME_COLORS[entry.outcome] || 'var(--text-muted)';
              const when = new Date(entry.at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              });
              const isOpen = expanded.has(entry.id);
              const hasDetails = !!(entry.request || entry.response);
              return (
                <div
                  key={entry.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius)',
                    background: 'var(--bg-tertiary)',
                    fontSize: 12,
                  }}
                >
                  <div
                    onClick={() => hasDetails && toggleExpanded(entry.id)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: hasDetails ? 'pointer' : 'default' }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        padding: '2px 8px',
                        borderRadius: 8,
                        fontSize: 10,
                        fontWeight: 600,
                        color,
                        background: `color-mix(in srgb, ${color} 12%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                      }}
                    >
                      {OUTCOME_LABELS[entry.outcome] || entry.outcome}
                      {entry.httpStatus != null && ` ${entry.httpStatus}`}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.recordingTitle}
                      </div>
                      <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                        {when} · {entry.trigger}
                        {typeof entry.notesChars === 'number' && ` · ${entry.notesChars.toLocaleString()} chars`}
                        {entry.sourceId && <> · <span style={{ fontFamily: 'monospace' }}>{entry.sourceId.slice(0, 24)}{entry.sourceId.length > 24 ? '…' : ''}</span></>}
                      </div>
                      {entry.detail && (
                        <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{entry.detail}</div>
                      )}
                    </div>
                    {hasDetails && (
                      <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 11 }}>
                        {isOpen ? 'Hide ▲' : 'Details ▼'}
                      </span>
                    )}
                  </div>
                  {isOpen && hasDetails && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {entry.request && (
                        <PayloadBlock
                          label={`Request — ${entry.request.method} ${entry.request.url}`}
                          value={entry.request.body}
                        />
                      )}
                      {entry.response && (
                        <PayloadBlock
                          label={`Response — HTTP ${entry.response.status}${entry.response.statusText ? ` ${entry.response.statusText}` : ''}`}
                          value={entry.response.body}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
