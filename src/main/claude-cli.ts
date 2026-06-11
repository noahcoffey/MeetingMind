import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
