import React from 'react';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  clubtoolsKey: string;
  setClubtoolsKey: (v: string) => void;
  hasClubtoolsKey: boolean;
}

export default function ClubToolsSettings({
  settings, updateSetting,
  clubtoolsKey, setClubtoolsKey, hasClubtoolsKey,
}: Props) {
  const notebooks: string[] = settings.notebooks || [];
  const enabled: string[] = settings.clubtoolsNotebooks || [];

  function toggleNotebook(nb: string) {
    updateSetting('clubtoolsNotebooks', enabled.includes(nb) ? enabled.filter(n => n !== nb) : [...enabled, nb]);
  }

  return (
    <>
      <p className="form-hint" style={{ marginTop: 0, marginBottom: 16 }}>
        Send generated notes to Club Tools. They wait in its inbox (on the dashboard and on the
        meeting page) with the club meeting from the same day suggested. Accept them there to put
        them into that meeting's Minutes doc, or move them to a different meeting.
      </p>

      <div className="form-group">
        <label className="form-label">
          API Token {hasClubtoolsKey && <span className="key-saved">(saved)</span>}
        </label>
        <input
          type="password"
          className="form-input"
          placeholder={hasClubtoolsKey ? '••••••••••••••' : 'sok_…'}
          value={clubtoolsKey}
          onChange={e => setClubtoolsKey(e.target.value)}
        />
        <div className="form-hint">
          Create one under Settings → API tokens in Club Tools, signed in as an admin. Stored in the
          macOS Keychain.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Base URL</label>
        <input
          type="text"
          className="form-input"
          placeholder="https://tools.avonkiwanis.org"
          value={settings.clubtoolsBaseUrl ?? ''}
          onChange={e => updateSetting('clubtoolsBaseUrl', e.target.value)}
        />
        <div className="form-hint">
          Defaults to https://tools.avonkiwanis.org. Use http://localhost:3000 for local dev.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Auto-send for notebooks</label>
        <div className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
          When notes finish generating for a recording in a checked notebook, they're sent to the
          Club Tools inbox. Re-sending updates the inbox entry until it has been accepted.
        </div>
        {notebooks.length === 0 && (
          <div className="form-hint">No notebooks yet. Create one to enable auto-send.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notebooks.map(nb => (
            <label key={nb} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={enabled.includes(nb)} onChange={() => toggleNotebook(nb)} />
              {nb}
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
