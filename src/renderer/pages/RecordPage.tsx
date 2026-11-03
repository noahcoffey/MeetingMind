import React, { useState, useEffect, useRef } from 'react';
import { pickCurrentMeeting } from '../pick-meeting';
import { useRecordingSession } from './record/useRecordingSession';
import { useAudioTest } from './record/useAudioTest';
import LiveRecordingBar from './record/LiveRecordingBar';
import RecordHero from './record/RecordHero';
import MeetingFields from './record/MeetingFields';
import DevicePickers from './record/DevicePickers';
import AudioTestPanel from './record/AudioTestPanel';
import SystemAudioSetupGuide from './record/SystemAudioSetupGuide';
import RecordingWarnings from './record/RecordingWarnings';
import { ProcessingCard, CompleteCard } from './record/StatusCards';
import CalendarSidebar from './record/CalendarSidebar';
import DiscardModal from './record/DiscardModal';

interface RecordPageProps {
  onRecordingComplete?: (recordingId: string) => void;
  onRecordingSaved?: (recordingId: string) => void;
  activeNotebook?: string;
  /** Bumped when something outside the page asks for the meeting at hand to be
   *  staged (the control server, driven by the Stream Deck key). */
  selectNextSignal?: number;
  /** Bumped when something outside the page presses Record for you. */
  startRecordingSignal?: number;
  /** Whether the page is the one on screen. It stays mounted while you look at
   *  other pages so a recording in progress keeps its timer, meter and controls. */
  active?: boolean;
  /** Told whenever a recording starts, stops, pauses or resumes, so the rest of
   *  the app can show that one is running. */
  onRecordingStateChange?: (state: { recording: boolean; paused: boolean }) => void;
}

export default function RecordPage({ onRecordingComplete, onRecordingSaved, activeNotebook, selectNextSignal, startRecordingSignal, active = true, onRecordingStateChange }: RecordPageProps) {
  const {
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
    setSelectedDevice,
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
  } = useRecordingSession({ onRecordingComplete, onRecordingSaved, activeNotebook, onRecordingStateChange });

  const nextMeetingRef = useRef<HTMLDivElement | null>(null);
  const hasCalendar = calendarEvents.length > 0;

  // Coming back to the page: refresh what may have gone stale while it was out
  // of sight. A "Recording saved!" card is for the moment the recording ends —
  // coming back to it later means starting over, as it always has.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (active === wasActiveRef.current) return;
    wasActiveRef.current = active;
    if (!active) return;
    loadCalendarEvents();
    loadSystemAudioDevices();
    if (stageRef.current === 'complete') handleReset();
  }, [active]);

  useEffect(() => {
    if (nextMeetingRef.current) {
      nextMeetingRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [calendarEvents]);

  // Stage the meeting at hand when asked from outside. The request usually
  // arrives before the calendar has loaded (the app was just launched), so it
  // is held until there are events to choose from.
  const pendingSelectRef = useRef(false);
  useEffect(() => {
    if (selectNextSignal) pendingSelectRef.current = true;
    if (!pendingSelectRef.current) return;
    // Mid-recording the staged meeting is already committed; leave it alone.
    if (stage !== 'idle' && stage !== 'complete') return;
    // Sitting on the "Recording saved!" card, the page is showing the last
    // meeting, not this one — being asked for Record again means the same thing
    // as pressing New Meeting. Done before the calendar check, since an empty
    // calendar is no reason to leave the old recording's card up.
    if (stage === 'complete') handleReset();
    if (!calendarEvents.length) return;
    pendingSelectRef.current = false;
    const meeting = pickCurrentMeeting(calendarEvents);
    if (!meeting) return;
    setSelectedEvent(meeting);
    setMeetingTitle(meeting.title);
  }, [selectNextSignal, calendarEvents, stage]);

  // Something outside the page pressed Record — the Stream Deck key, held down
  // with nothing recording. Only a change seen while mounted counts, so a
  // signal from before this page existed can't start a recording behind you.
  const lastStartSignalRef = useRef(startRecordingSignal);
  useEffect(() => {
    if (startRecordingSignal === lastStartSignalRef.current) return;
    lastStartSignalRef.current = startRecordingSignal;
    if (stage !== 'idle' && stage !== 'complete') return;
    handleToggleRecording();
  }, [startRecordingSignal]);

  const audioTest = useAudioTest(selectedDevice, devices, selectedSystemDevice);

  const hasVirtualDevice = systemAudioDevices.some((d: any) => d.isVirtual);
  const [showAudioSetup, setShowAudioSetup] = useState(false);
  const [dismissedAudioSetup, setDismissedAudioSetup] = useState(false);

  async function handleRefreshAudioDevices() {
    await loadSystemAudioDevices();
    if (systemAudioDevices.some((d: any) => d.isVirtual)) {
      setShowAudioSetup(false);
    }
  }

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
          <LiveRecordingBar
            isPaused={isPaused}
            duration={duration}
            waveformContainerRef={waveformContainerRef}
            waveformCanvasRef={waveformCanvasRef}
            onPauseResume={handlePauseResume}
            onStop={handleToggleRecording}
            onDiscard={() => setShowDiscardModal(true)}
          />
        )}

        {/* ─── Body ─── */}
        <div className="rp-body">
          {/* ─── Idle: centered studio layout ─── */}
          {(stage === 'idle' || stage === 'complete') && !isProcessing && stage !== 'complete' && (
            <div className="rp-idle-stage">
              {/* Record button hero */}
              <RecordHero
                isProcessing={isProcessing}
                onRecord={handleToggleRecording}
                onImport={handleImport}
              />

              {/* Title + Context */}
              <MeetingFields
                meetingTitle={meetingTitle}
                onMeetingTitleChange={setMeetingTitle}
                userContext={userContext}
                onUserContextChange={setUserContext}
              />

              {/* Device pickers */}
              <DevicePickers
                systemAudioDevices={systemAudioDevices}
                selectedDevice={selectedDevice}
                onSelectedDeviceChange={setSelectedDevice}
                selectedSystemDevice={selectedSystemDevice}
                onSelectedSystemDeviceChange={setSelectedSystemDevice}
              />

              {/* Audio test button + results */}
              <AudioTestPanel
                audioTestRunning={audioTest.audioTestRunning}
                isRecording={isRecording}
                micTestLevel={audioTest.micTestLevel}
                micTestResult={audioTest.micTestResult}
                sysTestResult={audioTest.sysTestResult}
                onTestAudio={audioTest.handleTestAudio}
              />

              {/* System audio setup guide */}
              {!hasVirtualDevice && !dismissedAudioSetup && (
                <SystemAudioSetupGuide
                  showAudioSetup={showAudioSetup}
                  onShowAudioSetup={() => setShowAudioSetup(true)}
                  onDismiss={() => setDismissedAudioSetup(true)}
                  onRefreshDevices={handleRefreshAudioDevices}
                />
              )}

              {/* Error */}
              {pipelineMessage && (
                <div className="rp-error">{pipelineMessage}</div>
              )}

              {/* Disk + audio warnings */}
              <RecordingWarnings diskWarning={diskWarning} audioWarning={audioWarning} />
            </div>
          )}

          {/* ─── Recording: editable fields below waveform ─── */}
          {isRecording && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 20 }}>
              <MeetingFields
                meetingTitle={meetingTitle}
                onMeetingTitleChange={setMeetingTitle}
                userContext={userContext}
                onUserContextChange={setUserContext}
              />

              <RecordingWarnings diskWarning={diskWarning} audioWarning={audioWarning} />
            </div>
          )}

          {/* ─── Processing ─── */}
          {isProcessing && (
            <ProcessingCard stage={stage} pipelineMessage={pipelineMessage} />
          )}

          {/* ─── Complete ─── */}
          {stage === 'complete' && completedRecordingId && (
            <CompleteCard
              pipelineMessage={pipelineMessage}
              recordingResult={recordingResult}
              onViewRecording={handleViewRecording}
              onReset={handleReset}
            />
          )}
        </div>
      </div>

      {/* ─── Calendar sidebar ─── */}
      {hasCalendar && (
        <CalendarSidebar
          calendarEvents={calendarEvents}
          selectedEvent={selectedEvent}
          nextMeetingRef={nextMeetingRef}
          onSelectEvent={handleSelectEvent}
          onRefresh={() => loadCalendarEvents(true)}
        />
      )}

      {/* ─── Discard modal ─── */}
      {showDiscardModal && (
        <DiscardModal
          duration={duration}
          chunkCount={chunkCount}
          onCancel={() => setShowDiscardModal(false)}
          onConfirm={handleDiscardConfirm}
        />
      )}
    </div>
  );
}
