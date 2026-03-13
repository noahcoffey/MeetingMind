import React, { useState, useEffect, useRef } from 'react';
import type { HighlightsPreview, SavedHighlight } from '../types';
import MarkdownRenderer from '../components/MarkdownRenderer';

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return {
    start: monday.toISOString().slice(0, 10),
    end: friday.toISOString().slice(0, 10),
  };
}

function getLastWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastFriday = new Date(lastMonday);
  lastFriday.setDate(lastMonday.getDate() + 4);

  return {
    start: lastMonday.toISOString().slice(0, 10),
    end: lastFriday.toISOString().slice(0, 10),
  };
}

export default function HighlightsPage() {
  const thisWeek = getWeekRange();
  const [startDate, setStartDate] = useState(thisWeek.start);
  const [endDate, setEndDate] = useState(thisWeek.end);
  const [preview, setPreview] = useState<HighlightsPreview | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [report, setReport] = useState('');
  const [streamedContent, setStreamedContent] = useState('');
  const [error, setError] = useState('');
  const [savedHighlights, setSavedHighlights] = useState<SavedHighlight[]>([]);
  const [viewingSavedId, setViewingSavedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPreview();
  }, [startDate, endDate]);

  useEffect(() => {
    loadSavedHighlights();
  }, []);

  useEffect(() => {
    const unsub = window.meetingMind.on('highlights:stream', (data: unknown) => {
      const text = data as string;
      setStreamedContent(prev => prev + text);
    });

    const unsubComplete = window.meetingMind.on('highlights:complete', (data: unknown) => {
      const { report: finalReport } = data as { report: string };
      setReport(finalReport);
      setStreamedContent('');
      setIsGenerating(false);
    });

    return () => {
      unsub();
      unsubComplete();
    };
  }, []);

  useEffect(() => {
    if (reportRef.current && streamedContent) {
      reportRef.current.scrollTop = reportRef.current.scrollHeight;
    }
  }, [streamedContent]);

  async function loadPreview() {
    if (!startDate || !endDate) return;
    try {
      const p = await window.meetingMind.getHighlightsPreview(startDate, endDate);
      setPreview(p);
    } catch {
      setPreview(null);
    }
  }

  async function loadSavedHighlights() {
    try {
      const saved = await window.meetingMind.listSavedHighlights();
      setSavedHighlights(saved);
    } catch {
      setSavedHighlights([]);
    }
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setError('');
    setReport('');
    setStreamedContent('');
    setViewingSavedId(null);

    try {
      const result = await window.meetingMind.generateHighlights(startDate, endDate);
      if (result.success && result.report) {
        setReport(result.report);
        loadSavedHighlights();
      } else {
        setError(result.error || 'Generation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
      setStreamedContent('');
    }
  }

  async function handleLoadSaved(highlight: SavedHighlight) {
    setError('');
    setStreamedContent('');
    try {
      const content = await window.meetingMind.getSavedHighlight(highlight.id);
      if (content) {
        setReport(content);
        setStartDate(highlight.startDate);
        setEndDate(highlight.endDate);
        setViewingSavedId(highlight.id);
      } else {
        setError('Could not load saved highlight.');
      }
    } catch {
      setError('Could not load saved highlight.');
    }
  }

  async function handleDeleteSaved(id: string) {
    try {
      await window.meetingMind.deleteSavedHighlight(id);
      setSavedHighlights(prev => prev.filter(h => h.id !== id));
      if (viewingSavedId === id) {
        setReport('');
        setViewingSavedId(null);
      }
    } catch {}
    setShowDeleteConfirm(null);
  }

  function handleQuickRange(range: 'this-week' | 'last-week') {
    const r = range === 'this-week' ? getWeekRange() : getLastWeekRange();
    setStartDate(r.start);
    setEndDate(r.end);
    setReport('');
    setStreamedContent('');
    setError('');
    setViewingSavedId(null);
  }

  async function handleCopy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
    } catch {}
  }

  function handleNewReport() {
    setReport('');
    setStreamedContent('');
    setError('');
    setViewingSavedId(null);
  }

  const displayContent = report || streamedContent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Weekly Highlights
          </h1>
          {viewingSavedId && (
            <button
              className="btn btn-ghost"
              onClick={handleNewReport}
              style={{ fontSize: 12 }}
            >
              New Report
            </button>
          )}
        </div>

        {/* Saved highlights list */}
        {savedHighlights.length > 0 && !displayContent && !isGenerating && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Saved Reports
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {savedHighlights.map(h => (
                <div
                  key={h.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms',
                  }}
                  onClick={() => handleLoadSaved(h)}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-blue)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--text-muted)' }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span style={{ flex: 1, fontSize: 13 }}>{h.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    className="btn btn-ghost"
                    onClick={e => { e.stopPropagation(); setShowDeleteConfirm(h.id); }}
                    style={{ padding: '2px 6px', fontSize: 11, color: 'var(--text-muted)' }}
                    title="Delete saved report"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Date range picker — hide when viewing a saved report */}
        {!viewingSavedId && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>From</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setReport(''); setError(''); }}
                  className="form-input"
                  style={{ fontSize: 13, padding: '5px 8px' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>To</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setReport(''); setError(''); }}
                  className="form-input"
                  style={{ fontSize: 13, padding: '5px 8px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleQuickRange('this-week')}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  This Week
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleQuickRange('last-week')}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  Last Week
                </button>
              </div>
            </div>

            {/* Preview info */}
            {preview && preview.meetingCount > 0 && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>{preview.meetingCount}</strong> meeting{preview.meetingCount !== 1 ? 's' : ''} found
                  {preview.withNotes > 0 && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                      {preview.withNotes} with notes
                      {preview.withoutNotes > 0 && (
                        <span style={{ color: 'var(--accent-primary)' }}>
                          {' '}&middot; {preview.withoutNotes} without notes
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {preview.meetings.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 12,
                        background: m.hasNotes ? 'var(--accent-blue-tint)' : 'var(--bg-secondary)',
                        color: m.hasNotes ? 'var(--accent-blue)' : 'var(--text-muted)',
                        border: `1px solid ${m.hasNotes ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                      }}
                      title={`${m.date} — ${m.hasNotes ? 'Has notes' : 'No notes yet'}`}
                    >
                      {m.title.length > 30 ? m.title.slice(0, 30) + '...' : m.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview && preview.meetingCount === 0 && (
              <div style={{
                marginTop: 12,
                padding: 12,
                fontSize: 13,
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}>
                No meetings found in this date range.
              </div>
            )}
          </>
        )}

        {error && (
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            background: 'var(--accent-red-subtle)',
            border: '1px solid var(--accent-red-tint)',
            borderRadius: 'var(--radius)',
            color: 'var(--accent-primary)',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {!viewingSavedId && (
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={isGenerating || !preview || preview.withNotes === 0}
              style={{ fontSize: 13 }}
            >
              {isGenerating ? 'Generating...' : 'Generate Highlights'}
            </button>
          )}

          {report && (
            <button
              className="btn btn-ghost"
              onClick={handleCopy}
              style={{ fontSize: 13 }}
            >
              Copy to Clipboard
            </button>
          )}

          {viewingSavedId && (
            <button
              className="btn btn-ghost"
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ fontSize: 13 }}
            >
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Report content */}
      <div
        ref={reportRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: displayContent ? '20px 24px' : 0,
        }}
      >
        {isGenerating && !streamedContent && (
          <div style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            <div style={{ marginBottom: 8 }}>Analyzing {preview?.meetingCount} meetings...</div>
            <div style={{ fontSize: 11 }}>This may take a minute depending on the number of meetings.</div>
          </div>
        )}

        {displayContent && (
          <div className="markdown-body">
            <MarkdownRenderer content={displayContent} />
          </div>
        )}

        {!displayContent && !isGenerating && savedHighlights.length === 0 && (
          <div style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            Select a date range and click "Generate Highlights" to create a summary of your week.
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setShowDeleteConfirm(null)}
        >
          <div
            style={{
              background: 'var(--bg-primary)', borderRadius: 'var(--radius)',
              padding: 24, width: 380, border: '1px solid var(--border-color)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Delete Saved Report</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Are you sure you want to delete this saved highlights report? This cannot be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(null)} style={{ fontSize: 13 }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleDeleteSaved(showDeleteConfirm)}
                style={{ fontSize: 13, background: 'var(--accent-primary)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
