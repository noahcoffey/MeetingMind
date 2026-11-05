import React from 'react';
import type { Recording, Project } from '../../types';
import TagEditor from '../../components/TagEditor';
import { formatDuration, formatFileSize, getStatusLabel } from './format';
import ImportedBadge from './ImportedBadge';

interface MeetingDetailHeaderProps {
  selectedMeeting: Recording;
  setSelectedMeeting: (rec: Recording | null) => void;
  isEditingTitle: boolean;
  setIsEditingTitle: (editing: boolean) => void;
  editTitle: string;
  setEditTitle: (title: string) => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  startEditingTitle: () => void;
  saveTitle: () => void;
  showCostData: boolean;
  isTranscribing: boolean;
  isStreaming: boolean;
  notesContent: string;
  handleTranscribe: (opts?: { forceNormalize?: boolean }) => void;
  handleGenerateNotes: () => void;
  actionsMenuRef: React.RefObject<HTMLDivElement | null>;
  showActionsMenu: boolean;
  setShowActionsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingConfirm: (confirm: 'regenerate' | 'retranscribe' | null) => void;
  setShowDeleteConfirm: (show: boolean) => void;
  handleSaveNotes: () => void;
  handleSaveToObsidian: () => void;
  handleSendToMeetingHub: () => void;
  meetinghubVisible: boolean;
  handleSendToClubTools: () => void;
  clubtoolsVisible: boolean;
  showToast: (msg: string) => void;
  refreshSelectedMeeting: () => void;
  loadMeetings: () => void;
  notebooks?: string[];
  defaultNotebook: string;
  activeNotebook?: string;
  projects: Project[];
  allTags: string[];
  handleTagsChange: (tags: string[]) => void;
}

/** The compact card above a meeting: title editing, status, primary action, the actions menu, and tags. */
export default function MeetingDetailHeader({
  selectedMeeting,
  setSelectedMeeting,
  isEditingTitle,
  setIsEditingTitle,
  editTitle,
  setEditTitle,
  titleInputRef,
  startEditingTitle,
  saveTitle,
  showCostData,
  isTranscribing,
  isStreaming,
  notesContent,
  handleTranscribe,
  handleGenerateNotes,
  actionsMenuRef,
  showActionsMenu,
  setShowActionsMenu,
  setPendingConfirm,
  setShowDeleteConfirm,
  handleSaveNotes,
  handleSaveToObsidian,
  handleSendToMeetingHub,
  meetinghubVisible,
  handleSendToClubTools,
  clubtoolsVisible,
  showToast,
  refreshSelectedMeeting,
  loadMeetings,
  notebooks,
  defaultNotebook,
  activeNotebook,
  projects,
  allTags,
  handleTagsChange,
}: MeetingDetailHeaderProps) {
  return (
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
            {selectedMeeting.source === 'import' && <ImportedBadge />}
            {selectedMeeting.audioNormalization && (
              <span
                title={`Audio normalized (${selectedMeeting.audioNormalization.method})${
                  selectedMeeting.audioNormalization.appliedGainDb != null
                    ? ` — +${selectedMeeting.audioNormalization.appliedGainDb.toFixed(1)} dB`
                    : ''
                }. Before: mean ${selectedMeeting.audioNormalization.beforeLevel?.meanVolume?.toFixed(1)} dB, max ${selectedMeeting.audioNormalization.beforeLevel?.maxVolume?.toFixed(1)} dB.`}
                style={{
                  marginLeft: 6,
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 500,
                  background: 'var(--accent-blue-tint, rgba(59,130,246,0.15))',
                  color: 'var(--accent-blue)',
                  border: '1px solid var(--accent-blue)',
                  cursor: 'help',
                }}
              >
                Normalized
              </span>
            )}
          </div>
        </div>

        {/* Primary action (pipeline step) */}
        {selectedMeeting.status === 'recorded' && (
          <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => handleTranscribe()} disabled={isTranscribing}>
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
              {(selectedMeeting.status === 'transcribed' || selectedMeeting.status === 'complete') && !selectedMeeting.audioRemovedAt && (
                <>
                  <button
                    className="actions-dropdown-item"
                    onClick={() => { setShowActionsMenu(false); setPendingConfirm('retranscribe'); }}
                    disabled={isTranscribing}
                  >
                    Re-transcribe
                  </button>
                  <div className="actions-dropdown-sep" />
                </>
              )}
              {selectedMeeting.status === 'complete' && (
                <>
                  <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSaveNotes(); }}>
                    Save Notes
                  </button>
                  <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSaveToObsidian(); }}>
                    Save to Obsidian
                  </button>
                  {meetinghubVisible && (
                    <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSendToMeetingHub(); }}>
                      {(selectedMeeting as any).meetinghub?.status === 'sent' ? 'Re-send to MeetingHub' : 'Send to MeetingHub'}
                    </button>
                  )}
                  {clubtoolsVisible && (
                    <button className="actions-dropdown-item" onClick={() => { setShowActionsMenu(false); handleSendToClubTools(); }}>
                      {selectedMeeting.clubtools?.status === 'sent' ? 'Re-send to Club Tools' : 'Send to Club Tools'}
                    </button>
                  )}
                  <button className="actions-dropdown-item" onClick={() => {
                    setShowActionsMenu(false);
                    // Only ask when there are notes to lose.
                    if (notesContent.trim()) setPendingConfirm('regenerate');
                    else handleGenerateNotes();
                  }} disabled={isStreaming}>
                    Regenerate Notes
                  </button>
                  <button className="actions-dropdown-item" onClick={async () => {
                    setShowActionsMenu(false);
                    showToast('Analyzing sentiment...');
                    const r = await (window.meetingMind as any).analyzeSentiment(selectedMeeting.id);
                    if (r.success) {
                      showToast(`Sentiment: ${r.sentiment.label}`);
                      refreshSelectedMeeting();
                    } else {
                      showToast(`Sentiment analysis failed: ${r.error}`);
                    }
                  }}>
                    {(selectedMeeting as any).sentiment ? 'Regenerate Sentiment' : 'Analyze Sentiment'}
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
              <button className="actions-dropdown-item" onClick={async () => { setShowActionsMenu(false); const r = await (window.meetingMind as any).copyTranscriptToClipboard(selectedMeeting.id); showToast(r.success ? 'Transcript copied to clipboard' : `Copy failed: ${r.error}`); }}>
                Copy Transcript (with names)
              </button>
              <button className="actions-dropdown-item" onClick={async () => { setShowActionsMenu(false); const r = await (window.meetingMind as any).exportTranscript(selectedMeeting.id); if (r.success) showToast(`Transcript saved: ${r.path}`); else if (!r.canceled) showToast(`Export failed: ${r.error}`); }}>
                Export Transcript&hellip;
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
              {projects.length > 0 && (
                <>
                  <div className="actions-dropdown-sep" />
                  <div style={{ padding: '4px 12px 2px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Move to Project
                  </div>
                  {(selectedMeeting as any).project && (
                    <button
                      className="actions-dropdown-item"
                      onClick={async () => {
                        setShowActionsMenu(false);
                        await (window.meetingMind as any).moveToProject(selectedMeeting.id, null);
                        loadMeetings();
                        showToast('Removed from project');
                      }}
                    >
                      Remove from Project
                    </button>
                  )}
                  {projects
                    .filter(p => p.notebook === activeNotebook && p.id !== (selectedMeeting as any).project)
                    .map(p => (
                      <button
                        key={p.id}
                        className="actions-dropdown-item"
                        onClick={async () => {
                          setShowActionsMenu(false);
                          await (window.meetingMind as any).moveToProject(selectedMeeting.id, p.id);
                          loadMeetings();
                          showToast(`Moved to ${p.name}`);
                        }}
                      >
                        {p.name}
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
      {/* Row 2: tags + sentiment */}
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TagEditor
          tags={selectedMeeting.tags || []}
          allTags={allTags}
          onChange={handleTagsChange}
        />
        {(selectedMeeting as any).sentiment?.label && (() => {
          const sentimentColors: Record<string, string> = {
            'Collaborative': 'var(--accent-blue)',
            'Productive': 'var(--accent-green)',
            'Tense': '#e67e22',
            'Contentious': '#e74c3c',
            'Casual': '#1abc9c',
            'Informational': 'var(--text-muted)',
            'Brainstorming': '#9b59b6',
            'Decision-focused': '#5b6abf',
            'Celebratory': '#f1c40f',
            'Neutral': 'var(--text-muted)',
          };
          const label = (selectedMeeting as any).sentiment.label;
          const color = sentimentColors[label] || 'var(--text-muted)';
          return (
            <span
              title={(selectedMeeting as any).sentiment.explanation}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 500,
                color,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                cursor: 'default',
              }}
            >
              {label}
            </span>
          );
        })()}
        {meetinghubVisible && (selectedMeeting as any).meetinghub?.status && (() => {
          const mh = (selectedMeeting as any).meetinghub;
          const colors: Record<string, string> = {
            sent: 'var(--accent-green)',
            pending: '#e67e22',
            skipped: 'var(--text-muted)',
            error: '#e74c3c',
          };
          const labels: Record<string, string> = {
            sent: 'MeetingHub ✓',
            pending: 'MeetingHub: review',
            skipped: 'MeetingHub: skipped',
            error: 'MeetingHub: failed',
          };
          const color = colors[mh.status] || 'var(--text-muted)';
          return (
            <span
              title={mh.detail || ''}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 500,
                color,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                cursor: 'default',
              }}
            >
              {labels[mh.status] || mh.status}
            </span>
          );
        })()}
        {clubtoolsVisible && selectedMeeting.clubtools?.status && (() => {
          const ct = selectedMeeting.clubtools;
          const colors: Record<string, string> = {
            sent: '#e67e22',
            accepted: 'var(--accent-green)',
            dismissed: 'var(--text-muted)',
            error: '#e74c3c',
          };
          const labels: Record<string, string> = {
            sent: 'Club Tools: in inbox',
            accepted: 'Club Tools ✓',
            dismissed: 'Club Tools: dismissed',
            error: 'Club Tools: failed',
          };
          const color = colors[ct.status] || 'var(--text-muted)';
          return (
            <span
              title={ct.detail || ''}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 500,
                color,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                cursor: 'default',
              }}
            >
              {labels[ct.status] || ct.status}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
