// Which lines to show for a speaker when asking "who is this?".
//
// Reading a snippet is a poor way to recognise a voice, but a line where
// someone introduces themself, or is answered by name, identifies them on
// sight. Those win; otherwise fall back to spread-out, substantial lines.

export interface QuoteCandidate {
  text: string;
  start: number;
  end: number;
}

const INTRO = /\b(this is|i'm|i am|my name is|it's|speaking)\b/i;
const MIN_WORDS = 6;

function words(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

function firstNames(names: string[]): string[] {
  return names
    .map(n => n.trim().split(/\s+/)[0])
    .filter(n => n && n.length >= 3)
    .map(n => n.toLowerCase());
}

export function pickSpeakerQuotes<T extends QuoteCandidate>(
  utterances: T[],
  opts: { names?: string[]; max?: number } = {},
): T[] {
  const max = opts.max ?? 3;
  if (utterances.length === 0) return [];
  const nameList = firstNames(opts.names || []);
  const mentionsName = (t: string) => {
    const lower = t.toLowerCase();
    return nameList.some(n => new RegExp(`\\b${n}\\b`).test(lower));
  };

  const chosen: T[] = [];
  const take = (u: T) => { if (!chosen.includes(u) && chosen.length < max) chosen.push(u); };

  // 1. Self-introductions: "this is Dana", "Dana here"
  for (const u of utterances) if (INTRO.test(u.text) && mentionsName(u.text)) take(u);
  // 2. Any line that names an attendee ("thanks, Dana" — spoken to someone else, but still a clue)
  for (const u of utterances) if (mentionsName(u.text)) take(u);
  // 3. Substantial lines spread through the meeting
  const substantial = utterances.filter(u => words(u.text) >= MIN_WORDS);
  const pool = substantial.length > 0 ? substantial : utterances;
  const spread = [0, 0.5, 0.8].map(f => pool[Math.min(pool.length - 1, Math.floor(pool.length * f))]);
  for (const u of spread) take(u);
  // 4. Whatever is left, in order
  for (const u of utterances) take(u);

  // Priority order, not time order: the most identifying line goes on top.
  return chosen;
}
