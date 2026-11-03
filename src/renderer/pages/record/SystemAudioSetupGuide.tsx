import React from 'react';

interface SystemAudioSetupGuideProps {
  showAudioSetup: boolean;
  onShowAudioSetup: () => void;
  onDismiss: () => void;
  onRefreshDevices: () => void;
}

/** Shown when no virtual audio device exists: how to install BlackHole. */
export default function SystemAudioSetupGuide({ showAudioSetup, onShowAudioSetup, onDismiss, onRefreshDevices }: SystemAudioSetupGuideProps) {
  return (
    <div style={{
      background: 'var(--accent-yellow-tint)',
      border: '1px solid var(--accent-yellow)',
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
      width: '100%',
      maxWidth: 440,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            System Audio Not Available
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 16, lineHeight: 1 }}
        >&times;</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        Without a virtual audio device, MeetingMind can only record your microphone.
        Audio from Zoom, Teams, or Meet participants won't be captured.
      </div>
      {!showAudioSetup ? (
        <button
          className="btn btn-secondary"
          onClick={onShowAudioSetup}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          Show Setup Guide
        </button>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Install BlackHole (free virtual audio driver):</div>
          <div style={{ fontFamily: 'monospace', background: 'var(--bg-input)', padding: '6px 10px', borderRadius: 4, marginBottom: 10, fontSize: 11 }}>
            brew install blackhole-2ch
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Then set up a Multi-Output Device:</div>
          <ol style={{ margin: '0 0 0 16px', padding: 0 }}>
            <li style={{ marginBottom: 4 }}>Open <strong>Audio MIDI Setup</strong> (search in Spotlight)</li>
            <li style={{ marginBottom: 4 }}>Click <strong>+</strong> at bottom-left, select <strong>Create Multi-Output Device</strong></li>
            <li style={{ marginBottom: 4 }}>Check both your speakers/headphones <strong>and</strong> BlackHole 2ch</li>
            <li style={{ marginBottom: 4 }}>Go to <strong>System Settings &gt; Sound &gt; Output</strong>, select the Multi-Output Device</li>
            <li>Restart MeetingMind — BlackHole will appear in the System Audio dropdown above</li>
          </ol>
          <button
            className="btn btn-secondary"
            onClick={onRefreshDevices}
            style={{ fontSize: 12, padding: '4px 12px', marginTop: 10 }}
          >
            Refresh Devices
          </button>
        </div>
      )}
    </div>
  );
}
