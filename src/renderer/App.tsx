import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import RecordPage from './pages/RecordPage';
import MeetingsPage from './pages/MeetingsPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import HighlightsPage from './pages/HighlightsPage';
import OnboardingFlow from './pages/OnboardingFlow';
import type { BackgroundJob } from './components/PipelineWidget';
import type { Project } from './types';

type Page = 'record' | 'meetings' | 'settings' | 'analytics' | 'highlights';

const JOB_AUTO_DISMISS_MS = 60_000;

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('record');
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [viewRecordingId, setViewRecordingId] = useState<string | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);
  const [notebooks, setNotebooks] = useState<string[]>(['Personal']);
  const [activeNotebook, setActiveNotebook] = useState<string>('Personal');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectFilter, setActiveProjectFilter] = useState<string | null>(null);
  // Bumped by the control server; RecordPage watches it and stages the meeting
  // happening now. A counter rather than a flag so two requests in a row both land.
  const [selectNextSignal, setSelectNextSignal] = useState(0);
  // Same idea for "start recording now"; RecordPage only acts on a change it
  // sees while mounted, so a stale signal can't start a recording on its own.
  const [startRecordingSignal, setStartRecordingSignal] = useState(0);
  const jobCleanupRef = useRef<Map<string, () => void>>(new Map());
  const jobExpiryRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    loadSettings();
    return () => {
      // Clean up all job listeners on unmount
      jobCleanupRef.current.forEach(cleanup => cleanup());
      jobCleanupRef.current.clear();
      jobExpiryRef.current.forEach(timer => clearTimeout(timer));
      jobExpiryRef.current.clear();
    };
  }, []);

  // Auto-dismiss finished jobs after a minute. Errors stay until dismissed by hand
  // so a failed transcription can't scroll away unnoticed.
  useEffect(() => {
    for (const job of backgroundJobs) {
      if (job.stage !== 'complete' || jobExpiryRef.current.has(job.recordingId)) continue;
      const timer = setTimeout(() => {
        jobExpiryRef.current.delete(job.recordingId);
        handleDismissJob(job.recordingId);
      }, JOB_AUTO_DISMISS_MS);
      jobExpiryRef.current.set(job.recordingId, timer);
    }
    // Drop timers for jobs that are already gone
    for (const [recordingId, timer] of jobExpiryRef.current) {
      if (!backgroundJobs.some(j => j.recordingId === recordingId)) {
        clearTimeout(timer);
        jobExpiryRef.current.delete(recordingId);
      }
    }
  }, [backgroundJobs]);

  async function loadSettings() {
    try {
      const s = await window.meetingMind.getSettings();
      setSettings(s);
      applyTheme(s.theme as string || 'dark');
      setNotebooks((s.notebooks as string[]) || ['Personal']);
      setActiveNotebook((s.activeNotebook as string) || (s.notebooks as string[])?.[0] || 'Personal');
      setProjects((s.projects as Project[]) || []);
      setActiveProjectFilter((s.activeProjectFilter as string | null) ?? null);
      if (!s.onboardingComplete) {
        setShowOnboarding(true);
      }
    } catch {
      setSettings({});
    }
  }

  function applyTheme(theme: string) {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    loadSettings();
  }

  function handleRecordingComplete(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('meetings');
  }

  // Called by RecordPage after a recording is saved — kicks off background pipeline
  const handleRecordingSaved = useCallback(async (recordingId: string) => {
    // Fetch recording info for the title
    let title = 'Untitled Meeting';
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

  // A stop that came from outside the Record page — the tray, the global
  // hotkey, or the Stream Deck key — still has to hand the finished recording
  // to the pipeline, and the page has to be told it is no longer recording.
  useEffect(() => {
    const unsub = window.meetingMind.on('recording:stopped-externally', (payload: unknown) => {
      const result = payload as { success: boolean; recordingId?: string };
      if (result?.success && result.recordingId) handleRecordingSaved(result.recordingId);
    });
    return unsub;
  }, [handleRecordingSaved]);

  // The control server asking for the Record page, optionally with the meeting
  // that is happening now (or about to) already staged.
  useEffect(() => {
    const unsub = window.meetingMind.on('control:navigate-record', (payload: unknown) => {
      const { selectNext } = (payload || {}) as { selectNext?: boolean };
      setViewRecordingId(null);
      setCurrentPage('record');
      if (selectNext) setSelectNextSignal(n => n + 1);
    });
    return unsub;
  }, []);

  // The control server asking to start recording — the Stream Deck key held
  // down while nothing is recording. The page does the actual starting, since
  // the staged meeting, title, notebook and devices all live there.
  useEffect(() => {
    const unsub = window.meetingMind.on('control:start-recording', () => {
      setCurrentPage('record');
      // A tick later, so a page that had to mount first is listening by the
      // time the signal changes.
      setTimeout(() => setStartRecordingSignal(n => n + 1), 80);
    });
    return unsub;
  }, []);

  function handleDismissJob(recordingId: string) {
    setBackgroundJobs(prev => prev.filter(j => j.recordingId !== recordingId));
    const expiry = jobExpiryRef.current.get(recordingId);
    if (expiry) {
      clearTimeout(expiry);
      jobExpiryRef.current.delete(recordingId);
    }
    const cleanup = jobCleanupRef.current.get(recordingId);
    if (cleanup) {
      cleanup();
      jobCleanupRef.current.delete(recordingId);
    }
  }

  function handleViewJobRecording(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('meetings');
    // Dismiss the job notification
    handleDismissJob(recordingId);
  }

  function handleNotebookChange(notebook: string) {
    setActiveNotebook(notebook);
    window.meetingMind.setSetting('activeNotebook', notebook);
  }

  async function handleNotebooksUpdate(updated: string[]) {
    setNotebooks(updated);
    await window.meetingMind.setSetting('notebooks', updated);
    // If active notebook was deleted, switch to first
    if (!updated.includes(activeNotebook)) {
      const fallback = updated[0] || 'Personal';
      setActiveNotebook(fallback);
      await window.meetingMind.setSetting('activeNotebook', fallback);
    }
  }

  function handleProjectSelect(projectId: string | null) {
    setActiveProjectFilter(projectId);
    window.meetingMind.setSetting('activeProjectFilter', projectId);
    setCurrentPage('meetings');
  }

  async function handleProjectCreate(name: string) {
    const project = await (window.meetingMind as any).createProject(name, activeNotebook);
    setProjects(prev => [...prev, project]);
  }

  async function handleProjectRename(id: string, name: string) {
    await (window.meetingMind as any).renameProject(id, name);
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  }

  async function handleProjectDelete(id: string) {
    await (window.meetingMind as any).deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectFilter === id) handleProjectSelect(null);
  }

  async function handleRecordingDroppedOnProject(recordingId: string, projectId: string) {
    await (window.meetingMind as any).moveToProject(recordingId, projectId);
  }

  function handleNotebookChangeWithProjects(notebook: string) {
    handleNotebookChange(notebook);
    // Clear project filter if it doesn't belong to the new notebook
    if (activeProjectFilter) {
      const project = projects.find(p => p.id === activeProjectFilter);
      if (project && project.notebook !== notebook) {
        setActiveProjectFilter(null);
        window.meetingMind.setSetting('activeProjectFilter', null);
      }
    }
  }

  function handleNavigate(page: Page) {
    if (page !== 'meetings') {
      setViewRecordingId(null);
    }
    setCurrentPage(page);
  }

  function handleSearchSelect(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('meetings');
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
        notebooks={notebooks}
        activeNotebook={activeNotebook}
        onNotebookChange={handleNotebookChangeWithProjects}
        onNotebooksUpdate={handleNotebooksUpdate}
        projects={projects}
        activeProjectFilter={activeProjectFilter}
        onProjectSelect={handleProjectSelect}
        onProjectCreate={handleProjectCreate}
        onProjectRename={handleProjectRename}
        onProjectDelete={handleProjectDelete}
        onRecordingDroppedOnProject={handleRecordingDroppedOnProject}
      />
      <div className="main-content">
        {currentPage === 'record' && (
          <RecordPage
            onRecordingComplete={handleRecordingComplete}
            onRecordingSaved={handleRecordingSaved}
            activeNotebook={activeNotebook}
            selectNextSignal={selectNextSignal}
            startRecordingSignal={startRecordingSignal}
          />
        )}
        {currentPage === 'meetings' && <MeetingsPage initialMeetingId={viewRecordingId} activeNotebook={activeNotebook} notebooks={notebooks} activeProjectFilter={activeProjectFilter} projects={projects} />}
        {currentPage === 'settings' && <SettingsPage onSettingsChange={loadSettings} />}
        {currentPage === 'highlights' && <HighlightsPage />}
        {currentPage === 'analytics' && <AnalyticsPage />}
      </div>
    </div>
  );
}
