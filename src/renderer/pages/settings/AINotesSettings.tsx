import React from 'react';

const DEFAULT_PROMPT = `You are a professional meeting notes assistant. Based on the transcript and context below, generate structured meeting notes in Markdown format.

Context:
- Meeting: {{event_title}}
- Date: {{date}}
- Attendees: {{attendees}}
- Duration: {{duration}}
- Additional context from the recorder: {{user_context}}
- Primary participant (the person who recorded this): {{user_name}}

Transcript:
{{transcript}}

Generate notes with these exact sections:

# {{suggested_title}}

**Date:** {{date}} | **Attendees:** {{attendees}} | **Duration:** {{duration}}

## Summary
(3-5 sentence executive summary)

## Key Discussion Points
(bullet points of main topics)

## Decisions Made
(explicit decisions reached, or "None recorded" if none)

## Action Items
(format: - [ ] [Person]: [task] (due: [date if mentioned]))

## Open Questions
(unresolved items / parking lot)

## Notes
(any important verbatim quotes or details worth preserving)`;

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
  anthropicKey: string;
  setAnthropicKey: (v: string) => void;
  hasAnthropicKey: boolean;
}

export default function AINotesSettings({
  settings, updateSetting,
  anthropicKey, setAnthropicKey, hasAnthropicKey,
}: Props) {
  const notesProvider = settings.notesProvider || 'cli';

  return (
    <>
      <div className="settings-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Notes Provider</label>
          <select
            className="form-select"
            value={notesProvider}
            onChange={e => updateSetting('notesProvider', e.target.value)}
          >
            <option value="cli">Claude Code CLI (subscription)</option>
            <option value="api">Anthropic API (credits)</option>
          </select>
          <div className="form-hint">
            {notesProvider === 'cli'
              ? 'Runs the "claude" CLI. Requires Claude Code installed and authenticated.'
              : 'Uses the Anthropic API directly. Requires an API key.'}
          </div>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Model</label>
          <select
            className="form-select"
            value={settings.claudeModel || 'claude-sonnet-4-20250514'}
            onChange={e => updateSetting('claudeModel', e.target.value)}
          >
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-opus-4-20250514">Claude Opus 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        </div>
      </div>

      {notesProvider === 'api' && (
        <div className="form-group">
          <label className="form-label">
            Anthropic API Key {hasAnthropicKey && <span className="key-saved">(saved)</span>}
          </label>
          <input
            type="password"
            className="form-input"
            placeholder={hasAnthropicKey ? '••••••••••••••' : 'Enter your Anthropic API key'}
            value={anthropicKey}
            onChange={e => setAnthropicKey(e.target.value)}
          />
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Prompt Template</label>
        <textarea
          className="form-textarea"
          rows={10}
          value={settings.notesPromptTemplate || DEFAULT_PROMPT}
          onChange={e => updateSetting('notesPromptTemplate', e.target.value)}
        />
        <button
          className="btn btn-ghost"
          style={{ marginTop: 4, fontSize: 12 }}
          onClick={() => updateSetting('notesPromptTemplate', DEFAULT_PROMPT)}
        >
          Reset to Default
        </button>
      </div>
    </>
  );
}
