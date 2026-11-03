import React from 'react';

interface AudioTestPanelProps {
  audioTestRunning: boolean;
  isRecording: boolean;
  micTestLevel: number | null;
  micTestResult: 'pass' | 'fail' | null;
  sysTestResult: 'pass' | 'fail' | 'skip' | null;
  onTestAudio: () => void;
}

/** The Test Audio button, its live mic level, and the pass/fail results. */
export default function AudioTestPanel({ audioTestRunning, isRecording, micTestLevel, micTestResult, sysTestResult, onTestAudio }: AudioTestPanelProps) {
  return (
    <div style={{ width: '100%', maxWidth: 440 }}>
      <button
        className="btn btn-secondary"
        onClick={onTestAudio}
        disabled={audioTestRunning || isRecording}
        style={{ fontSize: 12, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {audioTestRunning ? (
          <>
            <span className="rp-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            Testing...
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            Test Audio
          </>
        )}
      </button>

      {/* Test results */}
      {(micTestResult || sysTestResult) && !audioTestRunning && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: micTestResult === 'pass' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 14 }}>
              {micTestResult === 'pass' ? '\u2713' : '\u2717'}
            </span>
            <span style={{ color: 'var(--text-primary)' }}>Microphone</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {micTestResult === 'pass' ? 'Audio detected' : 'No audio detected'}
            </span>
          </div>
          {sysTestResult && sysTestResult !== 'skip' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: sysTestResult === 'pass' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 14 }}>
                {sysTestResult === 'pass' ? '\u2713' : '\u2717'}
              </span>
              <span style={{ color: 'var(--text-primary)' }}>System Audio</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {sysTestResult === 'pass' ? 'Audio detected' : 'No audio detected — check setup guide below'}
              </span>
            </div>
          )}
          {sysTestResult === 'skip' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>—</span>
              <span style={{ color: 'var(--text-muted)' }}>System Audio</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>Not selected</span>
            </div>
          )}
        </div>
      )}

      {/* Live level during test */}
      {audioTestRunning && micTestLevel !== null && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)', minWidth: 80 }}>Microphone</span>
            <div style={{
              flex: 1,
              height: 6,
              background: 'var(--bg-input)',
              borderRadius: 3,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(100, micTestLevel * 500)}%`,
                height: '100%',
                background: micTestLevel > 0.02 ? 'var(--accent-green)' : 'var(--text-muted)',
                borderRadius: 3,
                transition: 'width 0.1s',
              }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Listening... speak or play audio to test
          </div>
        </div>
      )}
    </div>
  );
}
