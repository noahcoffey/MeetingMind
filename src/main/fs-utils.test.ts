import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { writeJsonAtomic } from './fs-utils';

describe('writeJsonAtomic', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fsutils-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('writes parseable JSON to the target path', () => {
    const target = path.join(tempDir, 'manifest.json');
    writeJsonAtomic(target, { id: 'abc', chunks: ['a.wav'] });
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ id: 'abc', chunks: ['a.wav'] });
  });

  test('leaves no temp file behind', () => {
    const target = path.join(tempDir, 'manifest.json');
    writeJsonAtomic(target, { ok: true });
    expect(fs.readdirSync(tempDir)).toEqual(['manifest.json']);
  });

  test('replaces an existing file', () => {
    const target = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(target, JSON.stringify({ old: true }));
    writeJsonAtomic(target, { new: true });
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ new: true });
  });
});
