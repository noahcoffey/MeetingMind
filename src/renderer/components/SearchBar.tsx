import React, { useState, useRef, useCallback, useEffect } from 'react';

interface SearchResult {
  recordingId: string;
  title: string;
  date: string;
  matchType: 'title' | 'tag' | 'notes' | 'transcript';
  snippet: string;
  score: number;
}

interface SearchBarProps {
  onSelectResult: (recordingId: string) => void;
}

export default function SearchBar({ onSelectResult }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      const res = await (window.meetingMind as any).searchRecordings(q);
      setResults(res);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    }
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    setIsOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  function selectResult(result: SearchResult) {
    onSelectResult(result.recordingId);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const matchTypeLabel: Record<string, string> = {
    title: 'Title',
    tag: 'Tag',
    notes: 'Notes',
    transcript: 'Transcript',
  };

  const matchTypeColor: Record<string, string> = {
    title: 'var(--accent-blue)',
    tag: 'var(--accent-green)',
    notes: 'var(--accent-yellow)',
    transcript: 'var(--text-muted)',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', padding: '8px 8px 4px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius)',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim() && results.length) setIsOpen(true); }}
          placeholder="Search..."
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 12,
          }}
        />
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 8,
          right: 8,
          marginTop: 4,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          zIndex: 100,
          maxHeight: 320,
          overflowY: 'auto',
        }}>
          {results.map((r, i) => (
            <div
              key={`${r.recordingId}-${r.matchType}-${i}`}
              onMouseDown={() => selectResult(r)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: i === selectedIndex ? 'var(--bg-input)' : 'transparent',
                borderBottom: i < results.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title || 'Untitled'}
                </span>
                <span style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: matchTypeColor[r.matchType],
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                }}>
                  {matchTypeLabel[r.matchType]}
                </span>
              </div>
              <div style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {r.snippet}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(r.date).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {isOpen && query.trim() && results.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 8,
          right: 8,
          marginTop: 4,
          padding: '12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
          color: 'var(--text-muted)',
          textAlign: 'center',
          zIndex: 100,
        }}>
          No results found
        </div>
      )}
    </div>
  );
}
