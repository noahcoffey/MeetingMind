import { useState, useEffect, useRef } from 'react';
import type { Recording, Project, RecordingIndexEntry } from '../types';
import AudioPlayer from '../components/AudioPlayer';
import SpeakerPanel from '../components/SpeakerPanel';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import ProgressBar from '../components/ProgressBar';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  DayKey,
  dayBoundsMs,
  dayKeyLocal,
  monthOfDay,
  recentWindowMs,
} from '../meeting-dates';
import type { DetailTab, DateView, QAEntry } from './meetings/types';
import ErrorCard from './meetings/ErrorCard';
import MeetingList from './meetings/MeetingList';
import ProjectSummaryHeader from './meetings/ProjectSummaryHeader';
import MeetingDetailHeader from './meetings/MeetingDetailHeader';
import DetailTabBar from './meetings/DetailTabBar';
import NotesTab from './meetings/NotesTab';
import TranscriptTab from './meetings/TranscriptTab';
import AskTab from './meetings/AskTab';

interface MeetingsPageProps {
  initialMeetingId?: string | null;
  activeNotebook?: string;
  notebooks?: string[];
  activeProjectFilter?: string | null;
  projects?: Project[];
}

export default function MeetingsPage({ initialMeetingId, activeNotebook, notebooks, activeProjectFilter, projects = [] }: MeetingsPageProps) {
  const [meetings, setMeetings] = useState<Recording[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Recording | null>(null);
  const [notesContent, setNotesContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<number | undefined>(undefined);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('notes');
  const [utterances, setUtterances] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<'regenerate' | 'retranscribe' | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showCostData, setShowCostData] = useState(false);
  const [meetinghubVisible, setMeetinghubVisible] = useState(false);
  const [clubtoolsVisible, setClubtoolsVisible] = useState(false);
  const [userName, setUserName] = useState('');
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaIsAsking, setQaIsAsking] = useState(false);
  const [qaStreamingAnswer, setQaStreamingAnswer] = useState('');
  const [qaStreamingId, setQaStreamingId] = useState<string | null>(null);
  const [qaActiveQuestion, setQaActiveQuestion] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [projectSummary, setProjectSummary] = useState<string | null>(null);
  const [projectSummaryStreaming, setProjectSummaryStreaming] = useState('');
  const [isGeneratingProjectSummary, setIsGeneratingProjectSummary] = useState(false);
  const [showProjectSummary, setShowProjectSummary] = useState(false);
  const qaScrollRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const selectedMeetingRef = useRef<Recording | null>(null);
  const [dateView, setDateView] = useState<DateView>({ mode: 'recent' });
  // The pipeline event handlers below are registered once with [] deps, so they
  // close over the first render. They read the view through this ref, or every
  // 'notes:complete' would quietly reload the recent window and yank the user
  // out of whatever day they were browsing.
  const dateViewRef = useRef<DateView>({ mode: 'recent' });
  const [recIndex, setRecIndex] = useState<RecordingIndexEntry[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Only the calendar reads the index, and building it costs a full pass over
  // every manifest - so don't pay for it on each pipeline event when the panel
  // is closed. Ref, not state, for the same stale-closure reason as dateViewRef.
  const calendarOpenRef = useRef(false);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const [audioState, audioControls] = useAudioPlayer();

  useEffect(() => {
    loadMeetings();
    loadAllTags();
    window.meetingMind.getSettings().then((s: any) => {
      setShowCostData(!!s.showCostData);
      setMeetinghubVisible(!!s.meetinghubEnabled || (s.meetinghubNotebooks || []).length > 0);
      setClubtoolsVisible(!!s.clubtoolsEnabled);
      setUserName(s.userName || '');
    });

    // The pipeline parked a recording behind the speaker gate, or Claude's
    // guesses landed. If it's the one on screen, show the Speakers tab.
    const unsubReviewNeeded = window.meetingMind.on('speakers:review-needed', (data: unknown) => {
      const { recordingId } = data as { recordingId: string };
      loadMeetings();
      if (selectedMeetingRef.current?.id === recordingId) {
        refreshSelectedMeeting();
        setDetailTab('speakers');
      }
    });
    const unsubSuggestions = window.meetingMind.on('speakers:suggestions', (data: unknown) => {
      const { recordingId } = data as { recordingId: string };
      if (selectedMeetingRef.current?.id === recordingId) refreshSelectedMeeting();
    });
    const unsubReviewComplete = window.meetingMind.on('speakers:review-complete', (data: unknown) => {
      const { recordingId } = data as { recordingId: string };
      if (selectedMeetingRef.current?.id === recordingId) refreshSelectedMeeting();
    });

    const unsubProgress = window.meetingMind.on('transcription:progress', (data: unknown) => {
      const { recordingId, status, message, progress } = data as { recordingId?: string; status: string; message: string; progress?: number };
      // Only the open meeting's progress belongs on this page. (Events with no
      // recording id are WhisperX setup, which has its own screen.)
      if (!recordingId || recordingId !== selectedMeetingRef.current?.id) return;
      setTranscriptionStatus(message);
      setTranscriptionProgress(progress);
      if (status !== 'complete' && status !== 'error') setIsTranscribing(true);
      if (status === 'complete') {
        setIsTranscribing(false);
        setTranscriptionStatus('');
        refreshSelectedMeeting();
        loadMeetings();
      } else if (status === 'error') {
        setIsTranscribing(false);
        setTranscriptionStatus(`Error: ${message}`);
      }
    });

    // Listen for background notes completion (e.g. auto-pipeline from RecordPage)
    const unsubNotesComplete = window.meetingMind.on('notes:complete', () => {
      // Refresh meeting list and selected meeting to pick up new notes/status
      loadMeetings();
      refreshSelectedMeeting();
    });

    // Listen for sentiment analysis completion
    const unsubSentiment = window.meetingMind.on('sentiment:complete', () => {
      refreshSelectedMeeting();
    });

    // Listen for MeetingHub push status updates (auto or manual)
    const unsubMeetingHub = window.meetingMind.on('meetinghub:status', () => {
      refreshSelectedMeeting();
    });
    const unsubClubTools = window.meetingMind.on('clubtools:status', () => {
      refreshSelectedMeeting();
    });

    return () => {
      unsubProgress();
      unsubNotesComplete();
      unsubSentiment();
      unsubMeetingHub();
      unsubClubTools();
      unsubReviewNeeded();
      unsubSuggestions();
      unsubReviewComplete();
      window.meetingMind.removeAllListeners('notes:stream');
      window.meetingMind.removeAllListeners('qa:stream');
      window.meetingMind.removeAllListeners('qa:complete');
      window.meetingMind.removeAllListeners('qa:error');
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  // Load project summary when project filter changes
  useEffect(() => {
    if (activeProjectFilter) {
      (window.meetingMind as any).getProjectSummary(activeProjectFilter).then((s: string | null) => {
        setProjectSummary(s);
      });
    } else {
      setProjectSummary(null);
      setShowProjectSummary(false);
    }
  }, [activeProjectFilter]);

  // Auto-scroll Q&A when streaming
  useEffect(() => {
    if (qaScrollRef.current && (qaStreamingAnswer || qaIsAsking)) {
      qaScrollRef.current.scrollTop = qaScrollRef.current.scrollHeight;
    }
  }, [qaStreamingAnswer, qaIsAsking]);

  // Close actions menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    }
    if (showActionsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showActionsMenu]);

  useEffect(() => {
    if (initialMeetingId) selectMeetingById(initialMeetingId);
  }, [initialMeetingId]);

  /**
   * Select a meeting that may sit outside the loaded window - a search hit, or a
   * deep link from another page. The list no longer holds the whole archive, so
   * the record is fetched from main and the list jumps to its day if needed.
   */
  async function selectMeetingById(id: string) {
    const rec = await window.meetingMind.getRecording(id);
    if (!rec) {
      showToast('Meeting not found');
      return;
    }
    // Decide from dates, not from meetings.some(...): on mount the initial
    // loadMeetings() has not resolved yet, so a membership check would report
    // false for a recent meeting and needlessly drop us into day view.
    const view = dateViewRef.current;
    const { startMs, endMs } = view.mode === 'day' ? dayBoundsMs(view.day) : recentWindowMs();
    const t = new Date(rec.date).getTime();
    if (t < startMs || t > endMs) showDay(dayKeyLocal(rec.date));
    selectMeeting(rec);
  }

  async function loadMeetings() {
    const view = dateViewRef.current;
    const range = view.mode === 'day' ? dayBoundsMs(view.day) : recentWindowMs();
    try {
      const list = await window.meetingMind.getRecordings(range);
      setMeetings(list);
    } catch {}
    if (calendarOpenRef.current) loadIndex();
  }

  async function loadIndex() {
    try {
      setRecIndex(await window.meetingMind.getRecordingIndex());
    } catch {}
  }

  // Set the ref before awaiting so loadMeetings() sees the new view immediately
  // rather than a render later.
  function showDay(day: DayKey) {
    dateViewRef.current = { mode: 'day', day };
    setDateView({ mode: 'day', day });
    setCalMonth(monthOfDay(day));
    loadMeetings();
  }

  function toggleCalendar() {
    const open = !calendarOpenRef.current;
    calendarOpenRef.current = open;
    setCalendarOpen(open);
    // Refresh on open so the dots reflect anything recorded since last time.
    if (open) loadIndex();
  }

  function backToRecent() {
    dateViewRef.current = { mode: 'recent' };
    setDateView({ mode: 'recent' });
    loadMeetings();
  }

  async function loadAllTags() {
    try {
      const tags = await window.meetingMind.getAllTags();
      setAllTags(tags);
    } catch {}
  }

  // Keep ref in sync so event listeners can access the latest selection
  useEffect(() => {
    selectedMeetingRef.current = selectedMeeting;
  }, [selectedMeeting]);

  async function refreshSelectedMeeting() {
    const current = selectedMeetingRef.current;
    if (!current) return;
    const updated = await window.meetingMind.getRecording(current.id);
    if (updated) {
      setSelectedMeeting(updated);
      // Load notes content if status is now complete
      if (updated.status === 'complete' || updated.status === 'transcribed') {
        const notes = await window.meetingMind.getNotes(updated.id);
        if (notes) setNotesContent(notes);
      }
      // Reload transcript utterances so a re-transcription's new speaker labels
      // show up without needing to reselect the meeting.
      if (updated.status === 'transcribed' || updated.status === 'complete' || updated.status === 'generating') {
        const transcriptData = await window.meetingMind.getTranscript(updated.id);
        setUtterances(transcriptData || []);
      }
      loadMeetings();
      loadAllTags();
    }
  }

  async function selectMeeting(rec: Recording) {
    setSelectedMeeting(rec);
    setNotesContent('');
    setUtterances([]);
    setTranscriptionStatus('');
    setIsTranscribing(rec.status === 'transcribing');
    setTranscriptionProgress(undefined);
    setIsStreaming(false);
    setIsLoadingNotes(false);
    setDetailTab('notes');
    setQaEntries([]);
    setQaQuestion('');
    setQaStreamingAnswer('');
    setQaStreamingId(null);
    setQaIsAsking(false);
    setNotesError(null);
    setQaError(null);

    const freshRec = await window.meetingMind.getRecording(rec.id);
    if (freshRec) {
      setSelectedMeeting(freshRec);
      if (freshRec.awaitingSpeakerReview && freshRec.status === 'transcribed') setDetailTab('speakers');

      if (freshRec.status === 'complete' || freshRec.status === 'transcribed') {
        const notes = await window.meetingMind.getNotes(freshRec.id);
        if (notes) setNotesContent(notes);
      }

      // Load transcript data
      if (freshRec.status === 'transcribed' || freshRec.status === 'complete' || freshRec.status === 'generating') {
        const transcriptData = await window.meetingMind.getTranscript(freshRec.id);
        setUtterances(transcriptData || []);
      }

      // Load Q&A history
      const questions = await (window.meetingMind as any).getQuestions(freshRec.id);
      setQaEntries(questions || []);

      // Load audio for the player
      if (freshRec.audioPath && !freshRec.audioRemovedAt) {
        audioControls.load(`media://${freshRec.audioPath}`);
      }
    }
  }

  async function loadTranscript() {
    if (!selectedMeeting) return;
    try {
      const data = await window.meetingMind.getTranscript(selectedMeeting.id);
      setUtterances(data || []);
    } catch {
      setUtterances([]);
    }
  }

  async function handleTranscribe(opts?: { forceNormalize?: boolean }) {
    if (!selectedMeeting) return;
    setIsTranscribing(true);
    setTranscriptionProgress(undefined);
    setTranscriptionStatus(opts?.forceNormalize ? 'Normalizing audio, then transcribing...' : 'Starting transcription...');
    const result = await window.meetingMind.startTranscription(selectedMeeting.id, opts);
    if (!result.success) {
      setIsTranscribing(false);
      setTranscriptionStatus(`Failed: ${result.error}`);
    }
  }

  async function handleGenerateNotes() {
    if (!selectedMeeting) return;
    setNotesContent('');
    setIsStreaming(true);
    setIsLoadingNotes(true);
    setNotesError(null);

    // Stream this meeting's notes in live. Main tags every chunk with the
    // recording it belongs to, so a pipeline run for another meeting can't
    // write into this one, and the listeners go away once this run ends.
    const recordingId = selectedMeeting.id;
    const unsubStream = window.meetingMind.on('notes:stream', (data: unknown) => {
      const chunk = data as { recordingId: string; text: string };
      if (chunk.recordingId !== recordingId) return;
      if (selectedMeetingRef.current?.id !== recordingId) return;
      setIsLoadingNotes(false);
      setNotesContent(prev => prev + chunk.text);
    });

    // The persistent notes:complete listener in useEffect handles
    // refreshing the meeting data. We just need to clear streaming state.
    const finish = (data: unknown) => {
      if ((data as { recordingId?: string })?.recordingId !== recordingId) return;
      unsubStream();
      unsubComplete();
      unsubError();
      if (selectedMeetingRef.current?.id !== recordingId) return;
      setIsStreaming(false);
      setIsLoadingNotes(false);
    };
    const unsubComplete = window.meetingMind.on('notes:complete', finish);
    const unsubError = window.meetingMind.on('notes:error', finish);

    const result = await window.meetingMind.generateNotes(recordingId);
    if (!result.success) {
      unsubStream();
      unsubComplete();
      unsubError();
      setIsStreaming(false);
      setIsLoadingNotes(false);
      setNotesError(result.error || 'Unknown error');
    }
  }

  async function handleSaveNotes() {
    if (!selectedMeeting) return;
    const dateStr = new Date(selectedMeeting.date).toISOString().slice(0, 10);
    const title = selectedMeeting.title || 'Untitled Meeting';
    const filename = `${dateStr} - ${title}.md`;
    const result = await window.meetingMind.saveNotes(selectedMeeting.id, filename);
    if (result.success) showToast(`Saved to ${result.path}`);
    else showToast(`Save failed: ${result.error}`);
  }

  async function handleSaveToObsidian() {
    if (!selectedMeeting) return;
    const dateStr = new Date(selectedMeeting.date).toISOString().slice(0, 10);
    const title = selectedMeeting.title || 'Untitled Meeting';
    const filename = `${dateStr} - ${title}.md`;
    const result = await window.meetingMind.saveToObsidian(selectedMeeting.id, filename);
    if (result.success) showToast('Saved to Obsidian vault!');
    else showToast(`Save failed: ${result.error}`);
  }

  async function handleSendToMeetingHub() {
    if (!selectedMeeting) return;
    showToast('Sending to MeetingHub...');
    const result = await window.meetingMind.sendToMeetingHub(selectedMeeting.id);
    if (result.success) {
      showToast(result.detail || 'Sent to MeetingHub');
      refreshSelectedMeeting();
    } else {
      showToast(`MeetingHub: ${result.error}`);
    }
  }

  async function handleSendToClubTools() {
    if (!selectedMeeting) return;
    showToast('Sending to Club Tools...');
    const result = await window.meetingMind.sendToClubTools(selectedMeeting.id);
    showToast(result.success ? (result.detail || 'Sent to Club Tools') : `Club Tools: ${result.error}`);
    refreshSelectedMeeting();
  }

  async function handleDeleteMeeting() {
    if (!selectedMeeting) return;
    const result = await window.meetingMind.deleteRecording(selectedMeeting.id);
    if (result.success) {
      setShowDeleteConfirm(false);
      setSelectedMeeting(null);
      loadMeetings();
      showToast('Meeting deleted');
    }
  }

  async function handleTagsChange(tags: string[]) {
    if (!selectedMeeting) return;
    await window.meetingMind.setRecordingTags(selectedMeeting.id, tags);
    setSelectedMeeting({ ...selectedMeeting, tags });
    loadMeetings();
    loadAllTags();
  }

  function startEditingTitle() {
    if (!selectedMeeting) return;
    setEditTitle(selectedMeeting.title || '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }

  async function saveTitle() {
    if (!selectedMeeting) return;
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== selectedMeeting.title) {
      await window.meetingMind.renameRecording(selectedMeeting.id, trimmed);
      setSelectedMeeting({ ...selectedMeeting, title: trimmed });
      loadMeetings();
    }
    setIsEditingTitle(false);
  }

  async function handleRenameSpeaker(oldName: string, newName: string) {
    if (!selectedMeeting) return;
    await window.meetingMind.renameSpeaker(selectedMeeting.id, oldName, newName);
    refreshSelectedMeeting();
  }

  async function handleSuggestSpeakerNames() {
    if (!selectedMeeting) return;
    const result = await window.meetingMind.identifySpeakers(selectedMeeting.id);
    if (!result.success) showToast(`Could not identify speakers: ${result.error}`);
    refreshSelectedMeeting();
  }

  function handleGenerateNotesFromSpeakers() {
    setDetailTab('notes');
    handleGenerateNotes();
  }

  async function handleAskQuestion() {
    if (!selectedMeeting || !qaQuestion.trim() || qaIsAsking) return;
    const question = qaQuestion.trim();
    setQaQuestion('');
    setQaActiveQuestion(question);
    setQaIsAsking(true);
    setQaStreamingAnswer('');
    setQaError(null);

    // Set up streaming listener
    window.meetingMind.removeAllListeners('qa:stream');
    window.meetingMind.removeAllListeners('qa:complete');
    window.meetingMind.removeAllListeners('qa:error');

    let currentQaId: string | null = null;

    window.meetingMind.on('qa:stream', (data: unknown) => {
      const { qaId, text } = data as { qaId: string; text: string };
      if (!currentQaId) {
        currentQaId = qaId;
        setQaStreamingId(qaId);
      }
      setQaStreamingAnswer(prev => prev + text);
    });

    window.meetingMind.on('qa:complete', () => {
      setQaIsAsking(false);
      setQaStreamingAnswer('');
      setQaStreamingId(null);
      // Reload Q&A list
      (window.meetingMind as any).getQuestions(selectedMeeting.id).then((entries: QAEntry[]) => {
        setQaEntries(entries || []);
      });
    });

    window.meetingMind.on('qa:error', (data: unknown) => {
      const { error } = data as { error: string };
      setQaIsAsking(false);
      setQaStreamingAnswer('');
      setQaStreamingId(null);
      setQaError(error);
    });

    const result = await (window.meetingMind as any).askQuestion(selectedMeeting.id, question);
    if (!result.success) {
      setQaIsAsking(false);
      setQaStreamingAnswer('');
      setQaStreamingId(null);
      setQaError(result.error || 'Unknown error');
    }
  }

  async function handleDeleteQuestion(qaId: string) {
    if (!selectedMeeting) return;
    await (window.meetingMind as any).deleteQuestion(selectedMeeting.id, qaId);
    setQaEntries(prev => prev.filter(e => e.id !== qaId));
  }

  async function handleNotesCorrection(data: { original: string; corrected: string }) {
    if (!selectedMeeting) return;

    // Replace all occurrences in the notes content
    const updatedNotes = notesContent.split(data.original).join(data.corrected);
    setNotesContent(updatedNotes);

    // Persist to disk
    await (window.meetingMind as any).updateNotes(selectedMeeting.id, updatedNotes);

    // Add to custom vocabulary
    const settings = await window.meetingMind.getSettings();
    const vocab = (settings.customVocabulary || []) as { term: string; variants: string[] }[];
    const existing = vocab.find((e: any) => e.term === data.corrected);
    if (existing) {
      if (!existing.variants.includes(data.original)) {
        existing.variants.push(data.original);
      }
    } else {
      vocab.push({ term: data.corrected, variants: [data.original] });
    }
    await window.meetingMind.setSetting('customVocabulary', vocab);

    showToast(`Corrected "${data.original}" → "${data.corrected}"`);
  }

  function showToast(msg: string) {
    setToastMessage(msg);
    // Restart the countdown so a rapid second toast isn't cut short by the first timer
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 3000);
  }

  // Filter meetings by notebook, then by project, then by tag
  // Recordings without a notebook field belong to the first (default) notebook
  const defaultNotebook = notebooks?.[0] || 'Personal';
  const notebookMeetings = activeNotebook
    ? meetings.filter(r => (r.notebook || defaultNotebook) === activeNotebook)
    : meetings;
  const projectMeetings = activeProjectFilter
    ? notebookMeetings.filter(r => (r as any).project === activeProjectFilter)
    : notebookMeetings;
  const filteredMeetings = filterTag
    ? projectMeetings.filter(r => r.tags?.includes(filterTag))
    : projectMeetings;
  const activeProject = activeProjectFilter ? projects.find(p => p.id === activeProjectFilter) : null;

  return (
    <>
      <ProjectSummaryHeader
        activeProject={activeProject}
        showProjectSummary={showProjectSummary}
        setShowProjectSummary={setShowProjectSummary}
        isGeneratingProjectSummary={isGeneratingProjectSummary}
        setIsGeneratingProjectSummary={setIsGeneratingProjectSummary}
        projectSummary={projectSummary}
        setProjectSummary={setProjectSummary}
        projectSummaryStreaming={projectSummaryStreaming}
        setProjectSummaryStreaming={setProjectSummaryStreaming}
        showToast={showToast}
      />
      <div className="page-content" style={{ display: 'flex', gap: 20, height: activeProject && showProjectSummary ? 'calc(100vh - 412px)' : 'calc(100vh - 112px)' }}>
        {/* List */}
        <MeetingList
          filteredMeetings={filteredMeetings}
          selectedMeeting={selectedMeeting}
          selectMeeting={selectMeeting}
          selectMeetingById={selectMeetingById}
          allTags={allTags}
          filterTag={filterTag}
          setFilterTag={setFilterTag}
          recIndex={recIndex}
          activeNotebook={activeNotebook}
          activeProjectFilter={activeProjectFilter}
          defaultNotebook={defaultNotebook}
          dateView={dateView}
          calendarOpen={calendarOpen}
          toggleCalendar={toggleCalendar}
          calMonth={calMonth}
          setCalMonth={setCalMonth}
          showDay={showDay}
          backToRecent={backToRecent}
        />

        {/* Detail Panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedMeeting ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              Select a meeting to view details
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <MeetingDetailHeader
                selectedMeeting={selectedMeeting}
                setSelectedMeeting={setSelectedMeeting}
                isEditingTitle={isEditingTitle}
                setIsEditingTitle={setIsEditingTitle}
                editTitle={editTitle}
                setEditTitle={setEditTitle}
                titleInputRef={titleInputRef}
                startEditingTitle={startEditingTitle}
                saveTitle={saveTitle}
                showCostData={showCostData}
                isTranscribing={isTranscribing}
                isStreaming={isStreaming}
                notesContent={notesContent}
                handleTranscribe={handleTranscribe}
                handleGenerateNotes={handleGenerateNotes}
                actionsMenuRef={actionsMenuRef}
                showActionsMenu={showActionsMenu}
                setShowActionsMenu={setShowActionsMenu}
                setPendingConfirm={setPendingConfirm}
                setShowDeleteConfirm={setShowDeleteConfirm}
                handleSaveNotes={handleSaveNotes}
                handleSaveToObsidian={handleSaveToObsidian}
                handleSendToMeetingHub={handleSendToMeetingHub}
                meetinghubVisible={meetinghubVisible}
                handleSendToClubTools={handleSendToClubTools}
                clubtoolsVisible={clubtoolsVisible}
                showToast={showToast}
                refreshSelectedMeeting={refreshSelectedMeeting}
                loadMeetings={loadMeetings}
                notebooks={notebooks}
                defaultNotebook={defaultNotebook}
                activeNotebook={activeNotebook}
                projects={projects}
                allTags={allTags}
                handleTagsChange={handleTagsChange}
              />

              {/* Audio Player — pinned */}
              {selectedMeeting.audioRemovedAt && (
                <div className="form-hint" style={{ flexShrink: 0, marginBottom: 12 }}>
                  Audio removed {new Date(selectedMeeting.audioRemovedAt).toLocaleDateString()} by the retention
                  setting. The transcript and notes are kept.
                </div>
              )}
              {selectedMeeting.audioPath && !selectedMeeting.audioRemovedAt && (
                <div style={{ flexShrink: 0, marginBottom: 12 }}>
                  <AudioPlayer
                    isPlaying={audioState.isPlaying}
                    currentTime={audioState.currentTime}
                    duration={audioState.duration}
                    playbackRate={audioState.playbackRate}
                    onToggle={audioControls.toggle}
                    onSeek={audioControls.seek}
                    onRateChange={audioControls.setRate}
                  />
                </div>
              )}

              {/* Transcription progress */}
              {isTranscribing && (
                <div className="card" style={{ textAlign: 'center' }}>
                  <div className="pipeline-spinner" style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Transcribing Audio</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{transcriptionStatus}</div>
                  <div style={{ marginTop: 12 }}>
                    <ProgressBar value={transcriptionProgress} label="Transcription progress" />
                  </div>
                  {typeof transcriptionProgress === 'number' && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(transcriptionProgress)}%
                    </div>
                  )}
                </div>
              )}

              {/* Transcription error */}
              {!isTranscribing && transcriptionStatus && (transcriptionStatus.startsWith('Error') || transcriptionStatus.startsWith('Failed')) && (
                <ErrorCard
                  title="Transcription Failed"
                  error={transcriptionStatus.replace(/^(Error|Failed):\s*/, '')}
                  onRetry={() => handleTranscribe()}
                  onDismiss={() => setTranscriptionStatus('')}
                  secondaryAction={{
                    label: 'Normalize Audio & Retry',
                    onClick: () => { setTranscriptionStatus(''); handleTranscribe({ forceNormalize: true }); },
                  }}
                />
              )}

              {/* Tab bar for Notes / Transcript — pinned */}
              {(selectedMeeting.status === 'transcribed' || selectedMeeting.status === 'complete' || selectedMeeting.status === 'generating') && (
                <DetailTabBar detailTab={detailTab} setDetailTab={setDetailTab} />
              )}

              {detailTab === 'notes' && (
                <NotesTab
                  selectedMeeting={selectedMeeting}
                  notesContent={notesContent}
                  notesError={notesError}
                  setNotesError={setNotesError}
                  isStreaming={isStreaming}
                  isLoadingNotes={isLoadingNotes}
                  handleGenerateNotes={handleGenerateNotes}
                  handleNotesCorrection={handleNotesCorrection}
                  setDetailTab={setDetailTab}
                />
              )}

              {/* Transcript tab */}
              {detailTab === 'transcript' && (
                <TranscriptTab
                  selectedMeeting={selectedMeeting}
                  utterances={utterances}
                  currentTime={audioState.currentTime}
                  onSeek={audioControls.seek}
                  handleRenameSpeaker={handleRenameSpeaker}
                />
              )}

              {/* Speakers tab */}
              {detailTab === 'speakers' && (
                <SpeakerPanel
                  utterances={utterances}
                  speakerNames={selectedMeeting.speakerNames || {}}
                  onRenameSpeaker={handleRenameSpeaker}
                  attendees={selectedMeeting.calendarEvent?.attendees || []}
                  userName={userName}
                  suggestions={selectedMeeting.speakerSuggestions || {}}
                  awaitingReview={!!selectedMeeting.awaitingSpeakerReview && selectedMeeting.status === 'transcribed'}
                  canGenerateNotes={selectedMeeting.status === 'transcribed'}
                  isGenerating={isStreaming}
                  onGenerateNotes={handleGenerateNotesFromSpeakers}
                  onSuggestNames={handleSuggestSpeakerNames}
                  onPlaySegment={selectedMeeting.audioPath && !selectedMeeting.audioRemovedAt ? audioControls.playRange : undefined}
                  currentTime={audioState.currentTime}
                  isPlaying={audioState.isPlaying}
                />
              )}

              {/* Ask tab */}
              {detailTab === 'ask' && (
                <AskTab
                  selectedMeeting={selectedMeeting}
                  qaScrollRef={qaScrollRef}
                  qaEntries={qaEntries}
                  qaIsAsking={qaIsAsking}
                  qaError={qaError}
                  setQaError={setQaError}
                  qaActiveQuestion={qaActiveQuestion}
                  qaStreamingAnswer={qaStreamingAnswer}
                  qaQuestion={qaQuestion}
                  setQaQuestion={setQaQuestion}
                  handleAskQuestion={handleAskQuestion}
                  handleDeleteQuestion={handleDeleteQuestion}
                  showToast={showToast}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmations */}
      {showDeleteConfirm && selectedMeeting && (
        <ConfirmDialog
          title="Delete meeting?"
          confirmLabel="Delete"
          danger
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteMeeting}
        >
          This will permanently delete <strong>{selectedMeeting.title || 'this meeting'}</strong> and
          all associated files (audio, transcript, and notes). This cannot be undone.
        </ConfirmDialog>
      )}
      {pendingConfirm === 'regenerate' && selectedMeeting && (
        <ConfirmDialog
          title="Replace these notes?"
          confirmLabel="Regenerate"
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); handleGenerateNotes(); }}
        >
          New notes will be written from the transcript and replace the current ones,
          including any edits you've made to them.
        </ConfirmDialog>
      )}
      {pendingConfirm === 'retranscribe' && selectedMeeting && (
        <ConfirmDialog
          title="Re-transcribe this meeting?"
          confirmLabel="Re-transcribe"
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); handleTranscribe(); }}
        >
          The audio is sent for transcription again and the new transcript replaces the
          current one. Speaker names you've set may no longer line up, and a cloud
          provider charges for the run. Your notes stay as they are until you regenerate them.
        </ConfirmDialog>
      )}

      {/* Toast */}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  );
}
