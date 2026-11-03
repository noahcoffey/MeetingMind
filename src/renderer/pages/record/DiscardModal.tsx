import React from 'react';
import { formatDuration } from './format';

interface DiscardModalProps {
  duration: number;
  chunkCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Discard Meeting?" — confirms throwing away the running recording. */
export default function DiscardModal({ duration, chunkCount, onCancel, onConfirm }: DiscardModalProps) {
  return (
    <div className="rp-modal-backdrop" onClick={onCancel}>
      <div className="rp-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div className="rp-modal-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <div className="rp-modal-title">Discard Meeting?</div>
            <div className="rp-modal-desc">
              This will stop the recording and permanently delete all captured audio. This cannot be undone.
            </div>
          </div>
        </div>

        {duration > 0 && (
          <div className="rp-modal-detail">
            You will lose <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(duration)}</strong> of recorded audio
            {chunkCount > 0 && <span> ({chunkCount} chunk{chunkCount !== 1 ? 's' : ''})</span>}.
          </div>
        )}

        <div className="rp-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Keep Recording Data
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
