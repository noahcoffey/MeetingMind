import React, { useState, useEffect, useRef } from 'react';
import AudioMeter from '../components/AudioMeter';

interface RecordPageProps {
  onRecordingComplete?: (recordingId: string) => void;
}

type PipelineStage = 'idle' | 'recording' | 'stopping' | 'merging' | 'transcribing' | 'generating-notes' | 'complete';

export default function RecordPage({ onRecordingComplete }: RecordPageProps) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('default');
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

  const hasCalendar = calendarEvents.length > 0;

  useEffect(() => {
    loadDevices();
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
    window.meetingMind.on('transcription:progress', (data: unknown) => {
      const { status, message } = data as { status: string; message: string };
      setPipelineMessage(message);
      if (status === 'complete') {
        setStage('generating-notes');
        setPipelineMessage('Generating meeting notes with Claude...');
      }
    });
    window.meetingMind.on('notes:complete', () => {
      setStage('complete');
      setPipelineMessage('Meeting notes ready!');
    });
  }

  function cleanupListeners() {
    window.meetingMind.removeAllListeners('recording:chunk');
    window.meetingMind.removeAllListeners('recording:paused');
    window.meetingMind.removeAllListeners('recording:disk-warning');
    window.meetingMind.removeAllListeners('transcription:progress');
    window.meetingMind.removeAllListeners('notes:complete');
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

        const settings = await window.meetingMind.getSettings();
        if (settings.autoTranscribe) {
          setStage('transcribing');
          setPipelineMessage('Uploading audio to AssemblyAI for transcription...');

          const transcribeResult = await window.meetingMind.startTranscription(result.recordingId);
          if (transcribeResult.success) {
            setPipelineMessage('Generating meeting notes with Claude...');
            setStage('generating-notes');
            await window.meetingMind.generateNotes(result.recordingId);
          } else {
            setStage('complete');
            setPipelineMessage(`Recording saved. Transcription failed: ${transcribeResult.error}`);
          }
        } else {
          setStage('complete');
          setPipelineMessage('Recording saved successfully!');
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

      const result = await window.meetingMind.startRecording(selectedDevice);
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

  const isProcessing = stage === 'stopping' || stage === 'merging' || stage === 'transcribing' || stage === 'generating-notes';

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

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Main recording column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="page-header">
          <h1>Record</h1>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          padding: '20px 28px 28px',
          overflowY: 'auto',
        }}>

          {/* Title field */}
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

          {/* Additional Context */}
          <div style={{ width: '100%', maxWidth: 500 }}>
            <label className="form-label">Additional Context</label>
            <textarea
              className="form-textarea"
              placeholder="Add any notes for Claude (e.g., 'Sprint planning for Q2')"
              value={userContext}
              onChange={e => setUserContext(e.target.value)}
              rows={2}
              disabled={stage === 'recording' || isProcessing}
            />
          </div>

          {/* Device Selector */}
          {(stage === 'idle' || stage === 'recording') && (
            <div style={{ width: '100%', maxWidth: 500 }}>
              <label className="form-label">Audio Input Device</label>
              <select
                className="form-select"
                value={selectedDevice}
                onChange={e => setSelectedDevice(e.target.value)}
                disabled={stage === 'recording'}
              >
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                  </option>
                ))}
                {devices.length === 0 && <option value="default">Default Microphone</option>}
              </select>
            </div>
          )}

          {/* Record Button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 8 }}>
            <button
              className={`record-button ${stage === 'recording' ? 'recording' : ''}`}
              onClick={handleToggleRecording}
              disabled={isProcessing}
              title={stage === 'recording' ? 'Stop Recording' : 'Start Recording'}
              style={{ opacity: isProcessing ? 0.4 : 1, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
            >
              <div className="record-inner" />
            </button>

            <div className="timer" style={{ opacity: isPaused ? 0.5 : 1 }}>
              {formatDuration(duration)}
              {isPaused && <span style={{ fontSize: 14, marginLeft: 8, color: 'var(--accent-yellow)' }}>PAUSED</span>}
            </div>

            {stage === 'recording' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  onClick={handlePauseResume}
                  style={{ minWidth: 110 }}
                >
                  {isPaused ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                      Resume
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <rect x="6" y="4" width="4" height="16" />
                        <rect x="14" y="4" width="4" height="16" />
                      </svg>
                      Pause
                    </>
                  )}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowDiscardModal(true)}
                  style={{ color: 'var(--text-muted)', fontSize: 13 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Discard
                </button>
              </div>
            )}

            <AudioMeter level={audioLevel} active={stage === 'recording' && !isPaused} />
          </div>

          {/* Pipeline Status */}
          {isProcessing && (
            <div className="card" style={{ width: '100%', maxWidth: 500, textAlign: 'center' }}>
              <div style={{ marginBottom: 12 }}>
                <div className="pipeline-spinner" style={{ margin: '0 auto' }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                {stage === 'stopping' && 'Stopping...'}
                {stage === 'merging' && 'Processing Audio'}
                {stage === 'transcribing' && 'Transcribing'}
                {stage === 'generating-notes' && 'Generating Notes'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {pipelineMessage}
              </div>
              {(stage === 'transcribing' || stage === 'generating-notes') && (
                <div style={{ marginTop: 12, height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
                  <div className="progress-bar-indeterminate" />
                </div>
              )}
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

          {/* Status Bar */}
          {stage === 'recording' && (
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Chunks: {chunkCount}</span>
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
