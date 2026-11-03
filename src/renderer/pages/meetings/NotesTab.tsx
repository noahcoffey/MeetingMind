import type { Recording } from '../../types';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { DetailTab } from './types';
import ErrorCard from './ErrorCard';

interface NotesTabProps {
  selectedMeeting: Recording;
  notesContent: string;
  notesError: string | null;
  setNotesError: (error: string | null) => void;
  isStreaming: boolean;
  isLoadingNotes: boolean;
  handleGenerateNotes: () => void;
  handleNotesCorrection: (data: { original: string; corrected: string }) => void;
  setDetailTab: (tab: DetailTab) => void;
}

/** The Notes tab body: the generation error, the speaker-gate prompt, and the notes themselves. */
export default function NotesTab({
  selectedMeeting,
  notesContent,
  notesError,
  setNotesError,
  isStreaming,
  isLoadingNotes,
  handleGenerateNotes,
  handleNotesCorrection,
  setDetailTab,
}: NotesTabProps) {
  return (
    <>
      {/* Notes error */}
      {notesError && (
        <ErrorCard
          title="Notes Generation Failed"
          error={notesError}
          onRetry={handleGenerateNotes}
          onDismiss={() => setNotesError(null)}
        />
      )}

      {/* Parked behind the speaker gate */}
      {!notesError && !isStreaming && !isLoadingNotes && !notesContent
        && selectedMeeting.status === 'transcribed' && selectedMeeting.awaitingSpeakerReview && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Notes are waiting on speaker names</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Name the speakers so action items land on the right people, then generate.
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => setDetailTab('speakers')}>Name speakers</button>
          <button className="btn btn-primary" onClick={handleGenerateNotes} disabled={isStreaming}>Generate anyway</button>
        </div>
      )}

      {/* Notes tab */}
      {!notesError && (isStreaming || isLoadingNotes || notesContent || selectedMeeting.status === 'complete') && (
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
    </>
  );
}
