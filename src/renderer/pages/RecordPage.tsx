import React, { useState, useEffect, useRef } from 'react';
import AudioMeter from '../components/AudioMeter';

interface RecordPageProps {
  onRecordingComplete?: (recordingId: string) => void;
  onRecordingSaved?: (recordingId: string) => void;
}

type PipelineStage = 'idle' | 'recording' | 'stopping' | 'merging' | 'complete';

export default function RecordPage({ onRecordingComplete, onRecordingSaved }: RecordPageProps) {
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

  // Scroll to next meeting when events load
  useEffect(() => {
    if (nextMeetingRef.current) {
      nextMeetingRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [calendarEvents]);

  // Keep canvas pixel width in sync with layout for crisp rendering
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

        // Push to waveform history and draw
        const history = waveformHistoryRef.current;
        history.push(avg);
        const canvas = waveformCanvasRef.current;
        if (canvas) {
          const maxSamples = Math.floor(canvas.width / 3); // 2px bar + 1px gap
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

    // Create a vertical gradient: green at center → cyan → blue → purple → pink → red at peaks
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ef4444');    // red at top peak
    grad.addColorStop(0.1, '#f472b6'); // pink
    grad.addColorStop(0.2, '#a855f7'); // purple
    grad.addColorStop(0.3, '#6366f1'); // indigo
    grad.addColorStop(0.4, '#3b82f6'); // blue
    grad.addColorStop(0.5, '#10b981'); // emerald at center
    grad.addColorStop(0.6, '#3b82f6'); // blue
    grad.addColorStop(0.7, '#6366f1'); // indigo
    grad.addColorStop(0.8, '#a855f7'); // purple
    grad.addColorStop(0.9, '#f472b6'); // pink
    grad.addColorStop(1, '#ef4444');   // red at bottom peak

    // Draw from right edge, scrolling left
    const startX = w - history.length * step;
    for (let i = 0; i < history.length; i++) {
      const level = history[i];
      const barH = Math.max(2 * dpr, level * (h - 4));
      const x = startX + i * step;
      if (x + barWidth < 0) continue;

      const halfBar = barH / 2;

      if (level > 0.05) {
        // Fade opacity slightly for quieter bars
        const alpha = 0.4 + level * 0.6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = grad;
      } else {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#334155';
      }

      ctx.fillRect(x, centerY - halfBar, barWidth, barH);
    }

    ctx.globalAlpha = 1;

    // Subtle center line
    ctx.fillStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.fillRect(0, centerY, w, 1);
  }

  function handleSelectEvent(event: any) {
    if (selectedEvent?.id === event.id) {
      // Deselect
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
        // Accumulate the paused duration
        pausedDurationRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = 0;
        // Restart the timer
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

        // Hand off background processing (transcription + notes) to App
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

  // Determine the next upcoming meeting
  const now = Date.now();
  const nextEventIndex = calendarEvents.findIndex(e => new Date(e.startTime).getTime() > now);

  // Group events by day label
  function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
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

  const isProcessing = stage === 'stopping' || stage === 'merging';

  // Build day groups for the event list
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

  const isRecording = stage === 'recording';

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Main recording column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="page-header">
          <h1>Record</h1>
        </div>

        {/* Recording control bar — shown when actively recording */}
        {isRecording && (
          <div style={{
            padding: '12px 28px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexShrink: 0,
          }}>
            {/* Audio visualization — takes available space */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Recording indicator dot */}
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isPaused ? 'var(--accent-yellow)' : 'var(--accent-primary)',
                animation: isPaused ? 'none' : 'pulse-dot 1.5s ease-in-out infinite',
                flexShrink: 0,
              }} />

              {/* Scrolling waveform */}
              <div ref={waveformContainerRef} style={{ flex: 1, height: 120, borderRadius: 6, overflow: 'hidden' }}>
                <canvas
                  ref={waveformCanvasRef}
                  height={120 * (window.devicePixelRatio || 1)}
                  style={{ width: '100%', height: 120, display: 'block' }}
                />
              </div>

              {/* Timer */}
              <div style={{
                fontVariantNumeric: 'tabular-nums',
                fontSize: 18,
                fontWeight: 500,
                letterSpacing: 1,
                color: isPaused ? 'var(--accent-yellow)' : 'var(--text-primary)',
                flexShrink: 0,
                minWidth: 80,
                textAlign: 'right',
              }}>
                {formatDuration(duration)}
              </div>
            </div>

            {/* Control buttons */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="btn btn-secondary"
                onClick={handlePauseResume}
                style={{ padding: '6px 12px', fontSize: 13 }}
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                )}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleToggleRecording}
                style={{ padding: '6px 12px', fontSize: 13 }}
                title="Stop Recording"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                Stop
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowDiscardModal(true)}
                style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-muted)' }}
                title="Discard"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          padding: '20px 28px 28px',
          overflowY: 'auto',
        }}>

          {/* Title field — always visible */}
          <div style={{ width: '100%', maxWidth: 500 }}>
            <label className="form-label">Recording Title</label>
            <input
              type="text"
              className="form-input"
              placeholder="Untitled Recording"
              value={meetingTitle}
              onChange={e => setMeetingTitle(e.target.value)}
              disabled={isProcessing}
              style={{ fontSize: 15, fontWeight: 500 }}
            />
          </div>

          {/* Additional Context — always editable */}
          <div style={{ width: '100%', maxWidth: 500 }}>
            <label className="form-label">Additional Context</label>
            <textarea
              className="form-textarea"
              placeholder="Add any notes for Claude (e.g., 'Sprint planning for Q2')"
              value={userContext}
              onChange={e => setUserContext(e.target.value)}
              rows={2}
              disabled={isProcessing}
            />
          </div>

          {/* Device Selectors — hidden when recording */}
          {!isRecording && (
            <>
              <div style={{ width: '100%', maxWidth: 500 }}>
                <label className="form-label">Audio Input Device</label>
                <select
                  className="form-select"
                  value={selectedDevice}
                  onChange={e => setSelectedDevice(e.target.value)}
                  disabled={isProcessing}
                >
                  {devices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                    </option>
                  ))}
                  {devices.length === 0 && <option value="default">Default Microphone</option>}
                </select>
              </div>

              {systemAudioDevices.length > 0 && (
                <div style={{ width: '100%', maxWidth: 500 }}>
                  <label className="form-label">System Audio (Optional)</label>
                  <select
                    className="form-select"
                    value={selectedSystemDevice}
                    onChange={e => setSelectedSystemDevice(e.target.value)}
                    disabled={isProcessing}
                  >
                    <option value="">None — mic only</option>
                    {systemAudioDevices.map(d => (
                      <option key={d.index} value={String(d.index)}>
                        {d.name}{d.isVirtual ? ' (virtual)' : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    Select a virtual audio device (e.g. BlackHole) to capture system audio from Zoom/Teams/Meet.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Record Button — only shown when NOT recording (controls are in the bar above) */}
          {!isRecording && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <button
                className="record-button"
                onClick={handleToggleRecording}
                disabled={isProcessing}
                title="Start Recording"
                style={{ opacity: isProcessing ? 0.4 : 1, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
              >
                <div className="record-inner" />
              </button>
            </div>
          )}

          {/* Paused indicator inline */}
          {isRecording && isPaused && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 'var(--radius)',
              color: 'var(--accent-yellow)',
              fontSize: 13,
              fontWeight: 500,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
              Recording paused
            </div>
          )}

          {/* Pipeline Status */}
          {isProcessing && (
            <div className="card" style={{ width: '100%', maxWidth: 500, textAlign: 'center' }}>
              <div style={{ marginBottom: 12 }}>
                <div className="pipeline-spinner" style={{ margin: '0 auto' }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                {stage === 'stopping' && 'Stopping...'}
                {stage === 'merging' && 'Processing Audio'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {pipelineMessage}
              </div>
            </div>
          )}

          {/* Completion summary */}
          {stage === 'complete' && completedRecordingId && (
            <div className="card" style={{ width: '100%', maxWidth: 500, textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 8px' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {pipelineMessage}
              </div>
              {recordingResult && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  Duration: {formatDuration(recordingResult.duration)} &middot; Size: {formatFileSize(recordingResult.fileSize)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleViewRecording}>
                  View Recording
                </button>
                <button className="btn btn-secondary" onClick={handleReset}>
                  New Recording
                </button>
              </div>
            </div>
          )}

          {/* Error message */}
          {stage === 'idle' && pipelineMessage && (
            <div style={{ fontSize: 13, color: 'var(--accent-primary)', textAlign: 'center' }}>
              {pipelineMessage}
            </div>
          )}

          {/* Disk Warning */}
          {diskWarning && (
            <div className={`disk-warning ${diskWarning === 'critical' ? 'critical' : ''}`} style={{ maxWidth: 500, width: '100%' }}>
              {diskWarning === 'critical'
                ? 'Disk space critically low! Recording paused.'
                : 'Low disk space warning — less than 500MB remaining'}
            </div>
          )}
        </div>
      </div>

      {/* Calendar column — sits as a sibling to the left column, fills full height */}
      {hasCalendar && (
        <div style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{
            padding: '14px 16px 10px',
            paddingTop: 'calc(var(--titlebar-height) + 14px)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Meetings</span>
            <button
              className="btn btn-ghost"
              onClick={() => loadCalendarEvents(true)}
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              Refresh
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {dayGroups.map(group => (
              <div key={group.label}>
                <div style={{
                  padding: '10px 16px 4px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {group.label}
                </div>

                {group.events.map((event) => {
                  const globalIdx = calendarEvents.indexOf(event);
                  const isNext = globalIdx === nextEventIndex;
                  const isPast = isEventPast(event);
                  const isCurrent = isEventNow(event);
                  const isSelected = selectedEvent?.id === event.id;

                  return (
                    <div
                      key={event.id}
                      ref={isNext ? nextMeetingRef : undefined}
                      onClick={() => handleSelectEvent(event)}
                      style={{
                        padding: '8px 16px',
                        cursor: 'pointer',
                        borderLeft: isNext
                          ? '3px solid var(--accent-blue)'
                          : isCurrent
                            ? '3px solid var(--accent-green)'
                            : '3px solid transparent',
                        background: isSelected
                          ? 'var(--accent-blue)'
                          : isNext
                            ? 'rgba(59, 130, 246, 0.08)'
                            : 'transparent',
                        opacity: isPast && !isCurrent ? 0.5 : 1,
                        transition: 'background 150ms ease',
                        marginBottom: 1,
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) (e.currentTarget.style.background = 'var(--bg-card)');
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) {
                          e.currentTarget.style.background = isNext
                            ? 'rgba(59, 130, 246, 0.08)'
                            : 'transparent';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: isSelected
                            ? 'rgba(255,255,255,0.8)'
                            : isCurrent
                              ? 'var(--accent-green)'
                              : 'var(--text-muted)',
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: 50,
                        }}>
                          {formatEventTime(event.startTime)}
                        </span>

                        {isCurrent && !isSelected && (
                          <span style={{
                            fontSize: 9, fontWeight: 700,
                            color: 'var(--accent-green)',
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                          }}>NOW</span>
                        )}

                        {isNext && !isCurrent && !isSelected && (
                          <span style={{
                            fontSize: 9, fontWeight: 700,
                            color: 'var(--accent-blue)',
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                          }}>NEXT</span>
                        )}
                      </div>

                      <div style={{
                        fontSize: 13,
                        fontWeight: isNext || isCurrent ? 600 : 400,
                        color: isSelected ? '#fff' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {event.title}
                      </div>

                      <div style={{
                        fontSize: 11,
                        color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                        marginTop: 1,
                      }}>
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
              <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                No meetings in the next 24 hours
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discard confirmation modal */}
      {showDiscardModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
        }}
          onClick={() => setShowDiscardModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: 28,
              width: 400,
              maxWidth: '90vw',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'rgba(231, 76, 60, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Discard Recording?</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  This will stop the recording and permanently delete all captured audio. This cannot be undone.
                </div>
              </div>
            </div>

            {duration > 0 && (
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                color: 'var(--text-secondary)',
                marginBottom: 20,
              }}>
                You will lose <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(duration)}</strong> of recorded audio
                {chunkCount > 0 && <span> ({chunkCount} chunk{chunkCount !== 1 ? 's' : ''})</span>}.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowDiscardModal(false)}
              >
                Keep Recording
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDiscardConfirm}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
