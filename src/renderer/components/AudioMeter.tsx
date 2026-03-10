import React from 'react';

interface AudioMeterProps {
  level: number; // 0-1
  active: boolean;
}

const BAR_COUNT = 20;

export default function AudioMeter({ level, active }: AudioMeterProps) {
  if (!active) return null;

  return (
    <div className="audio-meter">
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const barLevel = (i + 1) / BAR_COUNT;
        const isActive = level >= barLevel;
        const height = 4 + (i / BAR_COUNT) * 32;

        return (
          <div
            key={i}
            className="audio-meter-bar"
            style={{
              height: isActive ? height : 2,
              background: isActive
                ? barLevel > 0.8
                  ? 'var(--accent-primary)'
                  : barLevel > 0.6
                    ? 'var(--accent-yellow)'
                    : 'var(--accent-green)'
                : 'var(--border-color)',
            }}
          />
        );
      })}
    </div>
  );
}
