import React from 'react';
import type { Recording } from '../../types';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { QAEntry } from './types';
import ErrorCard from './ErrorCard';

interface AskTabProps {
  selectedMeeting: Recording;
  qaScrollRef: React.RefObject<HTMLDivElement | null>;
  qaEntries: QAEntry[];
  qaIsAsking: boolean;
  qaError: string | null;
  setQaError: (error: string | null) => void;
  qaActiveQuestion: string;
  qaStreamingAnswer: string;
  qaQuestion: string;
  setQaQuestion: (question: string) => void;
  handleAskQuestion: () => void;
  handleDeleteQuestion: (qaId: string) => void;
  showToast: (msg: string) => void;
}

/** The Ask tab body: Q&A history, the streaming answer, and the question input. */
export default function AskTab({
  selectedMeeting,
  qaScrollRef,
  qaEntries,
  qaIsAsking,
  qaError,
  setQaError,
  qaActiveQuestion,
  qaStreamingAnswer,
  qaQuestion,
  setQaQuestion,
  handleAskQuestion,
  handleDeleteQuestion,
  showToast,
}: AskTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Q&A history */}
      <div
        ref={qaScrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}
      >
        {qaEntries.length === 0 && !qaIsAsking && !qaError && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 8 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ fontSize: 13 }}>Ask a question about this meeting</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              The full transcript and notes will be provided as context.
            </div>
          </div>
        )}

        {qaError && (
          <div style={{ padding: '0 4px', marginBottom: 12 }}>
            <ErrorCard
              title="Question Failed"
              error={qaError}
              onDismiss={() => setQaError(null)}
            />
          </div>
        )}

        {qaEntries.map(entry => (
          <div key={entry.id} style={{ marginBottom: 16, padding: '0 4px' }}>
            {/* Question */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{
                flex: 1,
                background: 'var(--accent-blue-tint)',
                borderRadius: '12px 12px 4px 12px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                marginLeft: 40,
              }}>
                {entry.question}
              </div>
            </div>
            {/* Answer */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--accent-blue-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 2,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={{
                flex: 1,
                background: 'var(--bg-input)',
                borderRadius: '4px 12px 12px 12px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.6,
                position: 'relative',
              }}>
                <MarkdownRenderer content={entry.answer} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      onClick={async () => {
                        const r = await (window.meetingMind as any).saveQAToObsidian(selectedMeeting!.id, entry.id);
                        showToast(r.success ? 'Added to Obsidian note' : r.error);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title="Add to Obsidian note"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                    </button>
                  <button
                    onClick={() => handleDeleteQuestion(entry.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                    title="Delete this Q&A"
                  >
                    &times;
                  </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Streaming answer */}
        {qaIsAsking && (
          <div style={{ marginBottom: 16, padding: '0 4px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{
                flex: 1,
                background: 'var(--accent-blue-tint)',
                borderRadius: '12px 12px 4px 12px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                marginLeft: 40,
              }}>
                {qaActiveQuestion}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--accent-blue-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 2,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={{
                flex: 1,
                background: 'var(--bg-input)',
                borderRadius: '4px 12px 12px 12px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.6,
              }}>
                {qaStreamingAnswer ? (
                  <MarkdownRenderer content={qaStreamingAnswer} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                    <div className="pipeline-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Thinking...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        padding: '8px 0',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        gap: 8,
      }}>
        <input
          type="text"
          className="form-input"
          placeholder="Ask a question about this meeting..."
          value={qaQuestion}
          onChange={e => setQaQuestion(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAskQuestion();
            }
          }}
          disabled={qaIsAsking}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary"
          onClick={handleAskQuestion}
          disabled={qaIsAsking || !qaQuestion.trim()}
          style={{ flexShrink: 0 }}
        >
          {qaIsAsking ? (
            <div className="pipeline-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
