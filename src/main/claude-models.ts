// The Claude models MeetingMind uses, in one place. Pure data — no Electron or
// Node imports — so the renderer's model picker can import it too.

export const CLAUDE_MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;

/** The model notes, Q&A, highlights and project summaries use unless the user picks another. */
export const DEFAULT_MODEL = CLAUDE_MODELS.sonnet;

/** Short, cheap helper calls: titles, tags, sentiment, trend blurbs. */
export const LIGHT_MODEL = CLAUDE_MODELS.haiku;

export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: CLAUDE_MODELS.opus, label: 'Claude Opus 5.5 — most capable' },
  { id: CLAUDE_MODELS.sonnet, label: 'Claude Sonnet 5.5 — recommended' },
  { id: CLAUDE_MODELS.haiku, label: 'Claude Haiku 5.5 — fastest, cheapest' },
];

// Saved model IDs from older versions, mapped to the current model of the same
// tier. Retired IDs are rejected outright by the API and the CLI; superseded
// ones still work but cost more for less.
const SUPERSEDED: Record<string, string> = {
  'claude-sonnet-4-20250514': CLAUDE_MODELS.sonnet,
  'claude-opus-4-20250514': CLAUDE_MODELS.opus,
  'claude-sonnet-4-5': CLAUDE_MODELS.sonnet,
  'claude-sonnet-4-6': CLAUDE_MODELS.sonnet,
  'claude-sonnet-5': CLAUDE_MODELS.sonnet,
  'claude-opus-4-6': CLAUDE_MODELS.opus,
  'claude-opus-4-7': CLAUDE_MODELS.opus,
  'claude-opus-4-8': CLAUDE_MODELS.opus,
  'claude-opus-5': CLAUDE_MODELS.opus,
  'claude-haiku-4-5': CLAUDE_MODELS.haiku,
  'claude-haiku-4-5-20251001': CLAUDE_MODELS.haiku,
};

/** The current equivalent of a saved model ID, or the ID itself if it's current or unknown. */
export function currentModelId(id: string | undefined | null): string {
  if (!id) return DEFAULT_MODEL;
  return SUPERSEDED[id] || id;
}
