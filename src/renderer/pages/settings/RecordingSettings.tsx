import React, { useState, useEffect } from 'react';

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
  hfToken: string;
  setHfToken: (v: string) => void;
  hasHfToken: boolean;
}

const WHISPERX_MODELS: { value: string; label: string }[] = [
  { value: 'tiny', label: 'tiny — fastest, least accurate' },
  { value: 'base', label: 'base — fast' },
  { value: 'small', label: 'small — balanced' },
  { value: 'medium', label: 'medium — slower, more accurate' },
  { value: 'large-v2', label: 'large-v2 — slow, high accuracy' },
  { value: 'large-v3', label: 'large-v3 — slowest, highest accuracy' },
  { value: 'large-v3-turbo', label: 'large-v3-turbo — fast + high accuracy (recommended)' },
];

export default function RecordingSettings({
  settings, updateSetting,
  assemblyAiKey, setAssemblyAiKey, hasAssemblyKey,
  openaiKey, setOpenaiKey, hasOpenaiKey,
  deepgramKey, setDeepgramKey, hasDeepgramKey,
  hfToken, setHfToken, hasHfToken,
}: Props) {
  const provider = settings.transcriptionProvider || 'assemblyai';

  // WhisperX first-run setup state
  const [whisperxReady, setWhisperxReady] = useState(false);
  const [setupState, setSetupState] = useState<'idle' | 'running' | 'error'>('idle');
  const [setupMessage, setSetupMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    window.meetingMind.checkWhisperXReady().then((r: { ready: boolean }) => {
      if (mounted) setWhisperxReady(!!r?.ready);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Live progress from the main process during setup.
  useEffect(() => {
    if (setupState !== 'running') return;
    const off = window.meetingMind.on('transcription:progress', (data: any) => {
      if (data?.message) setSetupMessage(data.message);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [setupState]);

  async function handleSetupWhisperX() {
    setSetupState('running');
    setSetupMessage('Starting setup...');
    try {
      const result = await window.meetingMind.setupWhisperX();
      if (result?.success) {
        setWhisperxReady(true);
        setSetupState('idle');
        setSetupMessage('');
      } else {
        setSetupState('error');
        setSetupMessage(result?.error || 'Setup failed');
      }
    } catch (err: any) {
      setSetupState('error');
      setSetupMessage(err?.message || 'Setup failed');
    }
  }

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
            <option value="whisperx-local">WhisperX Local — Free (runs on-device)</option>
          </select>
          <div className="form-hint">
            {provider === 'assemblyai' && 'Speaker diarization. Async processing.'}
            {provider === 'openai-whisper' && 'No speaker ID. 25 MB limit per request.'}
            {provider === 'deepgram' && 'Speaker diarization. Real-time capable.'}
            {provider === 'whisperx-local' && 'Runs entirely on your Mac. First use downloads ~1.5 GB of model weights.'}
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
      {provider === 'whisperx-local' && (
        <div className="form-group" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Model Size</label>
            <select
              className="form-select"
              value={settings.whisperxModel || 'large-v3-turbo'}
              onChange={e => updateSetting('whisperxModel', e.target.value)}
            >
              {WHISPERX_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <div className="form-hint">Larger models are more accurate but slower and use more disk space.</div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Language</label>
            <input
              type="text"
              className="form-input"
              placeholder="Auto-detect"
              value={settings.whisperxLanguage || ''}
              onChange={e => updateSetting('whisperxLanguage', e.target.value)}
            />
            <div className="form-hint">Optional ISO 639-1 code (e.g. en, fr, de). Leave blank to auto-detect.</div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">
              HuggingFace Token {hasHfToken && <span className="key-saved">(saved)</span>}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder={hasHfToken ? '••••••••••••••' : 'Optional — required for speaker diarization'}
              value={hfToken}
              onChange={e => setHfToken(e.target.value)}
            />
            <div className="form-hint">
              Without a token, all speech is labeled a single speaker. For diarization you must accept the{' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.meetingMind.openExternal('https://hf.co/pyannote/speaker-diarization-community-1'); }}
                style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                speaker-diarization-community-1
              </a>{' '}model license on HuggingFace (the same account as your token).
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            {whisperxReady ? (
              <div style={{ color: 'var(--success, #3fb950)', fontSize: 13, fontWeight: 500 }}>Ready ✓</div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSetupWhisperX}
                disabled={setupState === 'running'}
              >
                {setupState === 'running' ? 'Setting up…' : 'Set Up WhisperX'}
              </button>
            )}
            {setupState === 'running' && setupMessage && (
              <div className="form-hint" style={{ marginTop: 8 }}>{setupMessage}</div>
            )}
            {setupState === 'error' && setupMessage && (
              <div className="form-hint" style={{ marginTop: 8, color: 'var(--error, #f85149)' }}>{setupMessage}</div>
            )}
          </div>
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

      <label className="form-label settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoNormalizeQuietAudio !== false}
          onChange={e => updateSetting('autoNormalizeQuietAudio', e.target.checked)}
        />
        Auto-normalize quiet audio before transcription
      </label>
      <div className="form-hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Detects low-volume recordings and boosts them so the transcription provider can hear speech. Also auto-retries once if a provider rejects the audio as silent.
      </div>
      <div className="form-group">
        <label className="form-label">Normalization Method</label>
        <select
          className="form-select"
          value={settings.normalizationMethod || 'loudnorm'}
          onChange={e => updateSetting('normalizationMethod', e.target.value)}
          disabled={settings.autoNormalizeQuietAudio === false}
        >
          <option value="loudnorm">Loudnorm EBU R128 (two-pass, broadcast standard)</option>
          <option value="peak">Peak normalization (fast, single-pass)</option>
        </select>
        <div className="form-hint">
          Loudnorm is slower but produces a more consistent loudness target. Peak normalization just boosts gain so the loudest sample hits -1 dBFS.
        </div>
      </div>
    </>
  );
}
