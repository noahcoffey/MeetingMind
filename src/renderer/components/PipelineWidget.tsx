import React from 'react';

export interface BackgroundJob {
  recordingId: string;
  title: string;
  stage: 'transcribing' | 'generating-notes' | 'complete' | 'error';
  message: string;
}

interface PipelineWidgetProps {
  jobs: BackgroundJob[];
  onViewRecording: (recordingId: string) => void;
  onDismiss: (recordingId: string) => void;
}

export default function PipelineWidget({ jobs, onViewRecording, onDismiss }: PipelineWidgetProps) {
  if (jobs.length === 0) return null;

  return (
    <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {jobs.map(job => (
        <div
          key={job.recordingId}
          style={{
            padding: '10px 12px',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius)',
            marginBottom: jobs.length > 1 ? 6 : 0,
            fontSize: 12,
          }}
        >
          {/* Title */}
          <div style={{
            fontWeight: 600,
            fontSize: 11,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 4,
          }}>
            {job.title || 'Untitled Recording'}
          </div>

          {/* Status row */}
          {job.stage === 'complete' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ color: 'var(--accent-green)', fontWeight: 500, flex: 1 }}>Notes ready</span>
              <button
                onClick={() => onViewRecording(job.recordingId)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-blue)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '0 2px',
                }}
              >
                View
              </button>
              <button
                onClick={() => onDismiss(job.recordingId)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
          ) : job.stage === 'error' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <span style={{ color: 'var(--accent-primary)', flex: 1 }}>{job.message}</span>
              <button
                onClick={() => onDismiss(job.recordingId)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <div style={{
                  width: 10,
                  height: 10,
                  border: '2px solid var(--border-light)',
                  borderTopColor: 'var(--accent-blue)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>
                  {job.stage === 'transcribing' ? 'Transcribing...' : 'Generating notes...'}
                </span>
              </div>
              {/* Mini progress bar */}
              <div style={{
                marginTop: 6,
                height: 3,
                background: 'var(--bg-input)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div className="progress-bar-indeterminate" />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
