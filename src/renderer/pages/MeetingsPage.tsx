import React, { useState, useEffect, useRef } from 'react';
import type { Recording } from '../types';
import TagEditor from '../components/TagEditor';
import TranscriptViewer from '../components/TranscriptViewer';
import AudioPlayer from '../components/AudioPlayer';
import SearchBar from '../components/SearchBar';
import SpeakerPanel from '../components/SpeakerPanel';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import MarkdownRenderer from '../components/MarkdownRenderer';

interface MeetingsPageProps {
  initialMeetingId?: string | null;
  activeNotebook?: string;
  notebooks?: string[];
}

type DetailTab = 'notes' | 'transcript' | 'speakers' | 'ask';

interface QAEntry {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

export default function MeetingsPage({ initialMeetingId, activeNotebook, notebooks }: MeetingsPageProps) {
  const [meetings, setMeetings] = useState<Recording[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Recording | null>(null);
  const [notesContent, setNotesContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('notes');
  const [utterances, setUtterances] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showCostData, setShowCostData] = useState(false);
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaIsAsking, setQaIsAsking] = useState(false);
  const [qaStreamingAnswer, setQaStreamingAnswer] = useState('');
  const [qaStreamingId, setQaStreamingId] = useState<string | null>(null);
  const [qaActiveQuestion, setQaActiveQuestion] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const qaScrollRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const selectedMeetingRef = useRef<Recording | null>(null);

  const [audioState, audioControls] = useAudioPlayer();

  useEffect(() => {
    loadMeetings();
    loadAllTags();
    window.meetingMind.getSettings().then((s: any) => setShowCostData(!!s.showCostData));

    const unsubProgress = window.meetingMind.on('transcription:progress', (data: unknown) => {
      const { status, message } = data as { status: string; message: string };
      setTranscriptionStatus(message);
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

    return () => {
      unsubProgress();
      unsubNotesComplete();
      window.meetingMind.removeAllListeners('notes:stream');
      window.meetingMind.removeAllListeners('qa:stream');
      window.meetingMind.removeAllListeners('qa:complete');
      window.meetingMind.removeAllListeners('qa:error');
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

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
    if (initialMeetingId && meetings.length > 0) {
      const rec = meetings.find(r => r.id === initialMeetingId);
      if (rec) selectMeeting(rec);
    }
  }, [initialMeetingId, meetings]);

  async function loadMeetings() {
    try {
      const list = await window.meetingMind.getRecordings();
      setMeetings(list);
    } catch {}
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
      loadMeetings();
      loadAllTags();
    }
  }

  async function selectMeeting(rec: Recording) {
    setSelectedMeeting(rec);
    setNotesContent('');
    setUtterances([]);
    setTranscriptionStatus('');
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
      if (freshRec.audioPath) {
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

  async function handleTranscribe() {
    if (!selectedMeeting) return;
    setIsTranscribing(true);
    setTranscriptionStatus('Starting transcription...');
    const result = await window.meetingMind.startTranscription(selectedMeeting.id);
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

    // Replace stream listener for manual generation (shows chunks live)
    window.meetingMind.removeAllListeners('notes:stream');

    window.meetingMind.on('notes:stream', (chunk: unknown) => {
      setIsLoadingNotes(false);
      setNotesContent(prev => prev + (chunk as string));
    });

    // The persistent notes:complete listener in useEffect handles
    // refreshing the meeting data. We just need to clear streaming state.
    const unsubManual = window.meetingMind.on('notes:complete', () => {
      setIsStreaming(false);
      setIsLoadingNotes(false);
      unsubManual();
    });

    const result = await window.meetingMind.generateNotes(selectedMeeting.id);
    if (!result.success) {
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
    setTimeout(() => setToastMessage(''), 3000);
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'recorded': return 'Recorded';
      case 'transcribing': return 'Transcribing...';
      case 'transcribed': return 'Transcribed';
      case 'generating': return 'Generating...';
      case 'complete': return 'Notes Ready';
      default: return status;
    }
  }

  // Filter meetings by notebook, then by tag
  // Recordings without a notebook field belong to the first (default) notebook
  const defaultNotebook = notebooks?.[0] || 'Personal';
  const notebookMeetings = activeNotebook
    ? meetings.filter(r => (r.notebook || defaultNotebook) === activeNotebook)
    : meetings;
  const filteredMeetings = filterTag
    ? notebookMeetings.filter(r => r.tags?.includes(filterTag))
    : notebookMeetings;

  // Group meetings by day
  function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  const dayGroups: { label: string; meetings: typeof filteredMeetings }[] = [];
  for (const rec of filteredMeetings) {
    const label = getDayLabel(rec.date);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) {
      last.meetings.push(rec);
    } else {
      dayGroups.push({ label, meetings: [rec] });
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Meetings</h1>
      </div>
      <div className="page-content" style={{ display: 'flex', gap: 20, height: 'calc(100vh - 112px)' }}>
        {/* List */}
        <div style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Fixed toolbar */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar onSelectResult={(id) => {
                const rec = meetings.find(r => r.id === id);
                if (rec) selectMeeting(rec);
              }} />
            </div>
            {allTags.length > 0 && (
              <select
                value={filterTag || ''}
                onChange={e => setFilterTag(e.target.value || null)}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  padding: '6px 8px',
                  flexShrink: 0,
                }}
              >
                <option value="">All tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          {/* Scrollable meetings list */}
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
          {filteredMeetings.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {filterTag ? 'No meetings with this tag.' : 'No meetings yet. Record a meeting to get started.'}
            </div>
          )}

          {dayGroups.map(group => (
            <div key={group.label}>
              <div style={{
                padding: '12px 4px 6px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {group.label}
              </div>
              <div className="meeting-list">
                {group.meetings.map(rec => (
                  <div
                    key={rec.id}
                    className="meeting-item"
                    onClick={() => selectMeeting(rec)}
                    style={{
                      borderColor: selectedMeeting?.id === rec.id ? 'var(--accent-blue)' : undefined,
                      position: 'relative',
                    }}
                  >
                    <div className="meeting-item-info">
                      <div className="meeting-item-title">{rec.title || 'Untitled Meeting'}</div>
                      <div className="meeting-item-meta">
                        {new Date(rec.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {formatDuration(rec.duration)} &middot; {formatFileSize(rec.fileSize)}
                      </div>
                      {rec.tags && rec.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {rec.tags.map(t => (
                            <span key={t} style={{
                              padding: '1px 6px',
                              background: 'var(--accent-blue-tint)',
                              color: 'var(--accent-blue)',
                              borderRadius: 8,
                              fontSize: 10,
                            }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', gap: 5, alignItems: 'center' }}>
                      {/* Transcript icon */}
                      <StatusIcon
                        ready={['transcribed', 'generating', 'complete'].includes(rec.status)}
                        activeColor="var(--accent-blue)"
                        tooltip={
                          rec.status === 'transcribing' ? 'Transcribing...'
                          : ['transcribed', 'generating', 'complete'].includes(rec.status) ? 'Transcript ready'
                          : 'Not yet transcribed'
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </StatusIcon>
                      {/* Notes icon */}
                      <StatusIcon
                        ready={rec.status === 'complete'}
                        activeColor="var(--accent-green)"
                        tooltip={
                          rec.status === 'generating' ? 'Generating notes...'
                          : rec.status === 'complete' ? 'Notes ready'
                          : 'Notes not generated'
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                      </StatusIcon>
                      {(rec.status === 'transcribing' || rec.status === 'generating') && (
                        <div className="pipeline-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedMeeting ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              Select a meeting to view details
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Header bar — compact */}
              <div className="card" style={{ flexShrink: 0, marginBottom: 12, padding: '10px 16px' }}>
                {/* Row 1: title + meta + actions */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditingTitle ? (
                      <input
                        ref={titleInputRef}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveTitle();
                          if (e.key === 'Escape') setIsEditingTitle(false);
                        }}
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          background: 'var(--bg-input)',
                          border: '1px solid var(--accent-blue)',
                          borderRadius: 'var(--radius)',
                          color: 'var(--text-primary)',
                          padding: '2px 8px',
                          width: '100%',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <div
                        style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onClick={startEditingTitle}
                        title="Click to edit title"
                      >
                        {selectedMeeting.title || 'Untitled Meeting'}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>&#9998;</span>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap' }}>
                      {new Date(selectedMeeting.date).toLocaleString()} &middot;{' '}
                      {formatDuration(selectedMeeting.duration)} &middot;{' '}
                      {formatFileSize(selectedMeeting.fileSize)}
                      {showCostData && selectedMeeting.transcriptionCost && (
                        <> &middot; <span style={{ color: 'var(--accent-yellow)' }}>${selectedMeeting.transcriptionCost.estimatedCost.toFixed(4)}</span></>
                      )}
                      <span className={`status-badge ${selectedMeeting.status}`} style={{ marginLeft: 8 }}>
                        {getStatusLabel(selectedMeeting.status)}
                      </span>
                    </div>
                  </div>

                  {/* Primary action (pipeline step) */}
                  {selectedMeeting.status === 'recorded' && (
                    <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={handleTranscribe} disabled={isTranscribing}>
                      {isTranscribing ? 'Transcribing...' : 'Transcribe'}
                    </button>
                  )}
                  {selectedMeeting.status === 'transcribed' && (
                    <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={handleGenerateNotes} disabled={isStreaming}>
                      {isStreaming ? 'Generating...' : 'Generate Notes'}
                    </button>
                  )}

                  {/* Gear menu */}
                  <div ref={actionsMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowActionsMenu(prev => !prev)}
                      style={{ padding: '4px 6px', lineHeight: 1 }}
                      title="Actions"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                    {showActionsMenu && (
                      <div className="actions-dropdown">
                        {selectedMeeting.status === 'complete' && (
                          <>
                            <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSaveNotes(); }}>
                              Save Notes
                            </button>
                            <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSaveToObsidian(); }}>
                              Save to Obsidian
                            </button>
                            <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleGenerateNotes(); }} disabled={isStreaming}>
                              Regenerate Notes
                            </button>
                            <div className="actions-dropdown-sep" />
                          </>
                        )}
                        <button className="actions-dropdown-item" onClick={async () => { setShowActionsMenu(false); const r = await (window.meetingMind as any).copyNotesToClipboard(selectedMeeting.id); showToast(r.success ? 'Notes copied to clipboard' : `Copy failed: ${r.error}`); }}>
                          Copy to Clipboard
                        </button>
                        <button className="actions-dropdown-item" onClick={async () => { setShowActionsMenu(false); showToast('Generating PDF...'); const r = await (window.meetingMind as any).exportAsPDF(selectedMeeting.id); showToast(r.success ? `PDF saved: ${r.path}` : `PDF export failed: ${r.error}`); }}>
                          Export as PDF
                        </button>
                        <button className="actions-dropdown-item" onClick={async () => { setShowActionsMenu(false); const r = await (window.meetingMind as any).emailNotes(selectedMeeting.id); if (!r.success) showToast(`Email failed: ${r.error}`); }}>
                          Email to Attendees
                        </button>
                        <div className="actions-dropdown-sep" />
                        <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); window.meetingMind.openInFinder(selectedMeeting.audioPath); }}>
                          Open in Finder
                        </button>
                        {notebooks && notebooks.length > 1 && (
                          <>
                            <div className="actions-dropdown-sep" />
                            <div style={{ padding: '4px 12px 2px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Move to Notebook
                            </div>
                            {notebooks.filter(nb => nb !== (selectedMeeting.notebook || defaultNotebook)).map(nb => (
                              <button
                                key={nb}
                                className="actions-dropdown-item"
                                onClick={async () => {
                                  setShowActionsMenu(false);
                                  await (window.meetingMind as any).moveToNotebook(selectedMeeting.id, nb);
                                  setSelectedMeeting({ ...selectedMeeting, notebook: nb });
                                  loadMeetings();
                                  showToast(`Moved to ${nb}`);
                                }}
                              >
                                {nb}
                              </button>
                            ))}
                          </>
                        )}
                        <div className="actions-dropdown-sep" />
                        <button className="actions-dropdown-item actions-dropdown-danger" onClick={() => { setShowActionsMenu(false); setShowDeleteConfirm(true); }}>
                          Delete Meeting
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Row 2: tags */}
                <div style={{ marginTop: 6 }}>
                  <TagEditor
                    tags={selectedMeeting.tags || []}
                    allTags={allTags}
                    onChange={handleTagsChange}
                  />
                </div>
              </div>

              {/* Audio Player — pinned */}
              {selectedMeeting.audioPath && (
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
                  <div style={{ marginTop: 12, height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
                    <div className="progress-bar-indeterminate" />
                  </div>
                </div>
              )}

              {/* Transcription error */}
              {!isTranscribing && transcriptionStatus && (transcriptionStatus.startsWith('Error') || transcriptionStatus.startsWith('Failed')) && (
                <ErrorCard
                  title="Transcription Failed"
                  error={transcriptionStatus.replace(/^(Error|Failed):\s*/, '')}
                  onRetry={handleTranscribe}
                  onDismiss={() => setTranscriptionStatus('')}
                />
              )}

              {/* Tab bar for Notes / Transcript — pinned */}
              {(selectedMeeting.status === 'transcribed' || selectedMeeting.status === 'complete' || selectedMeeting.status === 'generating') && (
                <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', flexShrink: 0, paddingLeft: 12 }}>
                  <button
                    onClick={() => setDetailTab('notes')}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'none',
                      border: 'none',
                      borderBottom: detailTab === 'notes' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      color: detailTab === 'notes' ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Notes
                  </button>
                  <button
                    onClick={() => setDetailTab('transcript')}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'none',
                      border: 'none',
                      borderBottom: detailTab === 'transcript' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      color: detailTab === 'transcript' ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Transcript
                  </button>
                  <button
                    onClick={() => setDetailTab('speakers')}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'none',
                      border: 'none',
                      borderBottom: detailTab === 'speakers' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      color: detailTab === 'speakers' ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Speakers
                  </button>
                  <button
                    onClick={() => setDetailTab('ask')}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'none',
                      border: 'none',
                      borderBottom: detailTab === 'ask' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                      color: detailTab === 'ask' ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Ask
                  </button>
                </div>
              )}

              {/* Notes error */}
              {detailTab === 'notes' && notesError && (
                <ErrorCard
                  title="Notes Generation Failed"
                  error={notesError}
                  onRetry={handleGenerateNotes}
                  onDismiss={() => setNotesError(null)}
                />
              )}

              {/* Notes tab */}
              {detailTab === 'notes' && !notesError && (isStreaming || isLoadingNotes || notesContent || selectedMeeting.status === 'complete') && (
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Meeting Notes
                    {isStreaming && <span style={{ color: 'var(--accent-yellow)', marginLeft: 8 }}>(generating...)</span>}
                  </h3>
                  {isLoadingNotes && !notesContent ? (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                      <div className="pipeline-spinner" style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Sending transcript to Claude...</div>
                    </div>
                  ) : (
                    <div style={{
                      background: 'var(--bg-input)',
                      padding: 16,
                      borderRadius: 'var(--radius)',
                      flex: 1,
                      overflowY: 'auto',
                    }}>
                      {notesContent ? (
                        <MarkdownRenderer content={notesContent} onCorrection={handleNotesCorrection} />
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>Notes will appear here after generation.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Transcript tab */}
              {detailTab === 'transcript' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                  {utterances.length > 0 ? (
                    <TranscriptViewer
                      utterances={utterances}
                      currentTime={audioState.currentTime}
                      speakerNames={selectedMeeting.speakerNames || {}}
                      onSeek={audioControls.seek}
                      onRenameSpeaker={handleRenameSpeaker}
                    />
                  ) : (
                    <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: 13 }}>
                        Transcript viewer requires utterance-level data from AssemblyAI.
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        The raw transcript text is available in the Notes tab after generation.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Speakers tab */}
              {detailTab === 'speakers' && (
                <SpeakerPanel
                  utterances={utterances}
                  speakerNames={selectedMeeting.speakerNames || {}}
                  onRenameSpeaker={handleRenameSpeaker}
                />
              )}

              {/* Ask tab */}
              {detailTab === 'ask' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                  {/* Q&A history */}
                  <div
                    ref={qaScrollRef}
                    style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}
                  >
                    {qaEntries.length === 0 && !qaIsAsking && !qaError && (
                      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 8 }}>
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <div style={{ fontSize: 13 }}>Ask a question about this meeting</div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          The full transcript and notes will be provided as context.
                        </div>
                      </div>
                    )}

                    {qaError && (
                      <div style={{ padding: '0 4px', marginBottom: 12 }}>
                        <ErrorCard
                          title="Question Failed"
                          error={qaError}
                          onDismiss={() => setQaError(null)}
                        />
                      </div>
                    )}

                    {qaEntries.map(entry => (
                      <div key={entry.id} style={{ marginBottom: 16, padding: '0 4px' }}>
                        {/* Question */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <div style={{
                            flex: 1,
                            background: 'var(--accent-blue-tint)',
                            borderRadius: '12px 12px 4px 12px',
                            padding: '10px 14px',
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            marginLeft: 40,
                          }}>
                            {entry.question}
                          </div>
                        </div>
                        {/* Answer */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'var(--accent-blue-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginTop: 2,
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          </div>
                          <div style={{
                            flex: 1,
                            background: 'var(--bg-input)',
                            borderRadius: '4px 12px 12px 12px',
                            padding: '10px 14px',
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            lineHeight: 1.6,
                            position: 'relative',
                          }}>
                            <MarkdownRenderer content={entry.answer} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-color)' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <button
                                  onClick={async () => {
                                    const r = await (window.meetingMind as any).saveQAToObsidian(selectedMeeting!.id, entry.id);
                                    showToast(r.success ? 'Added to Obsidian note' : r.error);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    display: 'flex',
                                    alignItems: 'center',
                                  }}
                                  title="Add to Obsidian note"
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="12" y1="18" x2="12" y2="12" />
                                    <line x1="9" y1="15" x2="15" y2="15" />
                                  </svg>
                                </button>
                              <button
                                onClick={() => handleDeleteQuestion(entry.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontSize: 11,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                }}
                                title="Delete this Q&A"
                              >
                                &times;
                              </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Streaming answer */}
                    {qaIsAsking && (
                      <div style={{ marginBottom: 16, padding: '0 4px' }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <div style={{
                            flex: 1,
                            background: 'var(--accent-blue-tint)',
                            borderRadius: '12px 12px 4px 12px',
                            padding: '10px 14px',
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            marginLeft: 40,
                          }}>
                            {qaActiveQuestion}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'var(--accent-blue-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginTop: 2,
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          </div>
                          <div style={{
                            flex: 1,
                            background: 'var(--bg-input)',
                            borderRadius: '4px 12px 12px 12px',
                            padding: '10px 14px',
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            lineHeight: 1.6,
                          }}>
                            {qaStreamingAnswer ? (
                              <MarkdownRenderer content={qaStreamingAnswer} />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                                <div className="pipeline-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                                Thinking...
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input area */}
                  <div style={{
                    flexShrink: 0,
                    padding: '8px 0',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: 8,
                  }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ask a question about this meeting..."
                      value={qaQuestion}
                      onChange={e => setQaQuestion(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAskQuestion();
                        }
                      }}
                      disabled={qaIsAsking}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleAskQuestion}
                      disabled={qaIsAsking || !qaQuestion.trim()}
                      style={{ flexShrink: 0 }}
                    >
                      {qaIsAsking ? (
                        <div className="pipeline-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedMeeting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowDeleteConfirm(false)}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)', padding: 24,
            width: 400, maxWidth: '90vw', boxShadow: 'var(--shadow-modal)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
              <div style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: 2 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Delete Meeting?</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  This will permanently delete <strong>{selectedMeeting.title || 'this meeting'}</strong> and
                  all associated files (audio, transcript, and notes). This cannot be undone.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn" onClick={handleDeleteMeeting}
                style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  );
}

function ErrorCard({ title, error, onRetry, onDismiss }: {
  title: string;
  error: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(`${title}\n\n${error}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card" style={{
      border: '1px solid var(--accent-primary)',
      background: 'var(--accent-red-tint)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 4 }}>{title}</div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            overflow: 'hidden',
            maxHeight: expanded ? 'none' : '2.8em',
          }}>
            {error}
          </div>
          {error.length > 120 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: 'none', border: 'none', color: 'var(--accent-blue)',
                cursor: 'pointer', fontSize: 11, padding: '4px 0 0',
              }}
            >
              {expanded ? 'Show less' : 'Show full error'}
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '0 2px', fontSize: 16, lineHeight: 1, flexShrink: 0,
            }}
          >&times;</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {onRetry && (
          <button className="btn btn-secondary" onClick={onRetry} style={{ fontSize: 12, padding: '4px 12px' }}>
            Retry
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={handleCopy}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          {copied ? 'Copied!' : 'Copy Error'}
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ ready, activeColor, tooltip, children }: {
  ready: boolean;
  activeColor: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        color: ready ? activeColor : 'var(--text-muted)',
        opacity: ready ? 1 : 0.25,
        cursor: 'default',
      }}
    >
      {children}
      {showTooltip && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 4,
          padding: '3px 8px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          fontSize: 10,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {tooltip}
        </span>
      )}
    </span>
  );
}
