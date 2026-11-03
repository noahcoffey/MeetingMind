import React from 'react';
import { formatDuration } from './format';

interface LiveRecordingBarProps {
  isPaused: boolean;
  duration: number;
  waveformContainerRef: React.RefObject<HTMLDivElement | null>;
  waveformCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onPauseResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

/** Waveform, timer and Pause / Stop / Discard while a recording runs. */
export default function LiveRecordingBar({ isPaused, duration, waveformContainerRef, waveformCanvasRef, onPauseResume, onStop, onDiscard }: LiveRecordingBarProps) {
  return (
    <div className="rp-recording-bar" style={{ paddingTop: 'var(--titlebar-height)' }}>
      <div className="rp-waveform-section">
        <div className={`rp-rec-indicator ${isPaused ? 'paused' : 'active'}`} />

        <div className="rp-waveform-wrap" ref={waveformContainerRef}>
          <canvas
            ref={waveformCanvasRef}
            height={80 * (window.devicePixelRatio || 1)}
          />
        </div>

        <div className={`rp-timer ${isPaused ? 'paused' : ''}`}>
          {formatDuration(duration)}
        </div>
      </div>

      <div className="rp-controls">
        <button
          className="rp-ctrl-btn pause"
          onClick={onPauseResume}
          title={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button
          className="rp-ctrl-btn stop"
          onClick={onStop}
          title="Stop Recording"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
          Stop
        </button>

        <button
          className="rp-ctrl-btn discard"
          onClick={onDiscard}
          title="Discard"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {isPaused && (
        <div className="rp-paused-banner">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
          Recording paused
        </div>
      )}
    </div>
  );
}
