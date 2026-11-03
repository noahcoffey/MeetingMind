import React from 'react';

interface RecordingWarningsProps {
  diskWarning: string | null;
  audioWarning: string | null;
}

/** Low-disk and audio-capture warnings from the recorder. */
export default function RecordingWarnings({ diskWarning, audioWarning }: RecordingWarningsProps) {
  return (
    <>
      {diskWarning && (
        <div className={`disk-warning rp-disk-warning ${diskWarning === 'critical' ? 'critical' : ''}`}>
          {diskWarning === 'critical'
            ? 'Disk space critically low! Recording paused.'
            : 'Low disk space warning — less than 500MB remaining'}
        </div>
      )}

      {audioWarning && (
        <div className="disk-warning rp-disk-warning critical">
          {audioWarning}
        </div>
      )}
    </>
  );
}
