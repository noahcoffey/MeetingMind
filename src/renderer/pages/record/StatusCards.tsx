import React from 'react';
import { formatDuration, formatFileSize } from './format';

interface ProcessingCardProps {
  stage: string;
  pipelineMessage: string;
}

/** Spinner while a recording is stopping, merging or importing. */
export function ProcessingCard({ stage, pipelineMessage }: ProcessingCardProps) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rp-status-card">
        <div className="rp-spinner" />
        <div className="rp-status-title">
          {stage === 'stopping' ? 'Stopping...' : 'Processing Audio'}
        </div>
        <div className="rp-status-msg">{pipelineMessage}</div>
      </div>
    </div>
  );
}

interface CompleteCardProps {
  pipelineMessage: string;
  recordingResult: { duration: number; fileSize: number } | null;
  onViewRecording: () => void;
  onReset: () => void;
}

/** The "Recording saved!" card once a recording has landed on disk. */
export function CompleteCard({ pipelineMessage, recordingResult, onViewRecording, onReset }: CompleteCardProps) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rp-status-card">
        <svg className="rp-complete-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <div className="rp-status-title">{pipelineMessage}</div>
        {recordingResult && (
          <div className="rp-complete-meta">
            {formatDuration(recordingResult.duration)} &middot; {formatFileSize(recordingResult.fileSize)}
          </div>
        )}
        <div className="rp-complete-actions">
          <button className="btn btn-primary" onClick={onViewRecording}>
            View Meeting
          </button>
          <button className="btn btn-secondary" onClick={onReset}>
            New Meeting
          </button>
        </div>
      </div>
    </div>
  );
}
