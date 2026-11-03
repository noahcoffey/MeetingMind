import React from 'react';

interface ProgressBarProps {
  /** 0–100. Leave it out when nothing is known, and the bar just shows activity. */
  value?: number;
  height?: number;
  label?: string;
}

export default function ProgressBar({ value, height = 4, label = 'Progress' }: ProgressBarProps) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const pct = known ? Math.max(0, Math.min(100, value!)) : undefined;
  return (
    <div
      className="progress-track"
      style={{ height }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct !== undefined ? Math.round(pct) : undefined}
    >
      {pct !== undefined
        ? <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        : <div className="progress-bar-indeterminate" />}
    </div>
  );
}
