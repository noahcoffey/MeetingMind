jest.mock('./logger', () => ({ log: jest.fn() }));
jest.mock('./store', () => ({ getSetting: jest.fn() }));

import { buildCLIArgs, resolveModel } from './claude-cli';
import { CLAUDE_MODELS, DEFAULT_MODEL, currentModelId } from './claude-models';
import { getSetting } from './store';

const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;

describe('buildCLIArgs', () => {
  // Meeting transcripts and calendar invites are text other people control,
  // so the CLI must not be able to do anything but write text back.
  test('turns off every tool, MCP server and user setting', () => {
    const args = buildCLIArgs('claude-sonnet-5-5');
    const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args).toContain('-p');
    expect(valueOf('--tools')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(valueOf('--setting-sources')).toBe('');
    expect(args).toContain('--no-session-persistence');
    expect(valueOf('--model')).toBe('claude-sonnet-5-5');
  });

  test('never grants tools or skips permissions', () => {
    const args = buildCLIArgs('m', { effort: 'low', contextFile: '/tmp/x.txt' }).join(' ');
    expect(args).not.toMatch(/allowed-?tools|dangerously|bypass|--mcp-config/i);
  });

  test('passes the context as a system prompt file so it can be cached', () => {
    const args = buildCLIArgs('m', { contextFile: '/tmp/ctx.txt' });
    expect(args[args.indexOf('--append-system-prompt-file') + 1]).toBe('/tmp/ctx.txt');
    expect(buildCLIArgs('m')).not.toContain('--append-system-prompt-file');
  });

  test('passes effort only when asked', () => {
    expect(buildCLIArgs('m')).not.toContain('--effort');
    const args = buildCLIArgs('m', { effort: 'low' });
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
  });
});

describe('model IDs', () => {
  test('moves saved IDs from older versions to the same tier today', () => {
    expect(currentModelId('claude-sonnet-4-6')).toBe(CLAUDE_MODELS.sonnet);
    expect(currentModelId('claude-sonnet-4-20250514')).toBe(CLAUDE_MODELS.sonnet);
    expect(currentModelId('claude-opus-4-8')).toBe(CLAUDE_MODELS.opus);
    expect(currentModelId('claude-haiku-4-5-20251001')).toBe(CLAUDE_MODELS.haiku);
  });

  test('leaves current and unknown IDs alone, and defaults when unset', () => {
    expect(currentModelId(CLAUDE_MODELS.opus)).toBe(CLAUDE_MODELS.opus);
    expect(currentModelId('some-future-model')).toBe('some-future-model');
    expect(currentModelId('')).toBe(DEFAULT_MODEL);
    expect(currentModelId(undefined)).toBe(DEFAULT_MODEL);
  });

  test('resolveModel prefers the requested model, then the setting', () => {
    mockGetSetting.mockReturnValue('claude-sonnet-4-6' as any);
    expect(resolveModel()).toBe(CLAUDE_MODELS.sonnet);
    expect(resolveModel(CLAUDE_MODELS.haiku)).toBe(CLAUDE_MODELS.haiku);
    mockGetSetting.mockReturnValue(undefined as any);
    expect(resolveModel()).toBe(DEFAULT_MODEL);
  });
});
