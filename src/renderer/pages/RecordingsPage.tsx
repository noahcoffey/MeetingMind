import React, { useState, useEffect, useRef } from 'react';
import type { Recording } from '../types';
import TagEditor from '../components/TagEditor';
import ExportMenu from '../components/ExportMenu';
import TranscriptViewer from '../components/TranscriptViewer';
import AudioPlayer from '../components/AudioPlayer';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import MarkdownRenderer from '../components/MarkdownRenderer';

interface RecordingsPageProps {
  initialRecordingId?: string | null;
}

type DetailTab = 'notes' | 'transcript';

export default function RecordingsPage({ initialRecordingId }: RecordingsPageProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
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
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [audioState, audioControls] = useAudioPlayer();

  useEffect(() => {
    loadRecordings();
    loadAllTags();

    const unsubProgress = window.meetingMind.on('transcription:progress', (data: unknown) => {
      const { status, message } = data as { status: string; message: string };
      setTranscriptionStatus(message);
      if (status === 'complete') {
        setIsTranscribing(false);
        setTranscriptionStatus('');
        refreshSelectedRecording();
        loadRecordings();
      } else if (status === 'error') {
        setIsTranscribing(false);
        setTranscriptionStatus(`Error: ${message}`);
      }
    });

    return () => {
      unsubProgress();
      window.meetingMind.removeAllListeners('notes:stream');
      window.meetingMind.removeAllListeners('notes:complete');
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  useEffect(() => {
    if (initialRecordingId && recordings.length > 0) {
      const rec = recordings.find(r => r.id === initialRecordingId);
      if (rec) selectRecording(rec);
    }
  }, [initialRecordingId, recordings]);

  async function loadRecordings() {
    try {
      const list = await window.meetingMind.getRecordings();
      setRecordings(list);
    } catch {}
  }

  async function loadAllTags() {
    try {
      const tags = await window.meetingMind.getAllTags();
      setAllTags(tags);
    } catch {}
  }

  async function refreshSelectedRecording() {
    if (!selectedRecording) return;
    const updated = await window.meetingMind.getRecording(selectedRecording.id);
    if (updated) {
      setSelectedRecording(updated);
      loadRecordings();
      loadAllTags();
    }
  }

  async function selectRecording(rec: Recording) {
    setSelectedRecording(rec);
    setNotesContent('');
    setUtterances([]);
    setTranscriptionStatus('');
    setIsStreaming(false);
    setIsLoadingNotes(false);
    setDetailTab('notes');

    const freshRec = await window.meetingMind.getRecording(rec.id);
    if (freshRec) {
      setSelectedRecording(freshRec);

      if (freshRec.status === 'complete' || freshRec.status === 'transcribed') {
        const notes = await window.meetingMind.getNotes(freshRec.id);
        if (notes) setNotesContent(notes);
      }

      // Load transcript data
      if (freshRec.status === 'transcribed' || freshRec.status === 'complete' || freshRec.status === 'generating') {
        const transcriptData = await window.meetingMind.getTranscript(freshRec.id);
        setUtterances(transcriptData || []);
      }

      // Load audio for the player
      if (freshRec.audioPath) {
        audioControls.load(`media://${freshRec.audioPath}`);
      }
    }
  }

  async function loadTranscript() {
    if (!selectedRecording) return;
    try {
      const data = await window.meetingMind.getTranscript(selectedRecording.id);
      setUtterances(data || []);
    } catch {
      setUtterances([]);
    }
  }

  async function handleTranscribe() {
    if (!selectedRecording) return;
    setIsTranscribing(true);
    setTranscriptionStatus('Starting transcription...');
    const result = await window.meetingMind.startTranscription(selectedRecording.id);
    if (!result.success) {
      setIsTranscribing(false);
      setTranscriptionStatus(`Failed: ${result.error}`);
    }
  }

  async function handleGenerateNotes() {
    if (!selectedRecording) return;
    setNotesContent('');
    setIsStreaming(true);
    setIsLoadingNotes(true);

    window.meetingMind.removeAllListeners('notes:stream');
    window.meetingMind.removeAllListeners('notes:complete');

    window.meetingMind.on('notes:stream', (chunk: unknown) => {
      setIsLoadingNotes(false);
      setNotesContent(prev => prev + (chunk as string));
    });

    window.meetingMind.on('notes:complete', () => {
      setIsStreaming(false);
      setIsLoadingNotes(false);
      refreshSelectedRecording();
      loadRecordings();
    });

    const result = await window.meetingMind.generateNotes(selectedRecording.id);
    if (!result.success) {
      setIsStreaming(false);
      setIsLoadingNotes(false);
      showToast(`Notes generation failed: ${result.error}`);
    }
  }

  async function handleSaveNotes() {
    if (!selectedRecording) return;
    const dateStr = new Date(selectedRecording.date).toISOString().slice(0, 10);
    const title = selectedRecording.title || 'Untitled Meeting';
    const filename = `${dateStr} - ${title}.md`;
    const result = await window.meetingMind.saveNotes(selectedRecording.id, filename);
    if (result.success) showToast(`Saved to ${result.path}`);
    else showToast(`Save failed: ${result.error}`);
  }

  async function handleSaveToObsidian() {
    if (!selectedRecording) return;
    const dateStr = new Date(selectedRecording.date).toISOString().slice(0, 10);
    const title = selectedRecording.title || 'Untitled Meeting';
    const filename = `${dateStr} - ${title}.md`;
    const result = await window.meetingMind.saveToObsidian(selectedRecording.id, filename);
    if (result.success) showToast('Saved to Obsidian vault!');
    else showToast(`Save failed: ${result.error}`);
  }

  async function handleDeleteRecording() {
    if (!selectedRecording) return;
    const result = await window.meetingMind.deleteRecording(selectedRecording.id);
    if (result.success) {
      setSelectedRecording(null);
      loadRecordings();
      showToast('Recording deleted');
    }
  }

  async function handleTagsChange(tags: string[]) {
    if (!selectedRecording) return;
    await window.meetingMind.setRecordingTags(selectedRecording.id, tags);
    setSelectedRecording({ ...selectedRecording, tags });
    loadRecordings();
    loadAllTags();
  }

  async function handleRenameSpeaker(oldName: string, newName: string) {
    if (!selectedRecording) return;
    await window.meetingMind.renameSpeaker(selectedRecording.id, oldName, newName);
    refreshSelectedRecording();
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

  // Filter recordings by tag
  const filteredRecordings = filterTag
    ? recordings.filter(r => r.tags?.includes(filterTag))
    : recordings;

  return (
    <>
      <div className="page-header">
        <h1>Recordings</h1>
      </div>
      <div className="page-content" style={{ display: 'flex', gap: 20, height: 'calc(100vh - 112px)' }}>
        {/* List */}
        <div style={{ flex: '0 0 340px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button className="btn btn-ghost" onClick={loadRecordings} style={{ fontSize: 12, padding: '4px 8px' }}>
              Refresh
            </button>

            {/* Tag filter dropdown */}
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
                  padding: '4px 8px',
                }}
              >
                <option value="">All tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          <div className="recording-list">
            {filteredRecordings.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {filterTag ? 'No recordings with this tag.' : 'No recordings yet. Start a recording to get started.'}
              </div>
            )}
            {filteredRecordings.map(rec => (
              <div
                key={rec.id}
                className="recording-item"
                onClick={() => selectRecording(rec)}
                style={{
                  borderColor: selectedRecording?.id === rec.id ? 'var(--accent-blue)' : undefined,
                }}
              >
                <div className="recording-item-info">
                  <div className="recording-item-title">{rec.title || 'Untitled Recording'}</div>
                  <div className="recording-item-meta">
                    {new Date(rec.date).toLocaleDateString()} &middot; {formatDuration(rec.duration)} &middot; {formatFileSize(rec.fileSize)}
                  </div>
                  {rec.tags && rec.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                      {rec.tags.map(t => (
                        <span key={t} style={{
                          padding: '1px 6px',
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: 'var(--accent-blue)',
                          borderRadius: 8,
                          fontSize: 10,
                        }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`status-badge ${rec.status}`}>{getStatusLabel(rec.status)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!selectedRecording ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              Select a recording to view details
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              {/* Header card */}
              <div className="card">
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>
                  {selectedRecording.title || 'Untitled Recording'}
                </h2>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {new Date(selectedRecording.date).toLocaleString()} &middot;{' '}
                  {formatDuration(selectedRecording.duration)} &middot;{' '}
                  {formatFileSize(selectedRecording.fileSize)}
                  <span className={`status-badge ${selectedRecording.status}`} style={{ marginLeft: 12 }}>
                    {getStatusLabel(selectedRecording.status)}
                  </span>
                </div>

                {/* Tags */}
                <div style={{ marginBottom: 12 }}>
                  <TagEditor
                    tags={selectedRecording.tags || []}
                    allTags={allTags}
                    onChange={handleTagsChange}
                  />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedRecording.status === 'recorded' && (
                    <button className="btn btn-primary" onClick={handleTranscribe} disabled={isTranscribing}>
                      {isTranscribing ? 'Transcribing...' : 'Transcribe'}
                    </button>
                  )}
                  {selectedRecording.status === 'transcribed' && (
                    <button className="btn btn-primary" onClick={handleGenerateNotes} disabled={isStreaming}>
                      {isStreaming ? 'Generating...' : 'Generate Notes'}
                    </button>
                  )}
                  {selectedRecording.status === 'complete' && (
                    <>
                      <button className="btn btn-primary" onClick={handleSaveNotes}>Save Notes</button>
                      <button className="btn btn-secondary" onClick={handleSaveToObsidian}>Save to Obsidian</button>
                      <ExportMenu recordingId={selectedRecording.id} onToast={showToast} />
                      <button className="btn btn-secondary" onClick={handleGenerateNotes} disabled={isStreaming}>
                        Regenerate
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost" onClick={() => window.meetingMind.openInFinder(selectedRecording.audioPath)}>
                    Open in Finder
                  </button>
                  <button className="btn btn-ghost" onClick={handleDeleteRecording} style={{ color: 'var(--accent-primary)' }}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Audio Player */}
              {selectedRecording.audioPath && (
                <AudioPlayer
                  isPlaying={audioState.isPlaying}
                  currentTime={audioState.currentTime}
                  duration={audioState.duration}
                  playbackRate={audioState.playbackRate}
                  onToggle={audioControls.toggle}
                  onSeek={audioControls.seek}
                  onRateChange={audioControls.setRate}
                />
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
              {!isTranscribing && transcriptionStatus && transcriptionStatus.startsWith('Error') && (
                <div className="card" style={{ borderColor: 'rgba(231, 76, 60, 0.3)' }}>
                  <div style={{ color: 'var(--accent-primary)', fontSize: 13 }}>{transcriptionStatus}</div>
                  <button className="btn btn-secondary" onClick={handleTranscribe} style={{ marginTop: 8 }}>Retry</button>
                </div>
              )}

              {/* Tab bar for Notes / Transcript */}
              {(selectedRecording.status === 'transcribed' || selectedRecording.status === 'complete' || selectedRecording.status === 'generating') && (
                <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)' }}>
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
                </div>
              )}

              {/* Notes tab */}
              {detailTab === 'notes' && (isStreaming || isLoadingNotes || notesContent || selectedRecording.status === 'complete') && (
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
                        <MarkdownRenderer content={notesContent} />
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>Notes will appear here after generation.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Transcript tab */}
              {detailTab === 'transcript' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {utterances.length > 0 ? (
                    <TranscriptViewer
                      utterances={utterances}
                      currentTime={audioState.currentTime}
                      speakerNames={selectedRecording.speakerNames || {}}
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
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  );
}
