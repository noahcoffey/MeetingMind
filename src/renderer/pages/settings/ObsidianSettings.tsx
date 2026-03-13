import React from 'react';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  onSelectFolder: (key: string) => void;
}

export default function ObsidianSettings({ settings, updateSetting, onSelectFolder }: Props) {
  return (
    <>
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
          <button className="btn btn-secondary" onClick={() => onSelectFolder('obsidianVaultPath')}>
            Browse
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Subfolder</label>
          <input
            type="text"
            className="form-input"
            placeholder="Meeting Notes"
            value={settings.obsidianSubfolder || ''}
            onChange={e => updateSetting('obsidianSubfolder', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
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
      <label className="form-label settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoSaveToObsidian || false}
          onChange={e => updateSetting('autoSaveToObsidian', e.target.checked)}
        />
        Auto-save notes to Obsidian
      </label>
    </>
  );
}
