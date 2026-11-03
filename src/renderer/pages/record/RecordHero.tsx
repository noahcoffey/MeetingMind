import React from 'react';

interface RecordHeroProps {
  isProcessing: boolean;
  onRecord: () => void;
  onImport: () => void;
}

/** The big Record button and "Import a recording" on the idle page. */
export default function RecordHero({ isProcessing, onRecord, onImport }: RecordHeroProps) {
  return (
    <div className="rp-record-hero">
      <div className="rp-hero-label">Ready to Record</div>
      <button
        className="record-button"
        onClick={onRecord}
        disabled={isProcessing}
        title="Start Recording"
      >
        <div className="record-inner" />
      </button>
      <button
        className="btn btn-secondary"
        onClick={onImport}
        disabled={isProcessing}
        title="Import an audio file recorded somewhere else"
        style={{ fontSize: 12, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        Import a recording
      </button>
    </div>
  );
}
