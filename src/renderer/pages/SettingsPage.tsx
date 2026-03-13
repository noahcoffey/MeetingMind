import React, { useState, useEffect } from 'react';
import GeneralSettings from './settings/GeneralSettings';
import RecordingSettings from './settings/RecordingSettings';
import AINotesSettings from './settings/AINotesSettings';
import VocabularySettings from './settings/VocabularySettings';
import CalendarSettings from './settings/CalendarSettings';
import ObsidianSettings from './settings/ObsidianSettings';

type SettingsSection = 'general' | 'recording' | 'ai-notes' | 'vocabulary' | 'calendar' | 'obsidian';

const SECTIONS: { key: SettingsSection; label: string; icon: string }[] = [
  { key: 'general', label: 'General', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' },
  { key: 'recording', label: 'Recording & Transcription', icon: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8' },
  { key: 'ai-notes', label: 'AI Notes', icon: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z' },
  { key: 'vocabulary', label: 'Vocabulary', icon: 'M4 7V4h16v3 M9 20h6 M12 4v16' },
  { key: 'calendar', label: 'Calendar', icon: 'M16 2v4 M8 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' },
  { key: 'obsidian', label: 'Obsidian', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8' },
];

interface SettingsPageProps {
  onSettingsChange: () => void;
  initialSection?: SettingsSection;
}

export default function SettingsPage({ onSettingsChange, initialSection }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection || 'general');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [deepgramKey, setDeepgramKey] = useState('');
  const [hasAssemblyKey, setHasAssemblyKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const s = await window.meetingMind.getSettings();
      setSettings(s);
      setHasAssemblyKey(!!(await window.meetingMind.getApiKey('assemblyai')));
      setHasAnthropicKey(!!(await window.meetingMind.getApiKey('anthropic')));
      setHasOpenaiKey(!!(await window.meetingMind.getApiKey('openai')));
      setHasDeepgramKey(!!(await window.meetingMind.getApiKey('deepgram')));
    } catch {
      console.error('Failed to load settings');
    }
  }

  async function handleSave() {
    for (const [key, value] of Object.entries(settings)) {
      await window.meetingMind.setSetting(key, value);
    }
    if (assemblyAiKey) { await window.meetingMind.setApiKey('assemblyai', assemblyAiKey); setHasAssemblyKey(true); setAssemblyAiKey(''); }
    if (anthropicKey) { await window.meetingMind.setApiKey('anthropic', anthropicKey); setHasAnthropicKey(true); setAnthropicKey(''); }
    if (openaiKey) { await window.meetingMind.setApiKey('openai', openaiKey); setHasOpenaiKey(true); setOpenaiKey(''); }
    if (deepgramKey) { await window.meetingMind.setApiKey('deepgram', deepgramKey); setHasDeepgramKey(true); setDeepgramKey(''); }
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

  const currentSection = SECTIONS.find(s => s.key === section)!;

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="page-content" style={{ display: 'flex', gap: 0, height: 'calc(100vh - 112px)' }}>
        {/* Settings nav */}
        <div style={{
          width: 200,
          flexShrink: 0,
          borderRight: '1px solid var(--border-color)',
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: section === s.key ? 'var(--bg-tertiary)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius)',
                color: section === s.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: section === s.key ? 500 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d={s.icon} />
              </svg>
              {s.label}
            </button>
          ))}
        </div>

        {/* Settings content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingLeft: 24 }}>
          <div style={{ flex: 1, overflowY: 'auto', maxWidth: 640 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{currentSection.label}</h2>

            {section === 'general' && (
              <GeneralSettings settings={settings} updateSetting={updateSetting} onSelectFolder={handleSelectFolder} />
            )}
            {section === 'recording' && (
              <RecordingSettings
                settings={settings} updateSetting={updateSetting}
                assemblyAiKey={assemblyAiKey} setAssemblyAiKey={setAssemblyAiKey} hasAssemblyKey={hasAssemblyKey}
                openaiKey={openaiKey} setOpenaiKey={setOpenaiKey} hasOpenaiKey={hasOpenaiKey}
                deepgramKey={deepgramKey} setDeepgramKey={setDeepgramKey} hasDeepgramKey={hasDeepgramKey}
              />
            )}
            {section === 'ai-notes' && (
              <AINotesSettings
                settings={settings} updateSetting={updateSetting}
                anthropicKey={anthropicKey} setAnthropicKey={setAnthropicKey} hasAnthropicKey={hasAnthropicKey}
              />
            )}
            {section === 'vocabulary' && (
              <VocabularySettings settings={settings} updateSetting={updateSetting} />
            )}
            {section === 'calendar' && (
              <CalendarSettings settings={settings} updateSetting={updateSetting} />
            )}
            {section === 'obsidian' && (
              <ObsidianSettings settings={settings} updateSetting={updateSetting} onSelectFolder={handleSelectFolder} />
            )}
          </div>

          {/* Save bar */}
          <div style={{ flexShrink: 0, padding: '12px 0', maxWidth: 640 }}>
            <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%' }}>
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
