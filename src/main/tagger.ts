import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger';
import { getSetting } from './store';
import { getRecording } from './recording-manager';

// Resolve the claude CLI binary path
function getClaudePath(): string {
  const candidates = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'claude';
}

// Build a shell environment that includes common PATH entries
function getShellEnv(): Record<string, string> {
  const env = { ...process.env };
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
  ];
  const currentPath = env.PATH || '';
  env.PATH = [...extraPaths, currentPath].join(':');
  return env as Record<string, string>;
}

async function getAnthropicKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'anthropic');
  if (!key) throw new Error('Anthropic API key not configured');
  return key;
}

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

async function getTagsViaCLI(notesContent: string): Promise<string[]> {
  const claudePath = getClaudePath();
  const prompt = `${TAG_PROMPT}\n\n${notesContent}`;

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let output = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        try {
          const tags = JSON.parse(output.trim());
          if (Array.isArray(tags)) {
            resolve(tags.filter((t: unknown) => typeof t === 'string'));
          } else {
            reject(new Error('Response is not a JSON array'));
          }
        } catch {
          // Try to extract JSON array from the output
          const match = output.match(/\[[\s\S]*?\]/);
          if (match) {
            try {
              const tags = JSON.parse(match[0]);
              resolve(tags.filter((t: unknown) => typeof t === 'string'));
              return;
            } catch {}
          }
          reject(new Error(`Failed to parse tags from CLI output: ${output.trim()}`));
        }
      } else {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function getTagsViaAPI(notesContent: string): Promise<string[]> {
  const apiKey = await getAnthropicKey();
  const client = new Anthropic({ apiKey });
  const prompt = `${TAG_PROMPT}\n\n${notesContent}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as any).text?.trim() || '';

  try {
    const tags = JSON.parse(text);
    if (Array.isArray(tags)) {
      return tags.filter((t: unknown) => typeof t === 'string');
    }
  } catch {}

  // Try to extract JSON array from the text
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const tags = JSON.parse(match[0]);
      return tags.filter((t: unknown) => typeof t === 'string');
    } catch {}
  }

  throw new Error(`Failed to parse tags from API response: ${text}`);
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

    const provider = getSetting('notesProvider') || 'cli';
    let tags: string[];

    if (provider === 'cli') {
      tags = await getTagsViaCLI(truncated);
    } else {
      tags = await getTagsViaAPI(truncated);
    }

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
