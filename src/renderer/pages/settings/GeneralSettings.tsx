import React from 'react';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  onSelectFolder: (key: string) => void;
}

export default function GeneralSettings({ settings, updateSetting, onSelectFolder }: Props) {
  return (
    <>
      <div className="form-group">
        <label className="form-label">Your Name</label>
        <input
          type="text"
          className="form-input"
          placeholder="Used in meeting notes to identify you"
          value={settings.userName || ''}
          onChange={e => updateSetting('userName', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Theme</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {([
            { id: 'dark', label: 'Dark', colors: ['#1a1b2e', '#2d2e4a', '#e74c3c'] },
            { id: 'ember', label: 'Ember', colors: ['#1c1210', '#2a1e1a', '#e74c3c'] },
            { id: 'forest', label: 'Forest', colors: ['#121a16', '#1a2b20', '#e74c3c'] },
            { id: 'nord', label: 'Nord', colors: ['#2e3440', '#353b49', '#bf616a'] },
            { id: 'ocean', label: 'Ocean', colors: ['#1b2838', '#223347', '#56b6c2'] },
            { id: 'slate', label: 'Slate', colors: ['#2a2d30', '#333739', '#8fbcbb'] },
            { id: 'violet', label: 'Violet', colors: ['#18141e', '#241e32', '#e74c3c'] },
            { id: 'light', label: 'Light', colors: ['#ffffff', '#f3f4f6', '#dc2626'] },
            { id: 'system', label: 'System', colors: [] },
          ] as const).map(t => {
            const isActive = (settings.theme || 'dark') === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  updateSetting('theme', t.id);
                  window.meetingMind.setSetting('theme', t.id);
                  if (t.id === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                  } else {
                    document.documentElement.setAttribute('data-theme', t.id);
                  }
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 8px',
                  border: isActive ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                  borderRadius: 8,
                  background: 'var(--bg-card)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                {t.colors.length > 0 ? (
                  <div style={{
                    display: 'flex',
                    gap: 3,
                    height: 20,
                    width: '100%',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    {t.colors.map((c, i) => (
                      <div key={i} style={{ flex: 1, backgroundColor: c }} />
                    ))}
                  </div>
                ) : (
                  <div style={{
                    height: 20,
                    width: '100%',
                    borderRadius: 4,
                    overflow: 'hidden',
                    display: 'flex',
                  }}>
                    <div style={{ flex: 1, backgroundColor: '#1a1b2e' }} />
                    <div style={{ flex: 1, backgroundColor: '#ffffff' }} />
                  </div>
                )}
                <span style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Recording Output Folder</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="form-input"
            value={settings.recordingOutputFolder || ''}
            readOnly
          />
          <button className="btn btn-secondary" onClick={() => onSelectFolder('recordingOutputFolder')}>
            Browse
          </button>
        </div>
      </div>
    </>
  );
}
