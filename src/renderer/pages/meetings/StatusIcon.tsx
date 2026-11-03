import React from 'react';

export default function StatusIcon({ ready, activeColor, tooltip, children }: {
  ready: boolean;
  activeColor: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        color: ready ? activeColor : 'var(--text-muted)',
        opacity: ready ? 1 : 0.25,
        cursor: 'default',
      }}
    >
      {children}
      {showTooltip && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 4,
          padding: '3px 8px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          fontSize: 10,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {tooltip}
        </span>
      )}
    </span>
  );
}
