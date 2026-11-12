/** "dana.whitfield@x.com" → "Dana Whitfield"; keeps names as they are. */
export function chipName(raw: string): string {
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

/** Display names for a list of raw names, de-duplicated case-insensitively, order kept. */
export function uniqueChipNames(raws: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of raws) {
    const n = chipName(raw);
    const k = n.toLowerCase();
    if (n && !seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}
