import React, { useState, useEffect, useRef } from 'react';
import type { TranscriptUtterance, SpeakerSuggestions } from '../types';
import { pickSpeakerQuotes } from '../speaker-quotes';

const SPEAKER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

interface SpeakerPanelProps {
  utterances: TranscriptUtterance[];
  speakerNames: Record<string, string>;
  onRenameSpeaker: (oldName: string, newName: string) => void;
  /** People from the calendar invite, plus the recorder. Become one-click chips. */
  attendees?: string[];
  userName?: string;
  /** Claude's guesses, shown as a highlighted first chip with its reason. */
  suggestions?: SpeakerSuggestions;
  /** The auto pipeline is parked on this recording until names are confirmed. */
  awaitingReview?: boolean;
  /** Show the "Generate notes" action (no notes exist yet). */
  canGenerateNotes?: boolean;
  isGenerating?: boolean;
  onGenerateNotes?: () => void;
  onSuggestNames?: () => Promise<void> | void;
  /** Audio: play one utterance (seconds), and where playback is now. */
  onPlaySegment?: (startSec: number, endSec: number) => void;
  currentTime?: number;
  isPlaying?: boolean;
}

interface SpeakerInfo {
  key: string; // original key like "Speaker 1"
  displayName: string;
  isNamed: boolean;
  utteranceCount: number;
  totalWords: number;
  quotes: TranscriptUtterance[];
  color: string;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isGenericName(key: string, name?: string): boolean {
  return !name || name === key || /^Speaker \d+$/i.test(name);
}

/** "dana.whitfield@x.com" → "Dana Whitfield"; keeps names as they are. */
function chipName(raw: string): string {
  let s = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (s.includes('@')) {
    s = s.split('@')[0]
      .split(/[._\-+]+/)
      .filter(p => p && !/^\d+$/.test(p))
      .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }
  return s;
}

export default function SpeakerPanel({
  utterances, speakerNames, onRenameSpeaker,
  attendees = [], userName = '', suggestions = {},
  awaitingReview = false, canGenerateNotes = false, isGenerating = false,
  onGenerateNotes, onSuggestNames, onPlaySegment, currentTime = 0, isPlaying = false,
}: SpeakerPanelProps) {
  const [directory, setDirectory] = useState<string[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.meetingMind.getSpeakerDirectory().then(setDirectory);
  }, []);

  useEffect(() => {
    if (editingKey && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingKey]);

  const allSpeakers = Array.from(new Set(utterances.map(u => u.speaker)));

  // People we know were (probably) in the room, in the order we'd offer them.
  const known: string[] = [];
  const seen = new Set<string>();
  const addKnown = (raw: string) => {
    const n = chipName(raw);
    const k = n.toLowerCase();
    if (n && !seen.has(k)) { seen.add(k); known.push(n); }
  };
  if (userName) addKnown(userName);
  attendees.forEach(addKnown);
  const invited = [...known];
  directory.forEach(addKnown);

  const speakers: SpeakerInfo[] = allSpeakers.map((key, idx) => {
    const speakerUtterances = utterances.filter(u => u.speaker === key);
    const totalWords = speakerUtterances.reduce((sum, u) => sum + u.text.split(/\s+/).length, 0);
    const name = speakerNames[key];
    return {
      key,
      displayName: name || key,
      isNamed: !isGenericName(key, name),
      utteranceCount: speakerUtterances.length,
      totalWords,
      quotes: pickSpeakerQuotes(speakerUtterances, { names: invited, max: 3 }),
      color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
    };
  });

  const unnamed = speakers.filter(s => !s.isNamed);
  const assignedLower = new Set(
    speakers.filter(s => s.isNamed).map(s => s.displayName.toLowerCase())
  );

  // Suggestions still worth accepting: unnamed speakers with a named guess
  // that nobody else already holds.
  const pendingSuggestions = unnamed
    .map(s => ({ key: s.key, s: suggestions[s.key] }))
    .filter(x => x.s && x.s.name && !assignedLower.has(x.s.name.toLowerCase()));

  function handleStartEdit(speaker: SpeakerInfo) {
    setEditingKey(speaker.key);
    setEditValue(speaker.isNamed ? speaker.displayName : '');
  }

  function assign(key: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = speakerNames[key] || key;
    if (trimmed !== current) {
      onRenameSpeaker(key, trimmed);
      setTimeout(() => window.meetingMind.getSpeakerDirectory().then(setDirectory), 200);
    }
    setEditingKey(null);
  }

  function clear(key: string) {
    if (!isGenericName(key, speakerNames[key])) onRenameSpeaker(key, key);
  }

  function handleSave() {
    if (!editingKey) return;
    if (editValue.trim()) assign(editingKey, editValue);
    else setEditingKey(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditingKey(null);
  }

  function acceptAll() {
    const used = new Set(assignedLower);
    for (const { key, s } of pendingSuggestions) {
      const n = s!.name!;
      if (used.has(n.toLowerCase())) continue;
      used.add(n.toLowerCase());
      onRenameSpeaker(key, n);
    }
    setTimeout(() => window.meetingMind.getSpeakerDirectory().then(setDirectory), 200);
  }

  async function suggest() {
    if (!onSuggestNames || suggesting) return;
    setSuggesting(true);
    try { await onSuggestNames(); } finally { setSuggesting(false); }
  }

  if (utterances.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No transcript data available. Transcribe this recording first.
      </div>
    );
  }

  const chipStyle = (kind: 'suggested' | 'invited' | 'directory' | 'other'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
    border: kind === 'suggested' ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
    background: kind === 'suggested'
      ? 'color-mix(in srgb, var(--accent-blue) 14%, transparent)'
      : kind === 'invited' ? 'var(--bg-input)' : 'transparent',
    color: kind === 'other' ? 'var(--text-muted)' : 'var(--text-primary)',
    fontWeight: kind === 'suggested' ? 600 : 500,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {/* Header: state + primary actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        padding: awaitingReview ? '10px 12px' : 0,
        background: awaitingReview ? 'color-mix(in srgb, var(--accent-yellow) 12%, transparent)' : 'transparent',
        border: awaitingReview ? '1px solid color-mix(in srgb, var(--accent-yellow) 40%, transparent)' : 'none',
        borderRadius: 'var(--radius)',
      }}>
        <div style={{ flex: 1, fontSize: 12, color: awaitingReview ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1.4 }}>
          {awaitingReview ? (
            <>
              <strong>Notes are waiting on speaker names.</strong>{' '}
              {unnamed.length > 0
                ? `${unnamed.length} speaker${unnamed.length === 1 ? '' : 's'} still unnamed. Generate when it looks right.`
                : 'Everyone is named. Generate when you are ready.'}
            </>
          ) : (
            'Label each speaker so notes and action items land on the right person. Names are saved for quick reuse.'
          )}
        </div>
        {onSuggestNames && unnamed.length > 0 && (
          <button className="btn btn-ghost" style={{ flexShrink: 0, fontSize: 12 }} onClick={suggest} disabled={suggesting}>
            {suggesting ? 'Asking Claude...' : pendingSuggestions.length > 0 ? 'Ask Claude again' : 'Ask Claude who is who'}
          </button>
        )}
        {pendingSuggestions.length > 1 && (
          <button className="btn btn-ghost" style={{ flexShrink: 0, fontSize: 12 }} onClick={acceptAll}>
            Accept all suggestions
          </button>
        )}
        {canGenerateNotes && onGenerateNotes && (
          <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={onGenerateNotes} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : unnamed.length > 0 ? 'Generate notes anyway' : 'Generate notes'}
          </button>
        )}
      </div>

      <datalist id="speaker-suggestions">
        {known.filter(n => !assignedLower.has(n.toLowerCase())).map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {speakers.map(speaker => {
          const suggestion = suggestions[speaker.key];
          const suggestedName = suggestion?.name && !speaker.isNamed && !assignedLower.has(suggestion.name.toLowerCase())
            ? suggestion.name
            : null;
          const invitedChips = invited.filter(n =>
            !assignedLower.has(n.toLowerCase()) && n.toLowerCase() !== suggestedName?.toLowerCase()
          );
          const directoryChips = known
            .filter(n => !invited.includes(n))
            .filter(n => !assignedLower.has(n.toLowerCase()) && n.toLowerCase() !== suggestedName?.toLowerCase())
            .slice(0, 6);

          return (
            <div
              key={speaker.key}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius)',
                border: `1px solid ${speaker.isNamed ? 'var(--border-color)' : 'color-mix(in srgb, var(--accent-yellow) 45%, var(--border-color))'}`,
                padding: 14,
              }}
            >
              {/* Speaker header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: speaker.color, flexShrink: 0,
                }} />
                {editingKey === speaker.key ? (
                  <input
                    ref={inputRef}
                    list="speaker-suggestions"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                    style={{ flex: 1, fontSize: 14, fontWeight: 600, padding: '4px 8px' }}
                    placeholder="Type a name..."
                  />
                ) : (
                  <div
                    onClick={() => handleStartEdit(speaker)}
                    style={{
                      flex: 1, fontSize: 14, fontWeight: 600,
                      color: speaker.isNamed ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius)',
                      border: '1px solid transparent',
                      transition: 'border-color 150ms',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                    title="Click to type a name"
                  >
                    {speaker.displayName}
                    {speaker.isNamed && (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>({speaker.key})</span>
                    )}
                    {!speaker.isNamed && (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--accent-yellow)' }}>unnamed</span>
                    )}
                  </div>
                )}
                {speaker.isNamed && editingKey !== speaker.key && (
                  <button
                    onClick={() => clear(speaker.key)}
                    title="Clear name"
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
                  >
                    &times;
                  </button>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {speaker.utteranceCount} segments · {speaker.totalWords} words
                </div>
              </div>

              {/* Chips: who is this? */}
              {(!speaker.isNamed || suggestedName) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
                  {suggestedName && (
                    <span
                      onClick={() => assign(speaker.key, suggestedName)}
                      style={chipStyle('suggested')}
                      title={suggestion?.reason || 'Suggested by Claude'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" /></svg>
                      {suggestedName}
                      <span style={{ fontWeight: 400, opacity: 0.7 }}>· {suggestion?.confidence}</span>
                    </span>
                  )}
                  {invitedChips.map(n => (
                    <span key={n} onClick={() => assign(speaker.key, n)} style={chipStyle('invited')}>{n}</span>
                  ))}
                  {directoryChips.map(n => (
                    <span key={n} onClick={() => assign(speaker.key, n)} style={chipStyle('directory')}>{n}</span>
                  ))}
                  <span onClick={() => handleStartEdit(speaker)} style={chipStyle('other')}>Someone else...</span>
                </div>
              )}
              {suggestedName && suggestion?.reason && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4, marginBottom: 10, paddingLeft: 2 }}>
                  Claude: {suggestion.reason}
                </div>
              )}
              {!suggestedName && !speaker.isNamed && suggestion && !suggestion.name && suggestion.reason && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4, marginBottom: 10, paddingLeft: 2 }}>
                  Claude could not tell: {suggestion.reason}
                </div>
              )}

              {/* Sample quotes, each playable */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {speaker.quotes.map((q, i) => {
                  const startSec = q.start / 1000;
                  const endSec = q.end / 1000;
                  const active = isPlaying && currentTime >= startSec && currentTime < endSec;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      fontSize: 12, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.5,
                      paddingLeft: 8,
                      borderLeft: `2px solid ${active ? speaker.color : speaker.color + '33'}`,
                    }}>
                      {onPlaySegment && (
                        <button
                          onClick={() => onPlaySegment(startSec, endSec)}
                          title={`Play ${fmtTime(q.start)}`}
                          style={{
                            flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                            border: `1px solid ${speaker.color}`, background: active ? speaker.color : 'transparent',
                            color: active ? '#fff' : speaker.color, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, marginTop: 1,
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                        </button>
                      )}
                      <span style={{ fontStyle: 'italic' }}>
                        <span style={{ fontStyle: 'normal', color: 'var(--text-muted)', marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(q.start)}</span>
                        "{truncate(q.text, 140)}"
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
