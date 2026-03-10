import React, { useState, useEffect } from 'react';

interface AnalyticsStats {
  totalRecordings: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  meetingsPerWeekday: number[];
  meetingsPerWeek: { week: string; count: number; totalMinutes: number }[];
  topTags: { tag: string; count: number }[];
  longestMeeting: { id: string; title: string; duration: number } | null;
  shortestMeeting: { id: string; title: string; duration: number } | null;
  recentTrend: 'increasing' | 'decreasing' | 'stable';
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AnalyticsPage() {
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [trends, setTrends] = useState<string>('');
  const [loadingTrends, setLoadingTrends] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const s = await (window.meetingMind as any).getAnalyticsStats();
      setStats(s);
    } catch (err) {
      console.error('Failed to load analytics', err);
    }
  }

  async function loadTrends() {
    setLoadingTrends(true);
    try {
      const t = await (window.meetingMind as any).getTrendInsights();
      setTrends(t);
    } catch {
      setTrends('Unable to generate trend insights.');
    }
    setLoadingTrends(false);
  }

  if (!stats) {
    return (
      <>
        <div className="page-header"><h1>Analytics</h1></div>
        <div className="page-content" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </>
    );
  }

  if (stats.totalRecordings === 0) {
    return (
      <>
        <div className="page-header"><h1>Analytics</h1></div>
        <div className="page-content" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 12px', opacity: 0.4 }}>
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>No data yet</div>
          <div style={{ fontSize: 13 }}>Record some meetings to see analytics here.</div>
        </div>
      </>
    );
  }

  const maxWeekdayCount = Math.max(...stats.meetingsPerWeekday, 1);
  const maxWeekCount = Math.max(...stats.meetingsPerWeek.map(w => w.count), 1);

  const trendIcon = stats.recentTrend === 'increasing' ? '↑' : stats.recentTrend === 'decreasing' ? '↓' : '→';
  const trendColor = stats.recentTrend === 'increasing' ? 'var(--accent-green)' : stats.recentTrend === 'decreasing' ? 'var(--accent-primary)' : 'var(--text-muted)';

  return (
    <>
      <div className="page-header"><h1>Analytics</h1></div>
      <div className="page-content" style={{ maxWidth: 800 }}>

        {/* Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <StatCard label="Total Meetings" value={String(stats.totalRecordings)} />
          <StatCard label="Total Time" value={formatDuration(stats.totalDurationSeconds)} />
          <StatCard label="Avg Duration" value={formatDuration(stats.averageDurationSeconds)} />
          <StatCard
            label="Trend"
            value={`${trendIcon} ${stats.recentTrend}`}
            valueColor={trendColor}
          />
        </div>

        {/* Meetings per weekday */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>Meetings by Day of Week</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
            {stats.meetingsPerWeekday.map((count, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{count}</span>
                <div style={{
                  width: '100%',
                  maxWidth: 40,
                  height: `${Math.max(4, (count / maxWeekdayCount) * 80)}px`,
                  background: count > 0 ? 'var(--accent-blue)' : 'var(--border-color)',
                  borderRadius: '4px 4px 0 0',
                  transition: 'height 300ms ease',
                }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{WEEKDAYS[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Meetings per week (last 12 weeks) */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>Weekly Activity</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
            {stats.meetingsPerWeek.map((w, i) => (
              <div
                key={i}
                title={`${w.week}: ${w.count} meeting${w.count !== 1 ? 's' : ''}, ${w.totalMinutes}m`}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <div style={{
                  width: '100%',
                  height: `${Math.max(2, (w.count / maxWeekCount) * 70)}px`,
                  background: w.count > 0 ? 'var(--accent-green)' : 'var(--border-color)',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 300ms ease',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {stats.meetingsPerWeek.length > 0 ? stats.meetingsPerWeek[0].week : ''}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {stats.meetingsPerWeek.length > 0 ? stats.meetingsPerWeek[stats.meetingsPerWeek.length - 1].week : ''}
            </span>
          </div>
        </div>

        {/* Top tags + extremes row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* Top Tags */}
          <div className="card">
            <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Top Tags</h3>
            {stats.topTags.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tags yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.topTags.map(t => (
                  <div key={t.tag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      padding: '2px 8px',
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: 'var(--accent-blue)',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 500,
                    }}>{t.tag}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Records */}
          <div className="card">
            <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Records</h3>
            {stats.longestMeeting && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Longest</div>
                <div style={{ fontSize: 13 }}>
                  {stats.longestMeeting.title || 'Untitled'} — {formatDuration(stats.longestMeeting.duration)}
                </div>
              </div>
            )}
            {stats.shortestMeeting && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Shortest</div>
                <div style={{ fontSize: 13 }}>
                  {stats.shortestMeeting.title || 'Untitled'} — {formatDuration(stats.shortestMeeting.duration)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* AI Trend Insights */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, color: 'var(--text-secondary)' }}>AI Insights</h3>
            <button
              className="btn btn-secondary"
              onClick={loadTrends}
              disabled={loadingTrends}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              {loadingTrends ? 'Analyzing...' : trends ? 'Refresh' : 'Generate Insights'}
            </button>
          </div>
          {loadingTrends && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="pipeline-spinner" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Analyzing your meeting patterns...</div>
            </div>
          )}
          {!loadingTrends && trends && (
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)' }}>
              {trends}
            </div>
          )}
          {!loadingTrends && !trends && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
              Click "Generate Insights" to analyze your meeting patterns with Claude.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: valueColor || 'var(--text-primary)', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </div>
  );
}
