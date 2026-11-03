import type { DetailTab } from './types';

interface DetailTabBarProps {
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;
}

export default function DetailTabBar({ detailTab, setDetailTab }: DetailTabBarProps) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', flexShrink: 0, paddingLeft: 12 }}>
      <button
        onClick={() => setDetailTab('notes')}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          background: 'none',
          border: 'none',
          borderBottom: detailTab === 'notes' ? '2px solid var(--accent-blue)' : '2px solid transparent',
          color: detailTab === 'notes' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        Notes
      </button>
      <button
        onClick={() => setDetailTab('transcript')}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          background: 'none',
          border: 'none',
          borderBottom: detailTab === 'transcript' ? '2px solid var(--accent-blue)' : '2px solid transparent',
          color: detailTab === 'transcript' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        Transcript
      </button>
      <button
        onClick={() => setDetailTab('speakers')}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          background: 'none',
          border: 'none',
          borderBottom: detailTab === 'speakers' ? '2px solid var(--accent-blue)' : '2px solid transparent',
          color: detailTab === 'speakers' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        Speakers
      </button>
      <button
        onClick={() => setDetailTab('ask')}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          background: 'none',
          border: 'none',
          borderBottom: detailTab === 'ask' ? '2px solid var(--accent-blue)' : '2px solid transparent',
          color: detailTab === 'ask' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        Ask
      </button>
    </div>
  );
}
