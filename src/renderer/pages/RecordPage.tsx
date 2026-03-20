import React, { useState, useEffect, useRef } from 'react';

interface RecordPageProps {
  onRecordingComplete?: (recordingId: string) => void;
  onRecordingSaved?: (recordingId: string) => void;
  activeNotebook?: string;
}

type PipelineStage = 'idle' | 'recording' | 'stopping' | 'merging' | 'complete';

export default function RecordPage({ onRecordingComplete, onRecordingSaved, activeNotebook }: RecordPageProps) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('default');
  const [systemAudioDevices, setSystemAudioDevices] = useState<any[]>([]);
  const [selectedSystemDevice, setSelectedSystemDevice] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [userContext, setUserContext] = useState('');
  const [chunkCount, setChunkCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [diskWarning, setDiskWarning] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState('');
  const [completedRecordingId, setCompletedRecordingId] = useState<string | null>(null);
  const [recordingResult, setRecordingResult] = useState<{ duration: number; fileSize: number } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const nextMeetingRef = useRef<HTMLDivElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformHistoryRef = useRef<number[]>([]);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);

  const hasCalendar = calendarEvents.length > 0;
  const isRecording = stage === 'recording';
  const isProcessing = stage === 'stopping' || stage === 'merging';

  useEffect(() => {
    loadDevices();
    loadSystemAudioDevices();
    loadCalendarEvents();
    setupListeners();

    return () => {
      cleanupListeners();
      if (timerRef.current) clearInterval(timerRef.current);
      stopAudioLevelMonitor();
    };
  }, []);

  useEffect(() => {
    if (nextMeetingRef.current) {
      nextMeetingRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [calendarEvents]);

  useEffect(() => {
    if (!isRecording) return;
    const container = waveformContainerRef.current;
    const canvas = waveformCanvasRef.current;
    if (!container || !canvas) return;

    const sync = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(container.clientWidth * dpr);
      if (canvas.width !== w) canvas.width = w;
    };
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(container);
    return () => observer.disconnect();
  });

  async function loadDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = mediaDevices.filter(d => d.kind === 'audioinput');
      setDevices(audioInputs);
    } catch {
      console.error('Failed to enumerate devices');
    }
  }

  async function loadSystemAudioDevices() {
    try {
      const devs = await window.meetingMind.getSystemAudioDevices();
      setSystemAudioDevices(devs);
    } catch {}
  }

  async function loadCalendarEvents(bypassCache = false) {
    try {
      const events = await window.meetingMind.getCalendarEvents(bypassCache);
      setCalendarEvents(events);
    } catch {}
  }

  function setupListeners() {
    window.meetingMind.on('recording:chunk', (count: unknown) => {
      setChunkCount(count as number);
    });
    window.meetingMind.on('recording:paused', (paused: unknown) => {
      setIsPaused(paused as boolean);
    });
    window.meetingMind.on('recording:disk-warning', (warning: unknown) => {
      setDiskWarning(warning as string);
    });
  }

  function cleanupListeners() {
    window.meetingMind.removeAllListeners('recording:chunk');
    window.meetingMind.removeAllListeners('recording:paused');
    window.meetingMind.removeAllListeners('recording:disk-warning');
  }

  async function startAudioLevelMonitor() {
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice !== 'default'
          ? { deviceId: { exact: selectedDevice } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      function tick() {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setAudioLevel(avg);

        const history = waveformHistoryRef.current;
        history.push(avg);
        const canvas = waveformCanvasRef.current;
        if (canvas) {
          const maxSamples = Math.floor(canvas.width / 3);
          if (history.length > maxSamples) {
            history.splice(0, history.length - maxSamples);
          }
          drawWaveform(canvas, history);
        }

        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (err) {
      console.error('Failed to start audio level monitor', err);
    }
  }

  function stopAudioLevelMonitor() {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    analyserRef.current = null;
    setAudioLevel(0);
    waveformHistoryRef.current = [];
  }

  function drawWaveform(canvas: HTMLCanvasElement, history: number[]) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const barWidth = 2 * dpr;
    const gap = 1 * dpr;
    const step = barWidth + gap;
    const centerY = h / 2;

    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ef4444');
    grad.addColorStop(0.15, '#f472b6');
    grad.addColorStop(0.3, '#a855f7');
    grad.addColorStop(0.45, '#6366f1');
    grad.addColorStop(0.5, '#10b981');
    grad.addColorStop(0.55, '#6366f1');
    grad.addColorStop(0.7, '#a855f7');
    grad.addColorStop(0.85, '#f472b6');
    grad.addColorStop(1, '#ef4444');

    const startX = w - history.length * step;
    for (let i = 0; i < history.length; i++) {
      const level = history[i];
      const barH = Math.max(2 * dpr, level * (h - 4));
      const x = startX + i * step;
      if (x + barWidth < 0) continue;

      const halfBar = barH / 2;

      if (level > 0.05) {
        ctx.globalAlpha = 0.4 + level * 0.6;
        ctx.fillStyle = grad;
      } else {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-idle').trim() || '#334155';
      }

      ctx.fillRect(x, centerY - halfBar, barWidth, barH);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-center').trim() || 'rgba(148, 163, 184, 0.08)';
    ctx.fillRect(0, centerY, w, 1);
  }

  function handleSelectEvent(event: any) {
    if (selectedEvent?.id === event.id) {
      setSelectedEvent(null);
      setMeetingTitle('');
    } else {
      setSelectedEvent(event);
      setMeetingTitle(event.title);
    }
  }

  async function handlePauseResume() {
    if (isPaused) {
      const result = await window.meetingMind.resumeRecording();
      if (result.success) {
        pausedDurationRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = 0;
        timerRef.current = setInterval(() => {
          const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
          setDuration(Math.floor(elapsed / 1000));
        }, 1000);
        startAudioLevelMonitor();
      }
    } else {
      const result = await window.meetingMind.pauseRecording();
      if (result.success) {
        pauseStartRef.current = Date.now();
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stopAudioLevelMonitor();
      }
    }
  }

  async function handleToggleRecording() {
    if (stage === 'recording') {
      setStage('stopping');
      setPipelineMessage('Stopping recording...');
      stopAudioLevelMonitor();
      setIsPaused(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      setPipelineMessage('Merging audio chunks and applying noise filter...');
      setStage('merging');

      const result = await window.meetingMind.stopRecording();

      if (result.success && result.recordingId) {
        setCompletedRecordingId(result.recordingId);

        const rec = await window.meetingMind.getRecording(result.recordingId);
        if (rec) {
          setRecordingResult({ duration: rec.duration, fileSize: rec.fileSize });
        }

        setStage('complete');
        setPipelineMessage('Recording saved!');

        if (onRecordingSaved) {
          onRecordingSaved(result.recordingId);
        }
      } else {
        setStage('idle');
        setPipelineMessage(`Recording failed: ${result.error}`);
      }
    } else if (stage === 'idle' || stage === 'complete') {
      setStage('recording');
      setDuration(0);
      setChunkCount(0);
      setIsPaused(false);
      setCompletedRecordingId(null);
      setRecordingResult(null);
      setPipelineMessage('');
      setDiskWarning(null);
      pausedDurationRef.current = 0;
      pauseStartRef.current = 0;

      const result = await window.meetingMind.startRecording(
        selectedDevice,
        selectedSystemDevice || undefined,
        selectedEvent?.id,
        userContext || undefined,
        meetingTitle || undefined,
        activeNotebook || undefined,
      );
      if (result.success) {
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
          const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
          setDuration(Math.floor(elapsed / 1000));
        }, 1000);
        startAudioLevelMonitor();
      } else {
        setStage('idle');
        setPipelineMessage(`Failed to start: ${result.error}`);
      }
    }
  }

  function handleViewRecording() {
    if (completedRecordingId && onRecordingComplete) {
      onRecordingComplete(completedRecordingId);
    }
  }

  function handleReset() {
    setStage('idle');
    setPipelineMessage('');
    setCompletedRecordingId(null);
    setRecordingResult(null);
    setDuration(0);
    setChunkCount(0);
  }

  async function handleDiscardConfirm() {
    setShowDiscardModal(false);
    stopAudioLevelMonitor();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    await window.meetingMind.cancelRecording();

    setStage('idle');
    setDuration(0);
    setChunkCount(0);
    setIsPaused(false);
    setPipelineMessage('');
    setDiskWarning(null);
    pausedDurationRef.current = 0;
    pauseStartRef.current = 0;
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleTestAudio() {
    if (audioTestRunning) return;
    setAudioTestRunning(true);
    setMicTestLevel(null);
    setSysTestLevel(null);
    setMicTestResult(null);
    setSysTestResult(null);
    micTestPeakRef.current = 0;

    // Test mic via Web Audio API
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice !== 'default'
          ? { deviceId: { exact: selectedDevice } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micTestStreamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      micTestIntervalRef.current = setInterval(() => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setMicTestLevel(avg);
        if (avg > micTestPeakRef.current) micTestPeakRef.current = avg;
      }, 100);

      // Run for 4 seconds
      setTimeout(() => {
        if (micTestIntervalRef.current) clearInterval(micTestIntervalRef.current);
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        micTestStreamRef.current = null;
        setMicTestResult(micTestPeakRef.current > 0.02 ? 'pass' : 'fail');
        setMicTestLevel(null);
      }, 4000);
    } catch {
      setMicTestResult('fail');
    }

    // Test system audio via ffmpeg (if selected)
    if (selectedSystemDevice) {
      try {
        const result = await (window.meetingMind as any).testSystemAudio(selectedSystemDevice);
        if (result.success) {
          setSysTestLevel(result.peakLevel);
          setSysTestResult(result.peakLevel > 0.02 ? 'pass' : 'fail');
        } else {
          setSysTestResult('fail');
        }
      } catch {
        setSysTestResult('fail');
      }
    } else {
      setSysTestResult('skip');
    }

    // Wait for mic test to finish before clearing running state
    setTimeout(() => {
      setAudioTestRunning(false);
    }, 4200);
  }

  const now = Date.now();
  const nextEventIndex = calendarEvents.findIndex(e => new Date(e.startTime).getTime() > now);

  function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatEventTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function isEventPast(event: any): boolean {
    return new Date(event.endTime).getTime() < now;
  }

  function isEventNow(event: any): boolean {
    const start = new Date(event.startTime).getTime();
    const end = new Date(event.endTime).getTime();
    return start <= now && end >= now;
  }

  const dayGroups: { label: string; events: any[] }[] = [];
  for (const event of calendarEvents) {
    const label = getDayLabel(event.startTime);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) {
      last.events.push(event);
    } else {
      dayGroups.push({ label, events: [event] });
    }
  }

  const hasSystemDevices = systemAudioDevices.length > 0;
  const hasVirtualDevice = systemAudioDevices.some((d: any) => d.isVirtual);
  const [showAudioSetup, setShowAudioSetup] = useState(false);
  const [dismissedAudioSetup, setDismissedAudioSetup] = useState(false);
  const [audioTestRunning, setAudioTestRunning] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState<number | null>(null);
  const [sysTestLevel, setSysTestLevel] = useState<number | null>(null);
  const [micTestResult, setMicTestResult] = useState<'pass' | 'fail' | null>(null);
  const [sysTestResult, setSysTestResult] = useState<'pass' | 'fail' | 'skip' | null>(null);
  const micTestIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestPeakRef = useRef<number>(0);

  return (
    <div className="rp-root">
      {/* Main column */}
      <div className="rp-main">
        {/* Header — only in non-recording states */}
        {!isRecording && (
          <div className="rp-header">
            <h1>Record</h1>
          </div>
        )}

        {/* ─── Recording bar: waveform + controls ─── */}
        {isRecording && (
          <div className="rp-recording-bar" style={{ paddingTop: 'var(--titlebar-height)' }}>
            <div className="rp-waveform-section">
              <div className={`rp-rec-indicator ${isPaused ? 'paused' : 'active'}`} />

              <div className="rp-waveform-wrap" ref={waveformContainerRef}>
                <canvas
                  ref={waveformCanvasRef}
                  height={80 * (window.devicePixelRatio || 1)}
                />
              </div>

              <div className={`rp-timer ${isPaused ? 'paused' : ''}`}>
                {formatDuration(duration)}
              </div>
            </div>

            <div className="rp-controls">
              <button
                className="rp-ctrl-btn pause"
                onClick={handlePauseResume}
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                )}
                {isPaused ? 'Resume' : 'Pause'}
              </button>

              <button
                className="rp-ctrl-btn stop"
                onClick={handleToggleRecording}
                title="Stop Recording"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                Stop
              </button>

              <button
                className="rp-ctrl-btn discard"
                onClick={() => setShowDiscardModal(true)}
                title="Discard"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>

            {isPaused && (
              <div className="rp-paused-banner">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Recording paused
              </div>
            )}
          </div>
        )}

        {/* ─── Body ─── */}
        <div className="rp-body">
          {/* ─── Idle: centered studio layout ─── */}
          {(stage === 'idle' || stage === 'complete') && !isProcessing && stage !== 'complete' && (
            <div className="rp-idle-stage">
              {/* Record button hero */}
              <div className="rp-record-hero">
                <div className="rp-hero-label">Ready to Record</div>
                <button
                  className="record-button"
                  onClick={handleToggleRecording}
                  disabled={isProcessing}
                  title="Start Recording"
                >
                  <div className="record-inner" />
                </button>
              </div>

              {/* Title + Context */}
              <div className="rp-fields">
                <div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Meeting title (optional)"
                    value={meetingTitle}
                    onChange={e => setMeetingTitle(e.target.value)}
                    style={{ fontSize: 14 }}
                  />
                </div>
                <div>
                  <textarea
                    className="form-textarea"
                    placeholder="Context for Claude (e.g. 'Sprint planning for Q2')"
                    value={userContext}
                    onChange={e => setUserContext(e.target.value)}
                    rows={2}
                    style={{ minHeight: 56, fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Device pickers */}
              <div className={`rp-devices ${!hasSystemDevices ? 'single-col' : ''}`}>
                <div className="rp-device-group">
                  <label>Microphone</label>
                  <select
                    value={selectedDevice}
                    onChange={e => setSelectedDevice(e.target.value)}
                  >
                    {devices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                      </option>
                    ))}
                    {devices.length === 0 && <option value="default">Default Microphone</option>}
                  </select>
                </div>

                {hasSystemDevices && (
                  <div className="rp-device-group">
                    <label>System Audio</label>
                    <select
                      value={selectedSystemDevice}
                      onChange={e => setSelectedSystemDevice(e.target.value)}
                    >
                      <option value="">None — mic only</option>
                      {systemAudioDevices.map(d => (
                        <option key={d.index} value={String(d.index)}>
                          {d.name}{d.isVirtual ? ' (virtual)' : ''}
                        </option>
                      ))}
                    </select>
                    {!selectedSystemDevice && (
                      <div style={{
                        fontSize: 12,
                        color: 'var(--accent-yellow)',
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}>
                        System audio not selected — only your microphone will be recorded.
                        Zoom/Teams/Meet participants won't be captured.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Audio test button + results */}
              <div style={{ width: '100%', maxWidth: 440 }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleTestAudio}
                  disabled={audioTestRunning || isRecording}
                  style={{ fontSize: 12, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {audioTestRunning ? (
                    <>
                      <span className="rp-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      Testing...
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      Test Audio
                    </>
                  )}
                </button>

                {/* Test results */}
                {(micTestResult || sysTestResult) && !audioTestRunning && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: micTestResult === 'pass' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 14 }}>
                        {micTestResult === 'pass' ? '\u2713' : '\u2717'}
                      </span>
                      <span style={{ color: 'var(--text-primary)' }}>Microphone</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {micTestResult === 'pass' ? 'Audio detected' : 'No audio detected'}
                      </span>
                    </div>
                    {sysTestResult && sysTestResult !== 'skip' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: sysTestResult === 'pass' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 14 }}>
                          {sysTestResult === 'pass' ? '\u2713' : '\u2717'}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>System Audio</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {sysTestResult === 'pass' ? 'Audio detected' : 'No audio detected — check setup guide below'}
                        </span>
                      </div>
                    )}
                    {sysTestResult === 'skip' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>—</span>
                        <span style={{ color: 'var(--text-muted)' }}>System Audio</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>Not selected</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Live level during test */}
                {audioTestRunning && micTestLevel !== null && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', minWidth: 80 }}>Microphone</span>
                      <div style={{
                        flex: 1,
                        height: 6,
                        background: 'var(--bg-input)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${Math.min(100, micTestLevel * 500)}%`,
                          height: '100%',
                          background: micTestLevel > 0.02 ? 'var(--accent-green)' : 'var(--text-muted)',
                          borderRadius: 3,
                          transition: 'width 0.1s',
                        }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Listening... speak or play audio to test
                    </div>
                  </div>
                )}
              </div>

              {/* System audio setup guide */}
              {!hasVirtualDevice && !dismissedAudioSetup && (
                <div style={{
                  background: 'var(--accent-yellow-tint)',
                  border: '1px solid var(--accent-yellow)',
                  borderRadius: 'var(--radius)',
                  padding: '12px 14px',
                  width: '100%',
                  maxWidth: 440,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        System Audio Not Available
                      </span>
                    </div>
                    <button
                      onClick={() => setDismissedAudioSetup(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 16, lineHeight: 1 }}
                    >&times;</button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                    Without a virtual audio device, MeetingMind can only record your microphone.
                    Audio from Zoom, Teams, or Meet participants won't be captured.
                  </div>
                  {!showAudioSetup ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowAudioSetup(true)}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                    >
                      Show Setup Guide
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Install BlackHole (free virtual audio driver):</div>
                      <div style={{ fontFamily: 'monospace', background: 'var(--bg-input)', padding: '6px 10px', borderRadius: 4, marginBottom: 10, fontSize: 11 }}>
                        brew install blackhole-2ch
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Then set up a Multi-Output Device:</div>
                      <ol style={{ margin: '0 0 0 16px', padding: 0 }}>
                        <li style={{ marginBottom: 4 }}>Open <strong>Audio MIDI Setup</strong> (search in Spotlight)</li>
                        <li style={{ marginBottom: 4 }}>Click <strong>+</strong> at bottom-left, select <strong>Create Multi-Output Device</strong></li>
                        <li style={{ marginBottom: 4 }}>Check both your speakers/headphones <strong>and</strong> BlackHole 2ch</li>
                        <li style={{ marginBottom: 4 }}>Go to <strong>System Settings &gt; Sound &gt; Output</strong>, select the Multi-Output Device</li>
                        <li>Restart MeetingMind — BlackHole will appear in the System Audio dropdown above</li>
                      </ol>
                      <button
                        className="btn btn-secondary"
                        onClick={async () => {
                          await loadSystemAudioDevices();
                          if (systemAudioDevices.some((d: any) => d.isVirtual)) {
                            setShowAudioSetup(false);
                          }
                        }}
                        style={{ fontSize: 12, padding: '4px 12px', marginTop: 10 }}
                      >
                        Refresh Devices
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {pipelineMessage && (
                <div className="rp-error">{pipelineMessage}</div>
              )}

              {/* Disk warning */}
              {diskWarning && (
                <div className={`disk-warning rp-disk-warning ${diskWarning === 'critical' ? 'critical' : ''}`}>
                  {diskWarning === 'critical'
                    ? 'Disk space critically low! Recording paused.'
                    : 'Low disk space warning — less than 500MB remaining'}
                </div>
              )}
            </div>
          )}

          {/* ─── Recording: editable fields below waveform ─── */}
          {isRecording && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 20 }}>
              <div className="rp-fields">
                <div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Meeting title (optional)"
                    value={meetingTitle}
                    onChange={e => setMeetingTitle(e.target.value)}
                    style={{ fontSize: 14 }}
                  />
                </div>
                <div>
                  <textarea
                    className="form-textarea"
                    placeholder="Context for Claude (e.g. 'Sprint planning for Q2')"
                    value={userContext}
                    onChange={e => setUserContext(e.target.value)}
                    rows={2}
                    style={{ minHeight: 56, fontSize: 13 }}
                  />
                </div>
              </div>

              {diskWarning && (
                <div className={`disk-warning rp-disk-warning ${diskWarning === 'critical' ? 'critical' : ''}`}>
                  {diskWarning === 'critical'
                    ? 'Disk space critically low! Recording paused.'
                    : 'Low disk space warning — less than 500MB remaining'}
                </div>
              )}
            </div>
          )}

          {/* ─── Processing ─── */}
          {isProcessing && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="rp-status-card">
                <div className="rp-spinner" />
                <div className="rp-status-title">
                  {stage === 'stopping' ? 'Stopping...' : 'Processing Audio'}
                </div>
                <div className="rp-status-msg">{pipelineMessage}</div>
              </div>
            </div>
          )}

          {/* ─── Complete ─── */}
          {stage === 'complete' && completedRecordingId && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="rp-status-card">
                <svg className="rp-complete-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div className="rp-status-title">{pipelineMessage}</div>
                {recordingResult && (
                  <div className="rp-complete-meta">
                    {formatDuration(recordingResult.duration)} &middot; {formatFileSize(recordingResult.fileSize)}
                  </div>
                )}
                <div className="rp-complete-actions">
                  <button className="btn btn-primary" onClick={handleViewRecording}>
                    View Meeting
                  </button>
                  <button className="btn btn-secondary" onClick={handleReset}>
                    New Meeting
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Calendar sidebar ─── */}
      {hasCalendar && (
        <div className="rp-calendar">
          <div className="rp-cal-header">
            <span>Meetings</span>
            <button
              className="btn btn-ghost"
              onClick={() => loadCalendarEvents(true)}
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              Refresh
            </button>
          </div>

          <div className="rp-cal-list">
            {dayGroups.map(group => (
              <div key={group.label}>
                <div className="rp-cal-day-label">{group.label}</div>

                {group.events.map((event) => {
                  const globalIdx = calendarEvents.indexOf(event);
                  const isNext = globalIdx === nextEventIndex;
                  const isPast = isEventPast(event);
                  const isCurrent = isEventNow(event);
                  const isSelected = selectedEvent?.id === event.id;

                  const classes = [
                    'rp-cal-event',
                    isNext && !isCurrent ? 'next' : '',
                    isCurrent ? 'now' : '',
                    isSelected ? 'selected' : '',
                    isPast && !isCurrent ? 'past' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={event.id}
                      ref={isNext ? nextMeetingRef : undefined}
                      onClick={() => handleSelectEvent(event)}
                      className={classes}
                    >
                      <div className="rp-cal-event-time">
                        {formatEventTime(event.startTime)}
                        {isCurrent && !isSelected && (
                          <span className="rp-cal-event-badge" style={{ color: 'var(--accent-green)' }}>NOW</span>
                        )}
                        {isNext && !isCurrent && !isSelected && (
                          <span className="rp-cal-event-badge" style={{ color: 'var(--accent-blue)' }}>NEXT</span>
                        )}
                      </div>
                      <div className="rp-cal-event-title">{event.title}</div>
                      <div className="rp-cal-event-detail">
                        {formatEventTime(event.startTime)} – {formatEventTime(event.endTime)}
                        {event.attendees?.length > 0 && (
                          <span> &middot; {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {calendarEvents.length === 0 && (
              <div className="rp-cal-empty">No meetings in the next 24 hours</div>
            )}
          </div>
        </div>
      )}

      {/* ─── Discard modal ─── */}
      {showDiscardModal && (
        <div className="rp-modal-backdrop" onClick={() => setShowDiscardModal(false)}>
          <div className="rp-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
              <div className="rp-modal-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <div className="rp-modal-title">Discard Meeting?</div>
                <div className="rp-modal-desc">
                  This will stop the recording and permanently delete all captured audio. This cannot be undone.
                </div>
              </div>
            </div>

            {duration > 0 && (
              <div className="rp-modal-detail">
                You will lose <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(duration)}</strong> of recorded audio
                {chunkCount > 0 && <span> ({chunkCount} chunk{chunkCount !== 1 ? 's' : ''})</span>}.
              </div>
            )}

            <div className="rp-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowDiscardModal(false)}>
                Keep Recording Data
              </button>
              <button className="btn btn-danger" onClick={handleDiscardConfirm}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
