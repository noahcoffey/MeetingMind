import React, { useState, useEffect, useRef } from 'react';
import type { TranscriptUtterance } from '../types';

const SPEAKER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

interface SpeakerPanelProps {
  utterances: TranscriptUtterance[];
  speakerNames: Record<string, string>;
  onRenameSpeaker: (oldName: string, newName: string) => void;
}

interface SpeakerInfo {
  key: string; // original key like "Speaker 1"
  displayName: string;
  utteranceCount: number;
  totalWords: number;
  sampleQuotes: string[];
  color: string;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

export default function SpeakerPanel({ utterances, speakerNames, onRenameSpeaker }: SpeakerPanelProps) {
  const [directory, setDirectory] = useState<string[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
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

  const speakers: SpeakerInfo[] = allSpeakers.map((key, idx) => {
    const speakerUtterances = utterances.filter(u => u.speaker === key);
    const totalWords = speakerUtterances.reduce((sum, u) => sum + u.text.split(/\s+/).length, 0);

    // Pick sample quotes: first, one from the middle, one from later
    const samples: string[] = [];
    if (speakerUtterances.length > 0) samples.push(speakerUtterances[0].text);
    if (speakerUtterances.length > 2) samples.push(speakerUtterances[Math.floor(speakerUtterances.length / 2)].text);
    if (speakerUtterances.length > 4) samples.push(speakerUtterances[Math.floor(speakerUtterances.length * 0.8)].text);

    return {
      key,
      displayName: speakerNames[key] || key,
      utteranceCount: speakerUtterances.length,
      totalWords,
      sampleQuotes: samples.map(s => truncate(s, 120)),
      color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
    };
  });

  function handleStartEdit(speaker: SpeakerInfo) {
    setEditingKey(speaker.key);
    setEditValue(speaker.displayName);
  }

  function handleSave() {
    if (!editingKey) return;
    const trimmed = editValue.trim();
    const currentName = speakerNames[editingKey] || editingKey;
    if (trimmed && trimmed !== currentName) {
      onRenameSpeaker(editingKey, trimmed);
      // Refresh directory after save
      setTimeout(() => window.meetingMind.getSpeakerDirectory().then(setDirectory), 200);
    }
    setEditingKey(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditingKey(null);
  }

  if (utterances.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No transcript data available. Transcribe this recording first.
      </div>
    );
  }

  // Filter directory suggestions: exclude names already assigned to other speakers in this recording
  const assignedNames = new Set(Object.values(speakerNames));
  const filteredDirectory = directory.filter(name => !assignedNames.has(name));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Label each speaker to improve meeting notes. Names are saved for quick reuse.
      </div>

      <datalist id="speaker-suggestions">
        {filteredDirectory.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {speakers.map(speaker => (
          <div
            key={speaker.key}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border-color)',
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
                  placeholder="Enter name..."
                />
              ) : (
                <div
                  onClick={() => handleStartEdit(speaker)}
                  style={{
                    flex: 1, fontSize: 14, fontWeight: 600,
                    color: speaker.displayName === speaker.key ? 'var(--text-muted)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid transparent',
                    transition: 'border-color 150ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                  title="Click to rename"
                >
                  {speaker.displayName}
                  {speaker.displayName === speaker.key && (
                    <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 8, color: 'var(--accent-blue)' }}>
                      click to label
                    </span>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {speaker.utteranceCount} segments · {speaker.totalWords} words
              </div>
            </div>

            {/* Sample quotes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {speaker.sampleQuotes.map((quote, i) => (
                <div key={i} style={{
                  fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
                  paddingLeft: 20,
                  borderLeft: `2px solid ${speaker.color}22`,
                  fontStyle: 'italic',
                }}>
                  "{quote}"
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
