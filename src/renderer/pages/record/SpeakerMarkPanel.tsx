import React, { useEffect, useRef, useState } from 'react';
import type { SpeakerMark } from '../../types';
import { uniqueChipNames } from '../../attendee-name';
import { formatDuration } from './format';

interface SpeakerMarkPanelProps {
  /** Attendees of the staged calendar event (raw — emails or names). */
  attendees: string[];
  isPaused: boolean;
}

/**
 * "Who's talking?" — tap a name while that person speaks. Main stamps each tap
 * with the recording time; after transcription the taps are matched against
 * the diarized speakers to put names on them.
 */
export default function SpeakerMarkPanel({ attendees, isPaused }: SpeakerMarkPanelProps) {
  const [userName, setUserName] = useState('');
  const [marks, setMarks] = useState<SpeakerMark[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const cancelDraftRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.meetingMind.getSettings().then((s: any) => setUserName(s.userName || '')).catch(() => {});
    // Marks already made in this recording (the page was remounted or reloaded).
    window.meetingMind.getRecordingStatus().then(status => {
      if (status?.recording && status.speakerMarks?.length) setMarks(status.speakerMarks);
    }).catch(() => {});
    return () => { if (flashTimer.current) clearTimeout(flashTimer.current); };
  }, []);

  const names = uniqueChipNames([userName, ...attendees, ...extras, ...marks.map(m => m.name)]);
  const counts = new Map<string, number>();
  for (const m of marks) counts.set(m.name.toLowerCase(), (counts.get(m.name.toLowerCase()) || 0) + 1);
  const last = marks[marks.length - 1];

  async function mark(name: string) {
    if (isPaused) return;
    const result = await window.meetingMind.markSpeaker(name);
    if (!result.success || !result.mark) return;
    setMarks(prev => [...prev, result.mark!]);
    setFlash(name.toLowerCase());
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 450);
  }

  async function undo() {
    const result = await window.meetingMind.undoSpeakerMark();
    if (result.success) setMarks(prev => prev.slice(0, -1));
  }

  function commitDraft() {
    const cancelled = cancelDraftRef.current;
    cancelDraftRef.current = false;
    const name = cancelled ? '' : draft.replace(/\s+/g, ' ').trim();
    setAdding(false);
    setDraft('');
    if (!name) return;
    if (!names.some(n => n.toLowerCase() === name.toLowerCase())) setExtras(prev => [...prev, name]);
    // Adding someone usually means they just started talking.
    mark(name);
  }

  return (
    <div className="rp-marks">
      <div className="rp-marks-head">
        <span className="rp-marks-title">Who's talking?</span>
        <span className="rp-marks-hint">
          {isPaused ? 'Paused' : 'Tap a name when they speak to help match speakers later.'}
        </span>
      </div>

      <div className="rp-marks-chips">
        {names.map(name => {
          const n = counts.get(name.toLowerCase()) || 0;
          return (
            <button
              key={name}
              type="button"
              className={`rp-mark-chip${flash === name.toLowerCase() ? ' flash' : ''}`}
              onClick={() => mark(name)}
              disabled={isPaused}
              title={`${name} is talking now`}
            >
              {name}
              {n > 0 && <span className="rp-mark-count">{n}</span>}
            </button>
          );
        })}

        {adding ? (
          <input
            autoFocus
            className="form-input rp-mark-input"
            placeholder="Name"
            value={draft}
            maxLength={80}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              // Both end in blur, which is the one place a name is committed.
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { cancelDraftRef.current = true; e.currentTarget.blur(); }
            }}
            onBlur={commitDraft}
          />
        ) : (
          <button
            type="button"
            className="rp-mark-chip add"
            onClick={() => setAdding(true)}
            disabled={isPaused}
            title="Add someone who isn't on the invite"
          >
            + Someone else
          </button>
        )}
      </div>

      {last && (
        <div className="rp-marks-last">
          Marked {last.name} at {formatDuration(Math.floor(last.atMs / 1000))}
          <button type="button" className="rp-marks-undo" onClick={undo}>Undo</button>
        </div>
      )}
    </div>
  );
}
