import React from 'react';

export default function ErrorCard({ title, error, onRetry, onDismiss, secondaryAction }: {
  title: string;
  error: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  secondaryAction?: { label: string; onClick: () => void };
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(`${title}\n\n${error}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card" style={{
      border: '1px solid var(--accent-primary)',
      background: 'var(--accent-red-tint)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 4 }}>{title}</div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            overflow: 'hidden',
            maxHeight: expanded ? 'none' : '2.8em',
          }}>
            {error}
          </div>
          {error.length > 120 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: 'none', border: 'none', color: 'var(--accent-blue)',
                cursor: 'pointer', fontSize: 11, padding: '4px 0 0',
              }}
            >
              {expanded ? 'Show less' : 'Show full error'}
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '0 2px', fontSize: 16, lineHeight: 1, flexShrink: 0,
            }}
          >&times;</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {onRetry && (
          <button className="btn btn-secondary" onClick={onRetry} style={{ fontSize: 12, padding: '4px 12px' }}>
            Retry
          </button>
        )}
        {secondaryAction && (
          <button className="btn btn-secondary" onClick={secondaryAction.onClick} style={{ fontSize: 12, padding: '4px 12px' }}>
            {secondaryAction.label}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={handleCopy}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          {copied ? 'Copied!' : 'Copy Error'}
        </button>
      </div>
    </div>
  );
}
