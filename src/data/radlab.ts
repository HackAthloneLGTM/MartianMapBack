import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RadiationSource } from '../../shared/types.ts';

/** NASA OSDR RadLab: every Curiosity RAD surface reading of absorbed dose rate (µGy/h). */
export const RADLAB_URL =
  'https://visualization.osdr.nasa.gov/radlab/api/?spacecraft=Curiosity&absorbed_dose_rate&format=csv';

/**
 * RadLab only serves absorbed dose (Gy) for Curiosity, so dose equivalent (Sv) uses an average quality
 * factor: Hassler et al. 2014 (Science 343) measured 0.21 mGy/day → 0.64 mSv/day at Gale, Q ≈ 3.05.
 */
export const QUALITY_FACTOR = 3.05;

/** GUIDE.txt baseline (Curiosity RAD, Gale Crater), used when RadLab is unreachable and nothing is cached. */
export const FALLBACK_DOSE_RATE_MSV_PER_DAY = 0.67;

export const DEFAULT_CACHE_PATH = path.resolve('.cache', 'radlab.json');

export interface RadCsvSummary {
  meanUGyPerHour: number;
  samples: number;
  from: string | null;
  to: string | null;
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

/** Mean absorbed dose rate from a RadLab CSV; columns are located by header name, blank values skipped. */
export function parseRadCsv(text: string): RadCsvSummary {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map(unquote);
  const doseCol = header.indexOf('absorbed_dose_rate');
  const timeCol = header.indexOf('timestamp');
  if (doseCol < 0) throw new Error('RadLab CSV has no absorbed_dose_rate column');

  let sum = 0;
  let n = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(',');
    const raw = unquote(cells[doseCol] ?? '');
    if (raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
    if (timeCol >= 0) {
      const t = unquote(cells[timeCol] ?? '');
      if (t) {
        if (from === null || t < from) from = t;
        if (to === null || t > to) to = t;
      }
    }
  }
  if (n === 0) throw new Error('RadLab CSV contains no absorbed_dose_rate samples');
  return { meanUGyPerHour: sum / n, samples: n, from, to };
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  url?: string;
}

/** Downloads the full Curiosity RAD record and converts its mean to mSv/day. Retries on network errors. */
export async function fetchRadLabDoseRate(opts: FetchOptions = {}): Promise<RadiationSource> {
  const { fetchImpl = fetch, timeoutMs = 120_000, retries = 3, url = RADLAB_URL } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`RadLab HTTP ${res.status}`);
      const s = parseRadCsv(await res.text());
      const absorbedMGyPerDay = (s.meanUGyPerHour * 24) / 1000;
      return {
        doseRateMSvPerDay: absorbedMGyPerDay * QUALITY_FACTOR,
        absorbedMGyPerDay,
        qualityFactor: QUALITY_FACTOR,
        samples: s.samples,
        from: s.from,
        to: s.to,
        source: 'radlab',
        fetchedAt: new Date().toISOString(),
        note: `Mean of ${s.samples} Curiosity RAD surface readings (Gale Crater) from NASA RadLab × Q=${QUALITY_FACTOR}. Historical average, not a live Jezero measurement.`,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`RadLab fetch failed after ${retries} attempts: ${(lastErr as Error)?.message ?? lastErr}`);
}

export function fallbackRadiation(reason = 'RadLab not loaded yet'): RadiationSource {
  return {
    doseRateMSvPerDay: FALLBACK_DOSE_RATE_MSV_PER_DAY,
    absorbedMGyPerDay: null,
    qualityFactor: null,
    samples: 0,
    from: null,
    to: null,
    source: 'fallback',
    fetchedAt: null,
    note: `${reason}; using the 0.67 mSv/day Curiosity RAD historical average from the project guide.`,
  };
}

export interface RadiationStore {
  /** Live object: refresh() updates it in place so holders always see the latest value. */
  readonly current: RadiationSource;
  refresh(): Promise<RadiationSource>;
}

export interface LoadOptions extends FetchOptions {
  cachePath?: string;
  /** Skip the network entirely (env RADLAB=off). */
  disabled?: boolean;
}

/**
 * Returns immediately: cached RadLab value if present, otherwise the fallback while a background
 * fetch runs. A successful fetch is written to the cache so later starts don't need the network.
 */
export async function loadRadiation(opts: LoadOptions = {}): Promise<RadiationStore> {
  const { cachePath = DEFAULT_CACHE_PATH, disabled = process.env.RADLAB === 'off', ...fetchOpts } = opts;
  const current: RadiationSource = fallbackRadiation(disabled ? 'RadLab disabled (RADLAB=off)' : undefined);

  let cached = false;
  try {
    const c = JSON.parse(await readFile(cachePath, 'utf8')) as RadiationSource;
    if (Number.isFinite(c.doseRateMSvPerDay) && c.doseRateMSvPerDay >= 0) {
      Object.assign(current, c, { source: 'cache' });
      cached = true;
    }
  } catch {
    // no cache or unreadable: keep the fallback
  }

  // One download at a time: concurrent refresh() calls share the in-flight promise.
  let inFlight: Promise<RadiationSource> | null = null;
  const doRefresh = async (): Promise<RadiationSource> => {
    const fresh = await fetchRadLabDoseRate(fetchOpts);
    Object.assign(current, fresh);
    try {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(fresh, null, 2));
    } catch (err) {
      current.note += ` (cache not written: ${(err as Error).message})`;
    }
    return current;
  };

  const store: RadiationStore = {
    current,
    refresh() {
      if (disabled) return Promise.resolve(current);
      inFlight ??= doRefresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };

  if (!cached && !disabled) {
    store.refresh().catch((err: Error) => {
      current.note = `${err.message}; using the 0.67 mSv/day Curiosity RAD historical average from the project guide.`;
    });
  }
  return store;
}
