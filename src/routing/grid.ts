import type { Aggregation, SlopeClass } from '../../shared/types.ts';
import type { Terrain } from '../data/terrain.ts';

/** Terrain resampled to routing cells of `factor`×`factor` native pixels. NaN = NoData. */
export interface AggregatedGrid {
  factor: number;
  width: number;
  height: number;
  /** Cell size in metres. */
  cellX: number;
  cellY: number;
  slope: Float32Array;
  elevation: Float32Array;
}

/** A grid ready for A*: per-cell difficulty multiplier, Infinity = impassable. */
export interface CostGrid {
  width: number;
  height: number;
  cellX: number;
  cellY: number;
  cost: Float32Array;
  elevation?: Float32Array;
}

/**
 * Downsamples the native rasters. Slope uses a conservative statistic ('max' by default) so
 * narrow steep barriers survive; any NoData pixel makes the whole cell NoData.
 */
export function aggregate(terrain: Terrain, factor: number, aggregation: Aggregation): AggregatedGrid {
  const W = terrain.width;
  const H = terrain.height;
  const width = Math.ceil(W / factor);
  const height = Math.ceil(H / factor);
  const slope = new Float32Array(width * height);
  const elevation = new Float32Array(width * height);
  const sSrc = terrain.slope.data;
  const eSrc = terrain.elevation.data;
  const valid = terrain.valid;
  const scratch: number[] = [];

  for (let gr = 0; gr < height; gr++) {
    const r0 = gr * factor;
    const r1 = Math.min(r0 + factor, H);
    for (let gc = 0; gc < width; gc++) {
      const c0 = gc * factor;
      const c1 = Math.min(c0 + factor, W);
      let ok = true;
      let maxS = -Infinity;
      let sumE = 0;
      scratch.length = 0;
      for (let r = r0; r < r1 && ok; r++) {
        for (let c = c0; c < c1; c++) {
          const i = r * W + c;
          if (!valid[i]) {
            ok = false;
            break;
          }
          const s = sSrc[i];
          if (s > maxS) maxS = s;
          sumE += eSrc[i];
          if (aggregation === 'p90') scratch.push(s);
        }
      }
      const gi = gr * width + gc;
      if (!ok) {
        slope[gi] = NaN;
        elevation[gi] = NaN;
        continue;
      }
      if (aggregation === 'p90' && scratch.length > 1) {
        scratch.sort((a, b) => a - b);
        slope[gi] = scratch[Math.min(scratch.length - 1, Math.floor(0.9 * scratch.length))];
      } else {
        slope[gi] = maxS;
      }
      elevation[gi] = sumE / ((r1 - r0) * (c1 - c0));
    }
  }

  const px = Math.abs(terrain.transform.resX);
  const py = Math.abs(terrain.transform.resY);
  return { factor, width, height, cellX: px * factor, cellY: py * factor, slope, elevation };
}

/** Classes must be sorted by maxDeg ascending. Returns null when impassable. */
export function multiplierFor(slopeDeg: number, classes: SlopeClass[]): number | null {
  for (const c of classes) if (slopeDeg <= c.maxDeg) return c.multiplier;
  return null;
}

export function classIndexFor(slopeDeg: number, classes: SlopeClass[]): number {
  for (let i = 0; i < classes.length; i++) if (slopeDeg <= classes[i].maxDeg) return i;
  return classes.length - 1;
}

/** Lowest slope (deg) at which terrain becomes impassable, or Infinity if never. */
export function blockingThreshold(classes: SlopeClass[]): number {
  let prev = 0;
  for (const c of classes) {
    if (c.multiplier === null) return prev;
    prev = c.maxDeg;
  }
  return Infinity;
}

export function buildCostGrid(agg: AggregatedGrid, classes: SlopeClass[]): CostGrid {
  const cost = new Float32Array(agg.slope.length);
  for (let i = 0; i < cost.length; i++) {
    const s = agg.slope[i];
    const m = Number.isNaN(s) ? null : multiplierFor(s, classes);
    cost[i] = m === null ? Infinity : m;
  }
  return { width: agg.width, height: agg.height, cellX: agg.cellX, cellY: agg.cellY, cost, elevation: agg.elevation };
}

/** Caches aggregated grids per (factor, aggregation) — building one touches every native pixel. */
export class GridCache {
  private cache = new Map<string, AggregatedGrid>();
  constructor(private terrain: Terrain) {}

  get(factor: number, aggregation: Aggregation): AggregatedGrid {
    const key = `${factor}|${aggregation}`;
    let g = this.cache.get(key);
    if (!g) {
      g = aggregate(this.terrain, factor, aggregation);
      this.cache.set(key, g);
    }
    return g;
  }
}
