import React, { useState, useEffect, useRef } from 'react';
import AudioMeter from '../components/AudioMeter';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('default');
  const [testLevel, setTestLevel] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [obsidianPath, setObsidianPath] = useState('');

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

  async function handleSaveKeys() {
    setKeyError('');
    if (!assemblyAiKey || !anthropicKey) {
      setKeyError('Both API keys are required.');
      return;
    }

    await window.meetingMind.setApiKey('assemblyai', assemblyAiKey);
    await window.meetingMind.setApiKey('anthropic', anthropicKey);
    setStep(1);
  }

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
    setStep(2);
  }

  async function handleFinish() {
    if (obsidianPath) {
      await window.meetingMind.setSetting('obsidianVaultPath', obsidianPath);
    }
    await window.meetingMind.setSetting('onboardingComplete', true);
    onComplete();
  }

  async function handleSelectVault() {
    const folder = await window.meetingMind.selectFolder();
    if (folder) setObsidianPath(folder);
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
      <div style={{ maxWidth: 460, width: '100%' }}>
        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32, justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: i <= step ? 'var(--accent-blue)' : 'var(--border-color)',
              }}
            />
          ))}
        </div>

        {/* Step 0: API Keys */}
        {step === 0 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Welcome to MeetingMind</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Enter your API keys to get started. You'll need accounts with AssemblyAI and Anthropic.
            </p>

            <div className="form-group">
              <label className="form-label">AssemblyAI API Key</label>
              <input
                type="password"
                className="form-input"
                value={assemblyAiKey}
                onChange={e => setAssemblyAiKey(e.target.value)}
                placeholder="Enter your key"
              />
              <a
                href="#"
                style={{ fontSize: 12, color: 'var(--accent-blue)', display: 'inline-block', marginTop: 4 }}
              >
                Get a key at assemblyai.com
              </a>
            </div>

            <div className="form-group">
              <label className="form-label">Anthropic API Key</label>
              <input
                type="password"
                className="form-input"
                value={anthropicKey}
                onChange={e => setAnthropicKey(e.target.value)}
                placeholder="Enter your key"
              />
              <a
                href="#"
                style={{ fontSize: 12, color: 'var(--accent-blue)', display: 'inline-block', marginTop: 4 }}
              >
                Get a key at console.anthropic.com
              </a>
            </div>

            {keyError && (
              <div style={{ color: 'var(--accent-primary)', fontSize: 13, marginBottom: 12 }}>{keyError}</div>
            )}

            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={handleSaveKeys}>
              Continue
            </button>
          </div>
        )}

        {/* Step 1: Audio Setup */}
        {step === 1 && (
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
                  if (isTesting) {
                    stopTest();
                  }
                }}
              >
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 16 }}>
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
                  <button className="btn btn-ghost" onClick={stopTest}>
                    Stop Test
                  </button>
                </>
              )}
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: 24 }} onClick={handleAudioDone}>
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Integrations */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Integrations</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Connect your calendar and Obsidian. You can set these up later in Settings.
            </p>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Calendar</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => window.meetingMind.connectGoogleCalendar()}>
                  Google Calendar
                </button>
                <button className="btn btn-secondary" onClick={() => window.meetingMind.connectMicrosoftCalendar()}>
                  Microsoft 365
                </button>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Obsidian Vault</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="form-input"
                  value={obsidianPath}
                  readOnly
                  placeholder="Select vault folder (optional)"
                />
                <button className="btn btn-secondary" onClick={handleSelectVault}>
                  Browse
                </button>
              </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleFinish}>
              Get Started
            </button>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={handleFinish}
            >
              Set up later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
