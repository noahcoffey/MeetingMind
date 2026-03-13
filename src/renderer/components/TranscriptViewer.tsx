import React, { useEffect, useRef } from 'react';

interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

interface TranscriptViewerProps {
  utterances: Utterance[];
  currentTime: number; // in seconds
  speakerNames: Record<string, string>;
  onSeek: (time: number) => void;
  onRenameSpeaker: (oldName: string, newName: string) => void;
}

const SPEAKER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

function getSpeakerColor(speaker: string, allSpeakers: string[]): string {
  const idx = allSpeakers.indexOf(speaker);
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TranscriptViewer({
  utterances, currentTime, speakerNames, onSeek, onRenameSpeaker,
}: TranscriptViewerProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const allSpeakers = Array.from(new Set(utterances.map(u => u.speaker)));
  const currentTimeMs = currentTime * 1000;

  // Find the currently active utterance
  const activeIndex = utterances.findIndex(
    (u, i) => {
      const next = utterances[i + 1];
      if (currentTimeMs >= u.start && currentTimeMs < u.end) return true;
      if (currentTimeMs >= u.end && next && currentTimeMs < next.start) return true;
      return false;
    }
  );

  // Auto-scroll to active utterance
  useEffect(() => {
    if (autoScrollRef.current && activeRef.current && containerRef.current) {
      const container = containerRef.current;
      const el = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      // Only scroll if the element is outside the visible area
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [activeIndex]);

  // Disable auto-scroll on user scroll, re-enable after 3 seconds
  function handleScroll() {
    autoScrollRef.current = false;
    clearTimeout((handleScroll as any)._timer);
    (handleScroll as any)._timer = setTimeout(() => {
      autoScrollRef.current = true;
    }, 3000);
  }

  function handleSpeakerClick(speaker: string) {
    const displayName = speakerNames[speaker] || speaker;
    const newName = prompt(`Rename "${displayName}" to:`, displayName);
    if (newName && newName !== displayName) {
      onRenameSpeaker(speaker, newName);
    }
  }

  if (utterances.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No transcript data available.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 0',
      }}
    >
      {utterances.map((u, i) => {
        const isActive = i === activeIndex;
        const displayName = speakerNames[u.speaker] || u.speaker;
        const color = getSpeakerColor(u.speaker, allSpeakers);

        // Group consecutive utterances by same speaker — show name only on first
        const prevSpeaker = i > 0 ? utterances[i - 1].speaker : null;
        const showSpeaker = u.speaker !== prevSpeaker;

        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            onClick={() => {
              console.log('Transcript click:', { speaker: u.speaker, startMs: u.start, seekSec: u.start / 1000 });
              onSeek(u.start / 1000);
            }}
            style={{
              padding: '4px 16px',
              paddingTop: showSpeaker ? 12 : 4,
              cursor: 'pointer',
              background: isActive ? 'var(--accent-blue-subtle)' : 'transparent',
              borderLeft: isActive ? `3px solid ${color}` : '3px solid transparent',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = 'var(--bg-card)';
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            {showSpeaker && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  onClick={e => { e.stopPropagation(); handleSpeakerClick(u.speaker); }}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color,
                    cursor: 'pointer',
                  }}
                  title="Click to rename speaker"
                >
                  {displayName}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTimestamp(u.start)}
                </span>
              </div>
            )}
            <div style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              {u.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
