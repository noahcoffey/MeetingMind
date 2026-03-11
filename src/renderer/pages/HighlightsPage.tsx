import React, { useState, useEffect, useRef } from 'react';
import type { HighlightsPreview } from '../types';
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
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPreview();
  }, [startDate, endDate]);

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
    if (reportRef.current && (streamedContent || report)) {
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

  async function handleGenerate() {
    setIsGenerating(true);
    setError('');
    setReport('');
    setStreamedContent('');

    try {
      const result = await window.meetingMind.generateHighlights(startDate, endDate);
      if (result.success && result.report) {
        setReport(result.report);
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

  function handleQuickRange(range: 'this-week' | 'last-week') {
    const r = range === 'this-week' ? getWeekRange() : getLastWeekRange();
    setStartDate(r.start);
    setEndDate(r.end);
    setReport('');
    setStreamedContent('');
    setError('');
  }

  async function handleCopy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
    } catch {}
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
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 16 }}>
          Weekly Highlights
        </h1>

        {/* Date range picker */}
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
                    background: m.hasNotes ? 'var(--accent-blue-bg, rgba(59,130,246,0.1))' : 'var(--bg-secondary)',
                    color: m.hasNotes ? 'var(--accent-blue, #3b82f6)' : 'var(--text-muted)',
                    border: `1px solid ${m.hasNotes ? 'var(--accent-blue, #3b82f6)22' : 'var(--border-color)'}`,
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
            No recordings found in this date range.
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius)',
            color: '#ef4444',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Generate button */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating || !preview || preview.withNotes === 0}
            style={{ fontSize: 13 }}
          >
            {isGenerating ? 'Generating...' : 'Generate Highlights'}
          </button>

          {report && (
            <button
              className="btn btn-ghost"
              onClick={handleCopy}
              style={{ fontSize: 13 }}
            >
              Copy to Clipboard
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

        {!displayContent && !isGenerating && (
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
    </div>
  );
}
