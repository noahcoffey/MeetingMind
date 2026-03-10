import React, { useState, useEffect, useRef } from 'react';
import type { Recording } from '../types';

interface RecordingsPageProps {
  initialRecordingId?: string | null;
}

export default function RecordingsPage({ initialRecordingId }: RecordingsPageProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [notesContent, setNotesContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadRecordings();

    // Listen for transcription progress
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

  // Auto-select recording if navigated from RecordPage
  useEffect(() => {
    if (initialRecordingId && recordings.length > 0) {
      const rec = recordings.find(r => r.id === initialRecordingId);
      if (rec) {
        selectRecording(rec);
      }
    }
  }, [initialRecordingId, recordings]);

  async function loadRecordings() {
    try {
      const list = await window.meetingMind.getRecordings();
      setRecordings(list);
    } catch {
      console.error('Failed to load recordings');
    }
  }

  async function refreshSelectedRecording() {
    if (!selectedRecording) return;
    const updated = await window.meetingMind.getRecording(selectedRecording.id);
    if (updated) {
      setSelectedRecording(updated);
      // Also refresh list
      loadRecordings();
    }
  }

  async function selectRecording(rec: Recording) {
    setSelectedRecording(rec);
    setNotesContent('');
    setTranscriptText('');
    setTranscriptionStatus('');
    setIsStreaming(false);
    setIsLoadingNotes(false);

    // Refresh recording data
    const freshRec = await window.meetingMind.getRecording(rec.id);
    if (freshRec) {
      setSelectedRecording(freshRec);

      // Load saved notes if recording is complete
      if (freshRec.status === 'complete') {
        const notes = await window.meetingMind.getNotes(freshRec.id);
        if (notes) {
          setNotesContent(notes);
        }
      }
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
    // Progress updates come via IPC events
  }

  async function handleGenerateNotes() {
    if (!selectedRecording) return;
    setNotesContent('');
    setIsStreaming(true);
    setIsLoadingNotes(true);

    // Clean up old listeners
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
    if (result.success) {
      showToast(`Saved to ${result.path}`);
    } else {
      showToast(`Save failed: ${result.error}`);
    }
  }

  async function handleSaveToObsidian() {
    if (!selectedRecording) return;
    const dateStr = new Date(selectedRecording.date).toISOString().slice(0, 10);
    const title = selectedRecording.title || 'Untitled Meeting';
    const filename = `${dateStr} - ${title}.md`;

    const result = await window.meetingMind.saveToObsidian(selectedRecording.id, filename);
    if (result.success) {
      showToast('Saved to Obsidian vault!');
    } else {
      showToast(`Save failed: ${result.error}`);
    }
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

  return (
    <>
      <div className="page-header">
        <h1>Recordings</h1>
      </div>
      <div className="page-content" style={{ display: 'flex', gap: 20, height: 'calc(100vh - 112px)' }}>
        {/* List */}
        <div style={{ flex: '0 0 340px', overflowY: 'auto' }}>
          <div style={{ marginBottom: 8 }}>
            <button className="btn btn-ghost" onClick={loadRecordings} style={{ fontSize: 12, padding: '4px 8px' }}>
              Refresh
            </button>
          </div>
          <div className="recording-list">
            {recordings.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                No recordings yet. Start a recording to get started.
              </div>
            )}
            {recordings.map(rec => (
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
                </div>
                <span className={`status-badge ${rec.status}`}>{getStatusLabel(rec.status)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {!selectedRecording ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              Select a recording to view details
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Header card */}
              <div className="card">
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>
                  {selectedRecording.title || 'Untitled Recording'}
                </h2>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  {new Date(selectedRecording.date).toLocaleString()} &middot;{' '}
                  {formatDuration(selectedRecording.duration)} &middot;{' '}
                  {formatFileSize(selectedRecording.fileSize)}
                  <span className={`status-badge ${selectedRecording.status}`} style={{ marginLeft: 12 }}>
                    {getStatusLabel(selectedRecording.status)}
                  </span>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedRecording.status === 'recorded' && (
                    <button
                      className="btn btn-primary"
                      onClick={handleTranscribe}
                      disabled={isTranscribing}
                    >
                      {isTranscribing ? 'Transcribing...' : 'Transcribe'}
                    </button>
                  )}
                  {selectedRecording.status === 'transcribed' && (
                    <button
                      className="btn btn-primary"
                      onClick={handleGenerateNotes}
                      disabled={isStreaming}
                    >
                      {isStreaming ? 'Generating...' : 'Generate Notes'}
                    </button>
                  )}
                  {selectedRecording.status === 'complete' && (
                    <>
                      <button className="btn btn-primary" onClick={handleSaveNotes}>
                        Save Notes
                      </button>
                      <button className="btn btn-secondary" onClick={handleSaveToObsidian}>
                        Save to Obsidian
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={handleGenerateNotes}
                        disabled={isStreaming}
                      >
                        Regenerate
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost"
                    onClick={() => window.meetingMind.openInFinder(selectedRecording.audioPath)}
                  >
                    Open in Finder
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleDeleteRecording}
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

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
                  <button className="btn btn-secondary" onClick={handleTranscribe} style={{ marginTop: 8 }}>
                    Retry
                  </button>
                </div>
              )}

              {/* Notes — streaming or completed */}
              {(isStreaming || isLoadingNotes || notesContent || selectedRecording.status === 'complete') && (
                <div className="card">
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
                    <div className="markdown-content" style={{
                      background: 'var(--bg-input)',
                      padding: 16,
                      borderRadius: 'var(--radius)',
                      maxHeight: 500,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {notesContent || 'Notes will appear here after generation.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toastMessage && (
        <div className="toast">{toastMessage}</div>
      )}
    </>
  );
}
