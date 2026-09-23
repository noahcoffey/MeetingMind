import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from './store';

// Shared plumbing for the Claude-powered features (notes, tags, Q&A,
// highlights, project summaries, analytics insights): locating the claude
// CLI, building a PATH that finds it from a GUI app, and reading the
// Anthropic API key from the Keychain.

// Resolve the claude CLI binary path from common install locations,
// falling back to PATH resolution (see getShellEnv).
export function getClaudePath(): string {
  const candidates = [
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'claude';
}

// GUI apps on macOS don't inherit the user's shell PATH, so prepend the
// common binary locations before spawning CLI tools.
export function getShellEnv(): Record<string, string> {
  const env = { ...process.env };
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
  ];
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env as Record<string, string>;
}

export async function getAnthropicKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'anthropic');
  if (!key) throw new Error('Anthropic API key not configured. Go to Settings to add your API key.');
  return key;
}

// Run a one-shot prompt and return the full text reply, through whichever
// backend the user picked for notes (the claude CLI on their subscription, or
// the API on their key). Used by the small helper calls — speaker
// identification and the like — that want a single answer, not a stream.
export async function runClaudePrompt(
  prompt: string,
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string> {
  const model = opts.model || getSetting('claudeModel') || 'claude-sonnet-4-6';
  const provider = getSetting('notesProvider') || 'cli';

  if (provider === 'api') {
    const client = new Anthropic({ apiKey: await getAnthropicKey() });
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(getClaudePath(), ['-p', '--model', model, '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('close', (code: number) => {
      if (code === 0 && out.trim()) resolve(out);
      else reject(new Error(err.trim() || `claude CLI exited with code ${code}`));
    });
    proc.on('error', (e: Error) => reject(new Error(`Could not start claude CLI: ${e.message}`)));
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
