import React from 'react';

interface AudioPlayerProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onRateChange: (rate: number) => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function AudioPlayer({
  isPlaying, currentTime, duration, playbackRate,
  onToggle, onSeek, onRateChange,
}: AudioPlayerProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function handleSeekBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 16px',
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
      flexShrink: 0,
    }}>
      {/* Play/Pause */}
      <button
        onClick={onToggle}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          padding: 4,
          display: 'flex',
          flexShrink: 0,
        }}
      >
        {isPlaying ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Time */}
      <span style={{
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-secondary)',
        minWidth: 40,
        flexShrink: 0,
      }}>
        {formatTime(currentTime)}
      </span>

      {/* Seek Bar */}
      <div
        onClick={handleSeekBarClick}
        style={{
          flex: 1,
          height: 6,
          background: 'var(--border-color)',
          borderRadius: 3,
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--accent-blue)',
          borderRadius: 3,
          transition: 'width 50ms linear',
        }} />
        <div style={{
          position: 'absolute',
          top: -4,
          left: `${progress}%`,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--accent-blue)',
          transform: 'translateX(-50%)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>

      {/* Duration */}
      <span style={{
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-muted)',
        minWidth: 40,
        flexShrink: 0,
      }}>
        {formatTime(duration)}
      </span>

      {/* Playback Rate */}
      <select
        value={playbackRate}
        onChange={e => onRateChange(parseFloat(e.target.value))}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          color: 'var(--text-secondary)',
          fontSize: 11,
          padding: '2px 4px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {RATES.map(r => (
          <option key={r} value={r}>{r}x</option>
        ))}
      </select>
    </div>
  );
}
