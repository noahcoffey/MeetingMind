import React, { useState, useEffect, useRef } from 'react';
import AudioMeter from '../components/AudioMeter';

interface OnboardingFlowProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 4;

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);

  // Step 1: User info
  const [userName, setUserName] = useState('');

  // Step 2: Transcription & notes
  const [transcriptionProvider, setTranscriptionProvider] = useState<'assemblyai' | 'openai-whisper' | 'deepgram'>('assemblyai');
  const [apiKey, setApiKey] = useState('');
  const [notesProvider, setNotesProvider] = useState<'cli' | 'api'>('cli');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  // Step 3: Audio
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('default');
  const [testLevel, setTestLevel] = useState(0);
  const [isTesting, setIsTesting] = useState(false);

  // Step 4: Integrations
  const [obsidianPath, setObsidianPath] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [microsoftConnected, setMicrosoftConnected] = useState(false);

  const testStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    loadDevices();
    return () => stopTest();
  }, []);

  async function loadDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(mediaDevices.filter(d => d.kind === 'audioinput'));
    } catch {
      console.error('Microphone access denied');
    }
  }

  const apiKeyLabel: Record<string, string> = {
    'assemblyai': 'AssemblyAI',
    'openai-whisper': 'OpenAI',
    'deepgram': 'Deepgram',
  };

  const apiKeyService: Record<string, string> = {
    'assemblyai': 'assemblyai',
    'openai-whisper': 'openai',
    'deepgram': 'deepgram',
  };

  // Step 1: Save name
  async function handleNameDone() {
    if (userName.trim()) {
      await window.meetingMind.setSetting('userName', userName.trim());
    }
    setStep(2);
  }

  // Step 2: Save keys
  async function handleSaveKeys() {
    setKeyError('');
    if (!apiKey) {
      setKeyError(`${apiKeyLabel[transcriptionProvider]} API key is required for transcription.`);
      return;
    }
    if (notesProvider === 'api' && !anthropicKey) {
      setKeyError('Anthropic API key is required when using API mode.');
      return;
    }

    await window.meetingMind.setApiKey(apiKeyService[transcriptionProvider], apiKey);
    await window.meetingMind.setSetting('transcriptionProvider', transcriptionProvider);
    await window.meetingMind.setSetting('notesProvider', notesProvider);

    if (anthropicKey) {
      await window.meetingMind.setApiKey('anthropic', anthropicKey);
    }

    setKeySaved(true);
    setTimeout(() => setStep(3), 400);
  }

  // Step 3: Audio
  async function startTest() {
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice !== 'default'
          ? { deviceId: { exact: selectedDevice } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      setIsTesting(true);

      function tick() {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setTestLevel(avg);
        animRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      console.error('Failed to start test');
    }
  }

  function stopTest() {
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(t => t.stop());
      testStreamRef.current = null;
    }
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
    }
    analyserRef.current = null;
    setIsTesting(false);
    setTestLevel(0);
  }

  async function handleAudioDone() {
    stopTest();
    await window.meetingMind.setSetting('defaultInputDevice', selectedDevice);
    setStep(4);
  }

  // Step 4: Finish
  async function handleFinish() {
    if (obsidianPath) {
      await window.meetingMind.setSetting('obsidianVaultPath', obsidianPath);
      await window.meetingMind.setSetting('autoSaveToObsidian', true);
    }
    await window.meetingMind.setSetting('onboardingComplete', true);
    onComplete();
  }

  async function handleSelectVault() {
    const folder = await window.meetingMind.selectFolder();
    if (folder) setObsidianPath(folder);
  }

  async function handleConnectGoogle() {
    try {
      await window.meetingMind.connectGoogleCalendar();
      setGoogleConnected(true);
    } catch {}
  }

  async function handleConnectMicrosoft() {
    try {
      await window.meetingMind.connectMicrosoftCalendar();
      setMicrosoftConnected(true);
    } catch {}
  }

  function goBack() {
    stopTest();
    setStep(s => Math.max(0, s - 1));
  }

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
      background: 'var(--bg-primary)',
    }}>
      <div style={{ maxWidth: 500, width: '100%' }}>
        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 32, justifyContent: 'center' }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              style={{
                width: 48,
                height: 4,
                borderRadius: 2,
                background: i < step ? 'var(--accent-blue)' : i === step ? 'var(--accent-blue)' : 'var(--border-color)',
                opacity: i < step ? 0.5 : 1,
                transition: 'all 300ms ease',
              }}
            />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" fill="var(--accent-blue)" />
              </svg>
            </div>
            <h1 style={{ fontSize: 28, marginBottom: 8, fontWeight: 600 }}>Welcome to MeetingMind</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 8, fontSize: 15, lineHeight: 1.6 }}>
              Record meetings, get AI-powered transcriptions, and generate structured notes automatically.
            </p>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 13 }}>
              Let's get you set up in a few quick steps.
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px 20px', fontSize: 15 }}
              onClick={() => setStep(1)}
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step 1: Your Name */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>About You</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Your name is used to identify you in meeting notes and action items.
            </p>

            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input
                type="text"
                className="form-input"
                value={userName}
                onChange={e => setUserName(e.target.value)}
                placeholder="e.g. Noah"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && userName.trim()) handleNameDone(); }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={goBack}>Back</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleNameDone}
                disabled={!userName.trim()}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Transcription & Notes */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>AI Services</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Choose your transcription provider and notes generation method.
            </p>

            {/* Transcription provider */}
            <div className="form-group">
              <label className="form-label">Transcription Provider</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {([
                  { id: 'assemblyai' as const, name: 'AssemblyAI', price: '$0.17/hr', desc: 'Speaker identification included' },
                  { id: 'openai-whisper' as const, name: 'OpenAI Whisper', price: '$0.36/hr', desc: 'No speaker identification' },
                  { id: 'deepgram' as const, name: 'Deepgram', price: '$0.26/hr', desc: 'Fast, speaker identification included' },
                ]).map(p => (
                  <div
                    key={p.id}
                    onClick={() => { setTranscriptionProvider(p.id); setApiKey(''); setKeySaved(false); }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${transcriptionProvider === p.id ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                      background: transcriptionProvider === p.id ? 'var(--accent-blue-subtle)' : 'var(--bg-card)',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.price}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* API key for selected provider */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">
                {apiKeyLabel[transcriptionProvider]} API Key
                {keySaved && <span style={{ color: 'var(--accent-green)', marginLeft: 8 }}>Saved</span>}
              </label>
              <input
                type="password"
                className="form-input"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setKeySaved(false); }}
                placeholder={`Enter your ${apiKeyLabel[transcriptionProvider]} API key`}
              />
            </div>

            {/* Notes generation */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Meeting Notes Generation</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  className={`btn ${notesProvider === 'cli' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={() => setNotesProvider('cli')}
                >
                  Claude Code CLI
                </button>
                <button
                  className={`btn ${notesProvider === 'api' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={() => setNotesProvider('api')}
                >
                  Anthropic API
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {notesProvider === 'cli'
                  ? 'Uses your Claude Code subscription. Requires the claude CLI installed.'
                  : 'Uses the Anthropic API directly. Requires an API key (pay per token).'}
              </p>
            </div>

            {notesProvider === 'api' && (
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Anthropic API Key</label>
                <input
                  type="password"
                  className="form-input"
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  placeholder="Enter your Anthropic API key"
                />
              </div>
            )}

            {keyError && (
              <div style={{ color: 'var(--accent-primary)', fontSize: 13, marginTop: 8 }}>{keyError}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={goBack}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveKeys}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Audio Setup */}
        {step === 3 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Audio Setup</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Select your microphone and test that it's picking up sound.
            </p>

            <div className="form-group">
              <label className="form-label">Input Device</label>
              <select
                className="form-select"
                value={selectedDevice}
                onChange={e => {
                  setSelectedDevice(e.target.value);
                  if (isTesting) stopTest();
                }}
              >
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                  </option>
                ))}
              </select>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              marginTop: 20,
              padding: 20,
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-color)',
            }}>
              {!isTesting ? (
                <button className="btn btn-secondary" onClick={startTest}>
                  Test Microphone
                </button>
              ) : (
                <>
                  <AudioMeter level={testLevel} active={true} />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Speak to test your microphone...
                  </span>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={stopTest}>
                    Stop Test
                  </button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={goBack}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleAudioDone}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Integrations */}
        {step === 4 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Integrations</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Optionally connect your calendar and Obsidian vault. You can always set these up later in Settings.
            </p>

            {/* Calendar */}
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Calendar</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Link your calendar to auto-fill meeting titles and attendees.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn ${googleConnected ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={handleConnectGoogle}
                  style={{ fontSize: 12 }}
                >
                  {googleConnected ? 'Google Connected' : 'Google Calendar'}
                </button>
                <button
                  className={`btn ${microsoftConnected ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={handleConnectMicrosoft}
                  style={{ fontSize: 12 }}
                >
                  {microsoftConnected ? 'Microsoft Connected' : 'Microsoft 365'}
                </button>
              </div>
            </div>

            {/* Obsidian */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Obsidian Vault</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Auto-save meeting notes to your Obsidian vault.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="form-input"
                  value={obsidianPath}
                  readOnly
                  placeholder="No vault selected (optional)"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={handleSelectVault} style={{ fontSize: 12 }}>
                  Browse
                </button>
              </div>
              {obsidianPath && (
                <div style={{ fontSize: 11, color: 'var(--accent-green)', marginTop: 6 }}>
                  Notes will be saved to {obsidianPath}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={goBack}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1, padding: '10px 20px' }} onClick={handleFinish}>
                {obsidianPath || googleConnected || microsoftConnected ? 'Get Started' : 'Skip & Get Started'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
