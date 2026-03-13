import React from 'react';

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  assemblyAiKey: string;
  setAssemblyAiKey: (v: string) => void;
  hasAssemblyKey: boolean;
  openaiKey: string;
  setOpenaiKey: (v: string) => void;
  hasOpenaiKey: boolean;
  deepgramKey: string;
  setDeepgramKey: (v: string) => void;
  hasDeepgramKey: boolean;
}

export default function RecordingSettings({
  settings, updateSetting,
  assemblyAiKey, setAssemblyAiKey, hasAssemblyKey,
  openaiKey, setOpenaiKey, hasOpenaiKey,
  deepgramKey, setDeepgramKey, hasDeepgramKey,
}: Props) {
  const provider = settings.transcriptionProvider || 'assemblyai';

  return (
    <>
      <div className="settings-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Audio Input Device</label>
          <select
            className="form-select"
            value={settings.defaultInputDevice || 'default'}
            onChange={e => updateSetting('defaultInputDevice', e.target.value)}
          >
            <option value="default">System Default</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Transcription Provider</label>
          <select
            className="form-select"
            value={provider}
            onChange={e => updateSetting('transcriptionProvider', e.target.value)}
          >
            <option value="assemblyai">AssemblyAI — $0.17/hr</option>
            <option value="openai-whisper">OpenAI Whisper — $0.36/hr</option>
            <option value="deepgram">Deepgram Nova-2 — $0.26/hr</option>
          </select>
          <div className="form-hint">
            {provider === 'assemblyai' && 'Speaker diarization. Async processing.'}
            {provider === 'openai-whisper' && 'No speaker ID. 25 MB limit per request.'}
            {provider === 'deepgram' && 'Speaker diarization. Real-time capable.'}
          </div>
        </div>
      </div>

      {provider === 'assemblyai' && (
        <div className="form-group">
          <label className="form-label">
            AssemblyAI API Key {hasAssemblyKey && <span className="key-saved">(saved)</span>}
          </label>
          <input
            type="password"
            className="form-input"
            placeholder={hasAssemblyKey ? '••••••••••••••' : 'Enter your AssemblyAI API key'}
            value={assemblyAiKey}
            onChange={e => setAssemblyAiKey(e.target.value)}
          />
        </div>
      )}
      {provider === 'openai-whisper' && (
        <div className="form-group">
          <label className="form-label">
            OpenAI API Key {hasOpenaiKey && <span className="key-saved">(saved)</span>}
          </label>
          <input
            type="password"
            className="form-input"
            placeholder={hasOpenaiKey ? '••••••••••••••' : 'Enter your OpenAI API key'}
            value={openaiKey}
            onChange={e => setOpenaiKey(e.target.value)}
          />
        </div>
      )}
      {provider === 'deepgram' && (
        <div className="form-group">
          <label className="form-label">
            Deepgram API Key {hasDeepgramKey && <span className="key-saved">(saved)</span>}
          </label>
          <input
            type="password"
            className="form-input"
            placeholder={hasDeepgramKey ? '••••••••••••••' : 'Enter your Deepgram API key'}
            value={deepgramKey}
            onChange={e => setDeepgramKey(e.target.value)}
          />
        </div>
      )}

      <label className="form-label settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoTranscribe || false}
          onChange={e => updateSetting('autoTranscribe', e.target.checked)}
        />
        Auto-transcribe after recording stops
      </label>
      <label className="form-label settings-toggle">
        <input
          type="checkbox"
          checked={settings.showCostData || false}
          onChange={e => updateSetting('showCostData', e.target.checked)}
        />
        Show transcription cost in meeting detail
      </label>
    </>
  );
}
