import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import RecordPage from './pages/RecordPage';
import RecordingsPage from './pages/RecordingsPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import HighlightsPage from './pages/HighlightsPage';
import OnboardingFlow from './pages/OnboardingFlow';
import type { BackgroundJob } from './components/PipelineWidget';

type Page = 'record' | 'recordings' | 'settings' | 'analytics' | 'highlights';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('record');
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [viewRecordingId, setViewRecordingId] = useState<string | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);
  const jobCleanupRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    loadSettings();
    return () => {
      // Clean up all job listeners on unmount
      jobCleanupRef.current.forEach(cleanup => cleanup());
      jobCleanupRef.current.clear();
    };
  }, []);

  async function loadSettings() {
    try {
      const s = await window.meetingMind.getSettings();
      setSettings(s);
      if (!s.onboardingComplete) {
        setShowOnboarding(true);
      }
    } catch {
      setSettings({});
    }
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    loadSettings();
  }

  function handleRecordingComplete(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('recordings');
  }

  // Called by RecordPage after a recording is saved — kicks off background pipeline
  const handleRecordingSaved = useCallback(async (recordingId: string) => {
    // Fetch recording info for the title
    let title = 'Untitled Recording';
    try {
      const rec = await window.meetingMind.getRecording(recordingId);
      if (rec?.title) title = rec.title;
      else if (rec?.calendarEvent?.title) title = rec.calendarEvent.title;
    } catch {}

    // Check if auto-transcribe is enabled
    const s = await window.meetingMind.getSettings();
    if (!s.autoTranscribe) return;

    // Add job to the list
    const newJob: BackgroundJob = {
      recordingId,
      title,
      stage: 'transcribing',
      message: 'Starting transcription...',
    };
    setBackgroundJobs(prev => [...prev, newJob]);

    // Set up IPC listeners scoped to this job
    const unsubProgress = window.meetingMind.on('transcription:progress', (data: unknown) => {
      const { status, message } = data as { status: string; message: string };
      setBackgroundJobs(prev => prev.map(j =>
        j.recordingId === recordingId
          ? { ...j, message, stage: status === 'error' ? 'error' : j.stage }
          : j
      ));
    });

    const unsubNotesComplete = window.meetingMind.on('notes:complete', () => {
      setBackgroundJobs(prev => prev.map(j =>
        j.recordingId === recordingId
          ? { ...j, stage: 'complete', message: 'Notes ready' }
          : j
      ));
      // Clean up listeners for this job
      const cleanup = jobCleanupRef.current.get(recordingId);
      if (cleanup) {
        cleanup();
        jobCleanupRef.current.delete(recordingId);
      }
    });

    // Store cleanup function
    jobCleanupRef.current.set(recordingId, () => {
      unsubProgress();
      unsubNotesComplete();
    });

    // Fire-and-forget the pipeline
    (async () => {
      try {
        const transcribeResult = await window.meetingMind.startTranscription(recordingId);
        if (transcribeResult.success) {
          setBackgroundJobs(prev => prev.map(j =>
            j.recordingId === recordingId
              ? { ...j, stage: 'generating-notes', message: 'Generating meeting notes...' }
              : j
          ));
          const notesResult = await window.meetingMind.generateNotes(recordingId);
          if (!notesResult.success) {
            setBackgroundJobs(prev => prev.map(j =>
              j.recordingId === recordingId
                ? { ...j, stage: 'error', message: notesResult.error || 'Notes generation failed' }
                : j
            ));
          }
        } else {
          setBackgroundJobs(prev => prev.map(j =>
            j.recordingId === recordingId
              ? { ...j, stage: 'error', message: transcribeResult.error || 'Transcription failed' }
              : j
          ));
        }
      } catch (err: any) {
        setBackgroundJobs(prev => prev.map(j =>
          j.recordingId === recordingId
            ? { ...j, stage: 'error', message: err.message || 'Pipeline failed' }
            : j
        ));
      }
    })();
  }, []);

  function handleDismissJob(recordingId: string) {
    setBackgroundJobs(prev => prev.filter(j => j.recordingId !== recordingId));
    const cleanup = jobCleanupRef.current.get(recordingId);
    if (cleanup) {
      cleanup();
      jobCleanupRef.current.delete(recordingId);
    }
  }

  function handleViewJobRecording(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('recordings');
    // Dismiss the job notification
    handleDismissJob(recordingId);
  }

  function handleNavigate(page: Page) {
    if (page !== 'recordings') {
      setViewRecordingId(null);
    }
    setCurrentPage(page);
  }

  function handleSearchSelect(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('recordings');
  }

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="app-layout">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        backgroundJobs={backgroundJobs}
        onViewJobRecording={handleViewJobRecording}
        onDismissJob={handleDismissJob}
      />
      <div className="main-content">
        {currentPage === 'record' && (
          <RecordPage
            onRecordingComplete={handleRecordingComplete}
            onRecordingSaved={handleRecordingSaved}
          />
        )}
        {currentPage === 'recordings' && <RecordingsPage initialRecordingId={viewRecordingId} />}
        {currentPage === 'settings' && <SettingsPage onSettingsChange={loadSettings} />}
        {currentPage === 'highlights' && <HighlightsPage />}
        {currentPage === 'analytics' && <AnalyticsPage />}
      </div>
    </div>
  );
}
