import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSetting } from './store';
import { log } from './logger';

export interface SearchResult {
  recordingId: string;
  title: string;
  date: string;
  matchType: 'title' | 'tag' | 'notes' | 'transcript';
  snippet: string;
  score: number;
}

function getOutputDir(): string {
  return getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind');
}

function extractSnippet(text: string, query: string, maxLen: number = 120): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return '';

  // Calculate window around match
  const matchLen = query.length;
  const contextLen = Math.floor((maxLen - matchLen) / 2);
  let start = Math.max(0, idx - contextLen);
  let end = Math.min(text.length, idx + matchLen + contextLen);

  // Adjust to avoid cutting words
  if (start > 0) {
    const spaceIdx = text.indexOf(' ', start);
    if (spaceIdx !== -1 && spaceIdx < idx) start = spaceIdx + 1;
  }
  if (end < text.length) {
    const spaceIdx = text.lastIndexOf(' ', end);
    if (spaceIdx > idx + matchLen) end = spaceIdx;
  }

  let snippet = '';
  if (start > 0) snippet += '...';
  const before = text.substring(start, idx);
  const match = text.substring(idx, idx + matchLen);
  const after = text.substring(idx + matchLen, end);
  snippet += before + '**' + match + '**' + after;
  if (end < text.length) snippet += '...';

  return snippet;
}

function isRecent(dateStr: string, days: number = 7): boolean {
  try {
    const recordingDate = new Date(dateStr);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return recordingDate >= cutoff;
  } catch {
    return false;
  }
}

export function searchRecordings(query: string): SearchResult[] {
  if (!query || query.trim().length === 0) return [];

  const results: SearchResult[] = [];
  const outputDir = getOutputDir();
  const recordingsDir = path.join(outputDir, 'recordings');

  // Try both the output dir directly and a recordings subdirectory
  const dirsToScan = [outputDir, recordingsDir].filter(d => fs.existsSync(d));

  for (const baseDir of dirsToScan) {
    let entries: string[];
    try {
      entries = fs.readdirSync(baseDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = path.join(baseDir, entry, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      let manifest: any;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }

      const recordingId = manifest.id || entry;
      const title = manifest.title || 'Untitled';
      const date = manifest.date || '';
      const recencyBonus = isRecent(date) ? 20 : 0;
      const lowerQuery = query.toLowerCase();
      const recordingDir = path.join(baseDir, entry);

      // 1. Title match
      if (title.toLowerCase().includes(lowerQuery)) {
        results.push({
          recordingId,
          title,
          date,
          matchType: 'title',
          snippet: extractSnippet(title, query),
          score: 100 + recencyBonus,
        });
      }

      // 2. Tag matches
      if (Array.isArray(manifest.tags)) {
        for (const tag of manifest.tags) {
          if (typeof tag === 'string' && tag.toLowerCase().includes(lowerQuery)) {
            results.push({
              recordingId,
              title,
              date,
              matchType: 'tag',
              snippet: `Tag: **${tag}**`,
              score: 80 + recencyBonus,
            });
            break; // One tag match per recording is enough
          }
        }
      }

      // 3. Notes match
      const notesPath = path.join(recordingDir, 'notes.md');
      if (fs.existsSync(notesPath)) {
        try {
          const notesContent = fs.readFileSync(notesPath, 'utf-8');
          if (notesContent.toLowerCase().includes(lowerQuery)) {
            results.push({
              recordingId,
              title,
              date,
              matchType: 'notes',
              snippet: extractSnippet(notesContent, query),
              score: 60 + recencyBonus,
            });
          }
        } catch {
          // skip unreadable notes
        }
      }

      // 4. Transcript match
      const transcriptPath = path.join(recordingDir, 'transcript.json');
      if (fs.existsSync(transcriptPath)) {
        try {
          const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
          let fullText = '';
          if (transcriptData.utterances && Array.isArray(transcriptData.utterances)) {
            fullText = transcriptData.utterances.map((u: any) => u.text).join(' ');
          } else if (transcriptData.text) {
            fullText = transcriptData.text;
          }

          if (fullText.toLowerCase().includes(lowerQuery)) {
            results.push({
              recordingId,
              title,
              date,
              matchType: 'transcript',
              snippet: extractSnippet(fullText, query),
              score: 40 + recencyBonus,
            });
          }
        } catch {
          // skip unreadable transcripts
        }
      }
    }
  }

  // Sort by score desc, then by date desc
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  // Limit to 20 results
  return results.slice(0, 20);
}
