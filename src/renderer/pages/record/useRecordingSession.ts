import { useState, useEffect, useRef } from 'react';
import { resolvePreferredMic } from './preferred-mic';
import { timerRefsFromStatus } from '../../resume-recording';
import { useAudioLevelMonitor } from './useAudioLevelMonitor';

export type PipelineStage = 'idle' | 'recording' | 'stopping' | 'merging' | 'complete';

interface RecordingSessionOptions {
  onRecordingComplete?: (recordingId: string) => void;
  onRecordingSaved?: (recordingId: string) => void;
  activeNotebook?: string;
  onRecordingStateChange?: (state: { recording: boolean; paused: boolean }) => void;
}

/**
 * The Record page's recording lifecycle: what is staged for the next recording
 * (meeting, title, context, devices), the running recording's timer, pause
 * state and meter, the IPC listeners that keep it in step with main, and taking
 * back up a recording main already has running.
 */
export function useRecordingSession({ onRecordingComplete, onRecordingSaved, activeNotebook, onRecordingStateChange }: RecordingSessionOptions) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [duration, setDuration] = useState(0);
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
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState('');
  const [completedRecordingId, setCompletedRecordingId] = useState<string | null>(null);
  const [recordingResult, setRecordingResult] = useState<{ duration: number; fileSize: number } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);
  const externalStopUnsubRef = useRef<null | (() => void)>(null);
  const importingRef = useRef(false);

  const isRecording = stage === 'recording';
  const isProcessing = stage === 'stopping' || stage === 'merging';
  const stageRef = useRef<PipelineStage>(stage);
  stageRef.current = stage;
  // The staged meeting of a recording picked back up from main, waiting for
  // the calendar to load so the full event can take its place.
  const resumedEventIdRef = useRef<string | null>(null);

  const {
    waveformCanvasRef,
    waveformContainerRef,
    startAudioLevelMonitor,
    stopAudioLevelMonitor,
  } = useAudioLevelMonitor(isRecording, selectedDevice, devices);

  useEffect(() => {
    loadDevices();
    loadSystemAudioDevices();
    loadCalendarEvents();
    setupListeners();
    resumeActiveRecording();

    // Plugging in (or unplugging) a mic: refresh both lists so the saved mic is
    // picked up as soon as it appears, or dropped back to the default when it goes.
    const onDeviceChange = () => {
      loadDevices();
      loadSystemAudioDevices();
    };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
      cleanupListeners();
      if (timerRef.current) clearInterval(timerRef.current);
      stopAudioLevelMonitor();
    };
  }, []);

  useEffect(() => {
    onRecordingStateChange?.({ recording: stage === 'recording', paused: stage === 'recording' && isPaused });
  }, [stage, isPaused]);

  useEffect(() => {
    const id = resumedEventIdRef.current;
    if (!id) return;
    if (stageRef.current !== 'recording') {
      resumedEventIdRef.current = null;
      return;
    }
    const event = calendarEvents.find(e => e.id === id);
    if (!event) return;
    resumedEventIdRef.current = null;
    setSelectedEvent(event);
  }, [calendarEvents]);

  // Main owns the recording; this page only drives it. If one is already
  // running when the page mounts (the renderer reloaded, or the page was
  // remounted), take it back up rather than showing Ready to Record over it.
  async function resumeActiveRecording() {
    let status: Awaited<ReturnType<typeof window.meetingMind.getRecordingStatus>> | null = null;
    try {
      status = await window.meetingMind.getRecordingStatus();
    } catch {}
    if (!status?.recording) return;
    // The page started (or finished) a recording of its own in the meantime.
    if (stageRef.current !== 'idle') return;

    const refs = timerRefsFromStatus(status.duration, status.isPaused, Date.now());
    startTimeRef.current = refs.startTime;
    pausedDurationRef.current = refs.pausedDuration;
    pauseStartRef.current = refs.pauseStart;

    setStage('recording');
    setDuration(status.duration);
    setChunkCount(status.chunkCount);
    setIsPaused(status.isPaused);
    setCompletedRecordingId(null);
    setRecordingResult(null);
    setPipelineMessage('');
    setMeetingTitle(status.title || '');
    setUserContext(status.userContext || '');
    if (status.inputDevice) setSelectedDevice(status.inputDevice);
    if (status.systemAudioDevice) setSelectedSystemDevice(status.systemAudioDevice);
    if (status.calendarEventId) {
      resumedEventIdRef.current = status.calendarEventId;
      setSelectedEvent({ id: status.calendarEventId, provider: status.calendarEventProvider, title: status.title });
    }

    if (!status.isPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
        setDuration(Math.floor(elapsed / 1000));
      }, 1000);
      startAudioLevelMonitor();
    }
  }

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
      // Start on the saved mic when it's connected. Never switch a running
      // recording's mic (or one picked back up from main).
      if (stageRef.current === 'idle') {
        const settings = await window.meetingMind.getSettings();
        if (stageRef.current === 'idle') {
          setSelectedDevice(resolvePreferredMic(settings.defaultInputDevice as string | undefined, devs));
        }
      }
    } catch {}
  }

  /** Picking a mic on the Record page also makes it the default for next time. */
  function chooseMic(name: string) {
    setSelectedDevice(name);
    window.meetingMind.setSetting('defaultInputDevice', name).catch(() => {});
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
      applyPausedState(paused as boolean);
    });
    // Stopped from the tray, the hotkey or the Stream Deck key: the page never
    // ran its own stop, so bring it to the same finished state. App.tsx picks
    // up the recording itself and runs the pipeline.
    // Unsubscribed individually, not with removeAllListeners: App.tsx listens on
    // this channel too, and tearing the channel down would take its pipeline
    // handoff with it every time this page unmounts.
    externalStopUnsubRef.current = window.meetingMind.on('recording:stopped-externally', (payload: unknown) => {
      const result = (payload || {}) as { success?: boolean; recordingId?: string; error?: string };
      stopAudioLevelMonitor();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPaused(false);
      pauseStartRef.current = 0;
      setSelectedEvent(null);
      setMeetingTitle('');
      setUserContext('');
      if (result.success && result.recordingId) {
        setCompletedRecordingId(result.recordingId);
        window.meetingMind.getRecording(result.recordingId).then(rec => {
          if (rec) setRecordingResult({ duration: rec.duration, fileSize: rec.fileSize });
        });
        setStage('complete');
        setPipelineMessage('Recording saved!');
      } else {
        setStage('idle');
        setPipelineMessage(result.error ? `Recording failed: ${result.error}` : '');
      }
    });
    window.meetingMind.on('recording:disk-warning', (warning: unknown) => {
      setDiskWarning(warning as string);
    });
    window.meetingMind.on('recording:audio-warning', (warning: unknown) => {
      setAudioWarning(warning as string);
    });
    window.meetingMind.on('recording:error', (payload: unknown) => {
      const { message, recordingId } = (payload || {}) as { message?: string; recordingId?: string };
      stopAudioLevelMonitor();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPaused(false);
      if (recordingId) {
        // Partial audio was salvaged and saved as a recording
        setCompletedRecordingId(recordingId);
        window.meetingMind.getRecording(recordingId).then(rec => {
          if (rec) setRecordingResult({ duration: rec.duration, fileSize: rec.fileSize });
        });
        setStage('complete');
      } else {
        setStage('idle');
        setDuration(0);
        setChunkCount(0);
      }
      setPipelineMessage(message || 'Recording stopped due to an audio capture error.');
    });
  }

  function cleanupListeners() {
    window.meetingMind.removeAllListeners('recording:chunk');
    window.meetingMind.removeAllListeners('recording:paused');
    window.meetingMind.removeAllListeners('recording:disk-warning');
    window.meetingMind.removeAllListeners('recording:audio-warning');
    window.meetingMind.removeAllListeners('recording:error');
    externalStopUnsubRef.current?.();
    externalStopUnsubRef.current = null;
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

  // Pause/resume can now come from the tray, the global hotkey or the Stream
  // Deck key as well as this page's own button, so the page reacts to the
  // recorder's own `recording:paused` event rather than to the click. Written
  // to be idempotent: the click path gets the same event and must not
  // double-count the paused time.
  function applyPausedState(paused: boolean) {
    setIsPaused(paused);
    if (paused) {
      if (pauseStartRef.current) return;
      pauseStartRef.current = Date.now();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopAudioLevelMonitor();
    } else {
      if (pauseStartRef.current) {
        pausedDurationRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = 0;
      }
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
          setDuration(Math.floor(elapsed / 1000));
        }, 1000);
      }
      startAudioLevelMonitor();
    }
  }

  async function handlePauseResume() {
    if (isPaused) await window.meetingMind.resumeRecording();
    else await window.meetingMind.pauseRecording();
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
        await finishSavedRecording(result.recordingId, 'Recording saved!');
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
      setAudioWarning(null);
      pausedDurationRef.current = 0;
      pauseStartRef.current = 0;

      const result = await window.meetingMind.startRecording(
        selectedDevice,
        selectedSystemDevice || undefined,
        selectedEvent?.id,
        userContext || undefined,
        meetingTitle || undefined,
        activeNotebook || undefined,
        selectedEvent?.provider,
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

  // A recording has landed on disk, recorded here or imported: show it on the
  // finished card and hand it to the transcription pipeline.
  async function finishSavedRecording(recordingId: string, message: string) {
    setCompletedRecordingId(recordingId);

    const rec = await window.meetingMind.getRecording(recordingId);
    if (rec) {
      setRecordingResult({ duration: rec.duration, fileSize: rec.fileSize });
    }

    setStage('complete');
    setPipelineMessage(message);

    // Clear the staged meeting context so the NEXT recording starts clean.
    // Otherwise a selected calendar event (and its iCal UID) silently carries
    // over to an unrelated follow-up recording — which mis-attributes it to
    // the wrong meeting when synced to MeetingHub.
    setSelectedEvent(null);
    setMeetingTitle('');
    setUserContext('');

    if (onRecordingSaved) {
      onRecordingSaved(recordingId);
    }
  }

  // Bring in audio recorded elsewhere (a voice memo, a Zoom recording) instead
  // of recording here. It takes the staged meeting, title and context just as
  // a live recording would.
  async function handleImport() {
    // A ref, not `stage`: a double-click lands before the re-render, and would
    // otherwise open a second file picker.
    if (stage !== 'idle' || importingRef.current) return;
    importingRef.current = true;
    try {
      await importFromPicker();
    } finally {
      importingRef.current = false;
    }
  }

  async function importFromPicker() {
    const filePath = await window.meetingMind.selectAudioFile();
    if (!filePath) return;

    setStage('merging');
    setCompletedRecordingId(null);
    setRecordingResult(null);
    setPipelineMessage('Importing audio and applying noise filter...');

    const result = await window.meetingMind.importRecording(filePath, {
      title: meetingTitle || undefined,
      calendarEventId: selectedEvent?.id,
      calendarEventProvider: selectedEvent?.provider,
      userContext: userContext || undefined,
      notebook: activeNotebook || undefined,
    });

    if (result.success && result.recordingId) {
      await finishSavedRecording(result.recordingId, 'Recording imported!');
    } else {
      setStage('idle');
      setPipelineMessage(`Import failed: ${result.error}`);
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
    setSelectedEvent(null);
    setMeetingTitle('');
    setUserContext('');
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
    setAudioWarning(null);
    pausedDurationRef.current = 0;
    pauseStartRef.current = 0;
  }

  return {
    stage,
    stageRef,
    isRecording,
    isProcessing,
    duration,
    chunkCount,
    isPaused,
    diskWarning,
    audioWarning,
    pipelineMessage,
    completedRecordingId,
    recordingResult,
    showDiscardModal,
    setShowDiscardModal,

    devices,
    selectedDevice,
    setSelectedDevice: chooseMic,
    systemAudioDevices,
    selectedSystemDevice,
    setSelectedSystemDevice,
    calendarEvents,
    selectedEvent,
    setSelectedEvent,
    meetingTitle,
    setMeetingTitle,
    userContext,
    setUserContext,

    waveformCanvasRef,
    waveformContainerRef,

    loadSystemAudioDevices,
    loadCalendarEvents,
    handleSelectEvent,
    handlePauseResume,
    handleToggleRecording,
    handleImport,
    handleViewRecording,
    handleReset,
    handleDiscardConfirm,
  };
}
