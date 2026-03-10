import React, { useState, useEffect } from 'react';

const DEFAULT_PROMPT = `You are a professional meeting notes assistant. Based on the transcript and context below, generate structured meeting notes in Markdown format.

Context:
- Meeting: {{event_title}}
- Date: {{date}}
- Attendees: {{attendees}}
- Duration: {{duration}}
- Additional context from the recorder: {{user_context}}
- Primary participant (the person who recorded this): {{user_name}}

Transcript:
{{transcript}}

Generate notes with these exact sections:

# {{suggested_title}}

**Date:** {{date}} | **Attendees:** {{attendees}} | **Duration:** {{duration}}

## Summary
(3-5 sentence executive summary)

## Key Discussion Points
(bullet points of main topics)

## Decisions Made
(explicit decisions reached, or "None recorded" if none)

## Action Items
(format: - [ ] [Person]: [task] (due: [date if mentioned]))

## Open Questions
(unresolved items / parking lot)

## Notes
(any important verbatim quotes or details worth preserving)`;

interface SettingsPageProps {
  onSettingsChange: () => void;
}

export default function SettingsPage({ onSettingsChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [hasAssemblyKey, setHasAssemblyKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const s = await window.meetingMind.getSettings();
      setSettings(s);

      const aaiKey = await window.meetingMind.getApiKey('assemblyai');
      setHasAssemblyKey(!!aaiKey);

      const antKey = await window.meetingMind.getApiKey('anthropic');
      setHasAnthropicKey(!!antKey);
    } catch {
      console.error('Failed to load settings');
    }
  }

  async function handleSave() {
    // Save settings
    for (const [key, value] of Object.entries(settings)) {
      await window.meetingMind.setSetting(key, value);
    }

    // Save API keys if changed
    if (assemblyAiKey) {
      await window.meetingMind.setApiKey('assemblyai', assemblyAiKey);
      setHasAssemblyKey(true);
      setAssemblyAiKey('');
    }
    if (anthropicKey) {
      await window.meetingMind.setApiKey('anthropic', anthropicKey);
      setHasAnthropicKey(true);
      setAnthropicKey('');
    }

    onSettingsChange();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateSetting(key: string, value: any) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSelectFolder(key: string) {
    const folder = await window.meetingMind.selectFolder();
    if (folder) updateSetting(key, folder);
  }

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="page-content" style={{ maxWidth: 600 }}>

        {/* API Keys */}
        <div className="settings-section">
          <h2>API Keys</h2>
          <div className="form-group">
            <label className="form-label">
              AssemblyAI API Key {hasAssemblyKey && <span style={{ color: 'var(--accent-green)' }}>(saved)</span>}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder={hasAssemblyKey ? '••••••••••••••' : 'Enter your AssemblyAI API key'}
              value={assemblyAiKey}
              onChange={e => setAssemblyAiKey(e.target.value)}
            />
          </div>
          {(settings.notesProvider || 'cli') === 'api' && (
            <div className="form-group">
              <label className="form-label">
                Anthropic API Key {hasAnthropicKey && <span style={{ color: 'var(--accent-green)' }}>(saved)</span>}
              </label>
              <input
                type="password"
                className="form-input"
                placeholder={hasAnthropicKey ? '••••••••••••••' : 'Enter your Anthropic API key'}
                value={anthropicKey}
                onChange={e => setAnthropicKey(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="settings-section">
          <h2>User</h2>
          <div className="form-group">
            <label className="form-label">Your Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="Your name (used in meeting notes)"
              value={settings.userName || ''}
              onChange={e => updateSetting('userName', e.target.value)}
            />
          </div>
        </div>

        {/* Audio */}
        <div className="settings-section">
          <h2>Audio</h2>
          <div className="form-group">
            <label className="form-label">Default Audio Input Device</label>
            <select
              className="form-select"
              value={settings.defaultInputDevice || 'default'}
              onChange={e => updateSetting('defaultInputDevice', e.target.value)}
            >
              <option value="default">System Default</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.autoTranscribe || false}
                onChange={e => updateSetting('autoTranscribe', e.target.checked)}
              />
              Auto-transcribe after recording stops
            </label>
          </div>
        </div>

        {/* Output */}
        <div className="settings-section">
          <h2>Output</h2>
          <div className="form-group">
            <label className="form-label">Recording Output Folder</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="form-input"
                value={settings.recordingOutputFolder || ''}
                readOnly
              />
              <button className="btn btn-secondary" onClick={() => handleSelectFolder('recordingOutputFolder')}>
                Browse
              </button>
            </div>
          </div>
        </div>

        {/* Obsidian */}
        <div className="settings-section">
          <h2>Obsidian</h2>
          <div className="form-group">
            <label className="form-label">Vault Path</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="form-input"
                value={settings.obsidianVaultPath || ''}
                readOnly
                placeholder="Select your Obsidian vault folder"
              />
              <button className="btn btn-secondary" onClick={() => handleSelectFolder('obsidianVaultPath')}>
                Browse
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Subfolder</label>
            <input
              type="text"
              className="form-input"
              placeholder="Meeting Notes"
              value={settings.obsidianSubfolder || ''}
              onChange={e => updateSetting('obsidianSubfolder', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Daily Notes Folder</label>
            <input
              type="text"
              className="form-input"
              placeholder="(root of vault)"
              value={settings.obsidianDailyNotesFolder || ''}
              onChange={e => updateSetting('obsidianDailyNotesFolder', e.target.value)}
            />
          </div>
        </div>

        {/* Calendar */}
        <div className="settings-section">
          <h2>Calendar Integration</h2>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.icsCalendarEnabled || false}
                onChange={e => updateSetting('icsCalendarEnabled', e.target.checked)}
              />
              Use ICS Calendar URL
            </label>
          </div>
          {settings.icsCalendarEnabled && (
            <div className="form-group">
              <label className="form-label">ICS Feed URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://calendar.example.com/feed.ics"
                value={settings.icsCalendarUrl || ''}
                onChange={e => updateSetting('icsCalendarUrl', e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Paste a webcal/ICS URL from Google Calendar, Outlook, or any calendar app. Events within ±2 hours are shown on the Record screen.
              </div>
            </div>
          )}

          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '12px 0 8px' }}>
            Or connect via OAuth:
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn btn-secondary" onClick={() => window.meetingMind.connectGoogleCalendar()}>
              Connect Google Calendar
            </button>
            <button className="btn btn-secondary" onClick={() => window.meetingMind.connectMicrosoftCalendar()}>
              Connect Microsoft 365
            </button>
          </div>
        </div>

        {/* Claude */}
        <div className="settings-section">
          <h2>Claude AI</h2>
          <div className="form-group">
            <label className="form-label">Notes Provider</label>
            <select
              className="form-select"
              value={settings.notesProvider || 'cli'}
              onChange={e => updateSetting('notesProvider', e.target.value)}
            >
              <option value="cli">Claude Code CLI (uses your subscription)</option>
              <option value="api">Anthropic API (uses API credits)</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {(settings.notesProvider || 'cli') === 'cli'
                ? 'Runs the "claude" CLI in print mode. Requires Claude Code to be installed and authenticated.'
                : 'Uses the Anthropic API directly. Requires an API key above.'}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Model</label>
            <select
              className="form-select"
              value={settings.claudeModel || 'claude-sonnet-4-20250514'}
              onChange={e => updateSetting('claudeModel', e.target.value)}
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Meeting Notes Prompt Template</label>
            <textarea
              className="form-textarea"
              rows={10}
              value={settings.notesPromptTemplate || DEFAULT_PROMPT}
              onChange={e => updateSetting('notesPromptTemplate', e.target.value)}
            />
            <button
              className="btn btn-ghost"
              style={{ marginTop: 4, fontSize: 12 }}
              onClick={() => updateSetting('notesPromptTemplate', DEFAULT_PROMPT)}
            >
              Reset to Default
            </button>
          </div>
        </div>

        {/* Save */}
        <div style={{ position: 'sticky', bottom: 0, padding: '16px 0', background: 'var(--bg-primary)' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%' }}>
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </>
  );
}
