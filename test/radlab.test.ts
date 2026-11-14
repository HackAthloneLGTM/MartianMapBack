import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_DOSE_RATE_MSV_PER_DAY,
  QUALITY_FACTOR,
  fetchRadLabDoseRate,
  loadRadiation,
  parseRadCsv,
} from '../src/data/radlab.ts';

const CSV = [
  'timestamp,instrument_id,absorbed_dose_rate,spacecraft',
  '"2015-01-01T00:11:01","MSL-RAD-Surface",6,"Curiosity"',
  '"2015-01-01T00:28:05","MSL-RAD-Surface",,"Curiosity"',
  '"2024-06-03T10:06:06","MSL-RAD-Surface",10,"Curiosity"',
  '',
].join('\n');

const okResponse = (body: string) => new Response(body, { status: 200 });

describe('parseRadCsv', () => {
  it('averages non-blank absorbed_dose_rate values and reports the time span', () => {
    expect(parseRadCsv(CSV)).toEqual({ meanUGyPerHour: 8, samples: 2, from: '2015-01-01T00:11:01', to: '2024-06-03T10:06:06' });
  });

  it('finds columns by header name regardless of order', () => {
    const csv = 'absorbed_dose_rate,timestamp\n4,"2020-01-01"\n';
    expect(parseRadCsv(csv).meanUGyPerHour).toBe(4);
  });

  it('throws when there is no dose column or no samples', () => {
    expect(() => parseRadCsv('timestamp,flux\n1,2')).toThrow('absorbed_dose_rate');
    expect(() => parseRadCsv('absorbed_dose_rate\n\n')).toThrow('no absorbed_dose_rate samples');
  });
});

describe('fetchRadLabDoseRate', () => {
  it('converts mean µGy/h to mSv/day with the quality factor', async () => {
    const r = await fetchRadLabDoseRate({ fetchImpl: async () => okResponse(CSV) });
    expect(r.source).toBe('radlab');
    expect(r.absorbedMGyPerDay).toBeCloseTo(0.192);
    expect(r.doseRateMSvPerDay).toBeCloseTo(0.192 * QUALITY_FACTOR);
  });

  it('retries after a connection reset', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(okResponse(CSV));
    const r = await fetchRadLabDoseRate({ fetchImpl: f, retries: 2 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.samples).toBe(2);
  });

  it('gives up after the retry budget', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(fetchRadLabDoseRate({ fetchImpl: f, retries: 3 })).rejects.toThrow('after 3 attempts');
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('loadRadiation', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const tmpCache = () => {
    dir = mkdtempSync(path.join(tmpdir(), 'radlab-'));
    return path.join(dir, 'sub', 'radlab.json');
  };

  it('starts on the fallback, then updates in place and writes the cache', async () => {
    const cachePath = tmpCache();
    const store = await loadRadiation({ cachePath, disabled: false, fetchImpl: async () => okResponse(CSV) });
    const live = store.current;
    await vi.waitFor(() => expect(live.source).toBe('radlab'));
    expect(live.doseRateMSvPerDay).toBeCloseTo(0.192 * QUALITY_FACTOR);
    await vi.waitFor(() => expect(JSON.parse(readFileSync(cachePath, 'utf8')).source).toBe('radlab'));
  });

  it('uses the cache without touching the network', async () => {
    const cachePath = tmpCache();
    const f = vi.fn();
    await loadRadiation({ cachePath, disabled: false, fetchImpl: async () => okResponse(CSV) }).then((s) => s.refresh());
    const store = await loadRadiation({ cachePath, disabled: false, fetchImpl: f });
    expect(store.current.source).toBe('cache');
    expect(f).not.toHaveBeenCalled();
  });

  it('keeps the fallback when RadLab is unreachable', async () => {
    const cachePath = tmpCache();
    writeFileSync(path.join(dir, 'unused'), '');
    const store = await loadRadiation({ cachePath, disabled: false, retries: 1, fetchImpl: async () => Promise.reject(new Error('down')) });
    await vi.waitFor(() => expect(store.current.note).toContain('down'));
    expect(store.current.source).toBe('fallback');
    expect(store.current.doseRateMSvPerDay).toBe(FALLBACK_DOSE_RATE_MSV_PER_DAY);
  });
});
