import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';
import { runClaude } from './claude-cli';
import { LIGHT_MODEL } from './claude-models';

function getOutputDir(): string {
  return getSetting('recordingOutputFolder') || path.join(os.homedir(), 'Documents', 'MeetingMind');
}

function getRecordingDir(recordingId: string): string | null {
  const outputDir = getOutputDir();
  // Check both direct and recordings subdirectory
  const candidates = [
    path.join(outputDir, recordingId),
    path.join(outputDir, 'recordings', recordingId),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      return dir;
    }
  }
  return null;
}

const TAG_PROMPT = 'Based on these meeting notes, suggest 2-4 short category tags (1-2 words each). Return ONLY a JSON array of lowercase strings, nothing else.';

/** Pull a list of tags out of a reply that should be a JSON array but may have text around it. */
export function parseTags(text: string): string[] {
  const clean = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : null;
  try {
    const tags = clean(JSON.parse(text.trim()));
    if (tags) return tags;
  } catch {}
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const tags = clean(JSON.parse(match[0]));
      if (tags) return tags;
    } catch {}
  }
  throw new Error(`Failed to parse tags from reply: ${text.trim().slice(0, 200)}`);
}

export async function autoTagRecording(recordingId: string): Promise<string[]> {
  try {
    const recordingDir = getRecordingDir(recordingId);
    if (!recordingDir) {
      log('warn', 'Recording not found for auto-tagging', { recordingId });
      return [];
    }

    const notesPath = path.join(recordingDir, 'notes.md');
    if (!fs.existsSync(notesPath)) {
      log('warn', 'Notes not found for auto-tagging', { recordingId });
      return [];
    }

    const notesContent = fs.readFileSync(notesPath, 'utf-8');
    const truncated = notesContent.substring(0, 800);

    const { text } = await runClaude({
      label: 'tags',
      prompt: `${TAG_PROMPT}\n\n${truncated}`,
      model: LIGHT_MODEL,
      maxTokens: 2000,
      effort: 'low',
      timeoutMs: 2 * 60 * 1000,
    });
    const tags = parseTags(text);

    // Write tags to manifest
    const manifestPath = path.join(recordingDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.tags = tags;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    log('info', 'Auto-tagged recording', { recordingId, tags });
    return tags;
  } catch (err: any) {
    log('error', 'Auto-tagging failed', { recordingId, error: err.message });
    return [];
  }
}

export function setTags(recordingId: string, tags: string[]): { success: boolean } {
  try {
    const recordingDir = getRecordingDir(recordingId);
    if (!recordingDir) {
      log('warn', 'Recording not found for setTags', { recordingId });
      return { success: false };
    }

    const manifestPath = path.join(recordingDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.tags = tags;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    log('info', 'Tags set on recording', { recordingId, tags });
    return { success: true };
  } catch (err: any) {
    log('error', 'Failed to set tags', { recordingId, error: err.message });
    return { success: false };
  }
}

export function getAllTags(): string[] {
  try {
    const outputDir = getOutputDir();
    const tagSet = new Set<string>();
    const dirsToScan = [outputDir, path.join(outputDir, 'recordings')].filter(d => fs.existsSync(d));

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

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (Array.isArray(manifest.tags)) {
            for (const tag of manifest.tags) {
              if (typeof tag === 'string') tagSet.add(tag);
            }
          }
        } catch {
          // skip unreadable manifests
        }
      }
    }

    return Array.from(tagSet).sort();
  } catch (err: any) {
    log('error', 'Failed to get all tags', { error: err.message });
    return [];
  }
}
