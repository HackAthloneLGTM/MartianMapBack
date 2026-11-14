import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILES, hasDataFiles, parsePort } from '../src/config.ts';

describe('parsePort', () => {
  it('defaults to 3001 when unset or blank', () => {
    expect(parsePort(undefined)).toBe(3001);
    expect(parsePort('')).toBe(3001);
    expect(parsePort('  ')).toBe(3001);
  });

  it('accepts valid ports', () => {
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort('0')).toBe(0);
    expect(parsePort('65535')).toBe(65535);
  });

  it('rejects non-numeric, fractional and out-of-range values with a clear message', () => {
    for (const bad of ['abc', '30.5', '-1', '65536']) {
      expect(() => parsePort(bad)).toThrow(`Invalid PORT "${bad}"`);
    }
  });
});

describe('hasDataFiles', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const dirWith = (files: string[]) => {
    dir = mkdtempSync(path.join(tmpdir(), 'martian-data-'));
    for (const f of files) writeFileSync(path.join(dir, f), '');
    return dir;
  };

  it('is true only when every data file is present', () => {
    expect(hasDataFiles(dirWith(Object.values(FILES)))).toBe(true);
  });

  it('is false when any one file is missing (not just the elevation raster)', () => {
    for (const missing of Object.values(FILES)) {
      const d = dirWith(Object.values(FILES).filter((f) => f !== missing));
      expect(hasDataFiles(d), `missing ${missing}`).toBe(false);
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('.gitignore', () => {
  const root = path.resolve(import.meta.dirname, '..');
  /** Exit code 0 means ignored, 1 means not. --no-index so already-tracked files are still checked against the rules. */
  const isIgnored = (p: string) => {
    try {
      execFileSync('git', ['check-ignore', '--no-index', '-q', p], { cwd: root });
      return true;
    } catch (err) {
      if ((err as { status?: number }).status === 1) return false;
      throw err;
    }
  };

  it('does not ignore the src/data source files', () => {
    expect(isIgnored('src/data/terrain.ts')).toBe(false);
  });

  it('still ignores the top-level data folder', () => {
    expect(isIgnored('data')).toBe(true);
  });
});
