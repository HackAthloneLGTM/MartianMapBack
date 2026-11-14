import type {
  PointInput,
  RadiationSource,
  RouteOptions,
  RoutePoint,
  RouteResponse,
  RouteWarning,
  StraightLineMetrics,
} from '../../shared/types.ts';
import { evaLimits, pathMetrics } from '../analysis/eva.ts';
import { CELL_SIZE_LIMITS, DEFAULT_OPTIONS } from '../config.ts';
import { fallbackRadiation } from '../data/radlab.ts';
import { BadRequestError, type ResolvedPoint, type Terrain } from '../data/terrain.ts';
import { pixelToWorld } from '../data/transform.ts';
import { astar } from './astar.ts';
import { buildCostGrid, GridCache, multiplierFor, type AggregatedGrid } from './grid.ts';

export function resolveOptions(partial: Partial<RouteOptions> = {}, defaults: RouteOptions = DEFAULT_OPTIONS): RouteOptions {
  const o: RouteOptions = { ...defaults, ...partial };
  o.slopeClasses = [...(partial.slopeClasses ?? defaults.slopeClasses)].sort((a, b) => a.maxDeg - b.maxDeg);
  if (o.slopeClasses.length === 0) throw new BadRequestError('slopeClasses must not be empty');
  for (const c of o.slopeClasses) {
    if (c.multiplier !== null && !(c.multiplier > 0)) throw new BadRequestError('slope multipliers must be > 0 or null');
    if (!(c.maxDeg >= 0 && c.maxDeg <= 90)) throw new BadRequestError('slope class maxDeg must be between 0 and 90');
  }
  if (!(o.cellSize >= CELL_SIZE_LIMITS.min && o.cellSize <= CELL_SIZE_LIMITS.max)) {
    throw new BadRequestError(`cellSize must be between ${CELL_SIZE_LIMITS.min} and ${CELL_SIZE_LIMITS.max} m`);
  }
  if (!(o.walkingSpeedKmh > 0)) throw new BadRequestError('walkingSpeedKmh must be > 0');
  if (o.scienceStopMin < 0 || o.doseRateMSvPerDay < 0 || o.uphillPenalty < 0) {
    throw new BadRequestError('scienceStopMin, doseRateMSvPerDay and uphillPenalty must be >= 0');
  }
  if (!(o.doseLimitMSv > 0) || !(o.maxEvaMinutes > 0)) {
    throw new BadRequestError('doseLimitMSv and maxEvaMinutes must be > 0');
  }
  return o;
}

export class RoutePlanner {
  private grids: GridCache;
  private readonly terrain: Terrain;
  /** Live object; a background RadLab refresh updates it in place. */
  readonly radiation: RadiationSource;

  constructor(terrain: Terrain, radiation: RadiationSource = fallbackRadiation()) {
    this.terrain = terrain;
    this.radiation = radiation;
    this.grids = new GridCache(terrain);
  }

  /** DEFAULT_OPTIONS with the current RadLab dose rate. */
  defaults(): RouteOptions {
    return { ...DEFAULT_OPTIONS, doseRateMSvPerDay: this.radiation.doseRateMSvPerDay };
  }

  plan(startIn: PointInput, endIn: PointInput, partial?: Partial<RouteOptions>): RouteResponse {
    const t0 = performance.now();
    const o = resolveOptions(partial, this.defaults());
    const T = this.terrain;
    const start = T.resolvePoint(startIn, 'start');
    const end = T.resolvePoint(endIn, 'end');
    const warnings: RouteWarning[] = [];

    const factor = Math.max(1, Math.round(o.cellSize / T.pixelSize));
    const agg = this.grids.get(factor, o.aggregation);
    const grid = buildCostGrid(agg, o.slopeClasses);
    const finite = o.slopeClasses.map((c) => c.multiplier).filter((m): m is number => m !== null);
    const minMult = finite.length ? Math.min(...finite) : 1;
    const maxMult = finite.length ? Math.max(...finite) : 1;

    const sIdx = Math.floor(start.row / factor) * agg.width + Math.floor(start.col / factor);
    const eIdx = Math.floor(end.row / factor) * agg.width + Math.floor(end.col / factor);

    // Let the astronaut leave/arrive even if the endpoint cell itself is rated impassable.
    if (grid.cost[sIdx] === Infinity) {
      grid.cost[sIdx] = maxMult;
      warnings.push({ code: 'START_BLOCKED', message: 'Start lies on very steep terrain or NoData; route begins there anyway.' });
    }
    if (grid.cost[eIdx] === Infinity) {
      grid.cost[eIdx] = maxMult;
      warnings.push({ code: 'END_BLOCKED', message: 'End lies on very steep terrain or NoData; route ends there anyway.' });
    }

    const result = astar(grid, sIdx, eIdx, { uphillPenalty: o.uphillPenalty, minMultiplier: minMult });

    let path: RoutePoint[] = [];
    let metrics = null;
    if (result.path) {
      if (result.path.length === 1) {
        warnings.push({ code: 'SAME_CELL', message: 'Start and end fall in the same routing cell.' });
      }
      const inner = result.path.slice(1, -1).map((idx) => this.cellCenter(agg, idx));
      path = [start, ...inner, end].map((p) => this.toRoutePoint(p));
      metrics = pathMetrics(path, o);
      warnings.push(...this.slopeWarnings(path, agg, o));
    } else {
      warnings.push({
        code: 'NO_ROUTE',
        message: 'No route found that avoids impassable slopes and NoData. Try relaxing slope classes or a smaller cellSize.',
      });
    }

    const straightLine = this.straightLine(start, end, o);
    if (straightLine.metrics.blockedSamples > 0) {
      warnings.push({
        code: 'STRAIGHT_LINE_BLOCKED',
        message: `The straight line crosses impassable terrain at ${straightLine.metrics.blockedSamples} of ${straightLine.metrics.totalSamples} samples.`,
      });
    }

    const eva = evaLimits(o, metrics?.distance2d ?? null);
    if (eva.routeFraction !== null && eva.routeFraction > 1) {
      warnings.push({
        code: 'EXCEEDS_EVA_LIMIT',
        message: `Route is ${metrics!.distance2d.toFixed(0)} m one-way but the ${eva.limitedBy === 'dose' ? `${o.doseLimitMSv} mSv dose budget` : `${o.maxEvaMinutes} min EVA cap`} allows at most ${eva.maxOneWayDistanceM.toFixed(0)} m.`,
        fromDistance: eva.maxOneWayDistanceM,
        toDistance: metrics!.distance2d,
      });
    }

    return {
      found: result.path !== null,
      path,
      metrics,
      straightLine,
      warnings,
      options: o,
      eva,
      radiation: { ...this.radiation },
      stats: {
        computeMs: performance.now() - t0,
        gridWidth: agg.width,
        gridHeight: agg.height,
        cellsExpanded: result.expanded,
      },
    };
  }

  /** World position of a routing cell's centre, clamped to the raster for partial edge cells. */
  private cellCenter(agg: AggregatedGrid, idx: number): ResolvedPoint {
    const gr = Math.floor(idx / agg.width);
    const gc = idx - gr * agg.width;
    const T = this.terrain;
    const rowF = Math.min(gr * agg.factor + agg.factor / 2, T.height - 0.5);
    const colF = Math.min(gc * agg.factor + agg.factor / 2, T.width - 0.5);
    const { x, y } = pixelToWorld(T.transform, rowF, colF);
    return { x, y, row: Math.floor(rowF), col: Math.floor(colF) };
  }

  private toRoutePoint(p: ResolvedPoint): RoutePoint {
    const s = this.terrain.sampleAt(p.row, p.col);
    return { x: p.x, y: p.y, row: p.row, col: p.col, elevation: s.elevation, slope: s.slope, distance: 0 };
  }

  /** Samples the direct line at native resolution for the "as the crow flies" comparison. */
  private straightLine(a: ResolvedPoint, b: ResolvedPoint, o: RouteOptions): { path: RoutePoint[]; metrics: StraightLineMetrics } {
    const T = this.terrain;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / T.pixelSize));
    const path: RoutePoint[] = [];
    let blocked = 0;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const s = T.sampleWorld(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      // Same rule A* uses: impassable when no class gives a multiplier (incl. slopes above every class).
      if (!s.valid || s.slope === null || multiplierFor(s.slope, o.slopeClasses) === null) blocked++;
      path.push({ x: s.x, y: s.y, row: s.row, col: s.col, elevation: s.elevation, slope: s.slope, distance: 0 });
    }
    const m = pathMetrics(path, o);
    return { path, metrics: { ...m, blockedSamples: blocked, totalSamples: path.length } };
  }

  /**
   * Groups consecutive route points on steep (multiplier ≥ 2) or impassable terrain into warnings.
   * Uses the aggregated cell slope (what A* actually costed), not the single native pixel at the point,
   * so a steep patch inside a cell is reported even when the cell's centre pixel is flat.
   */
  private slopeWarnings(path: RoutePoint[], agg: AggregatedGrid, o: RouteOptions): RouteWarning[] {
    const out: RouteWarning[] = [];
    const cellSlope = (p: RoutePoint): number | null => {
      const s = agg.slope[Math.floor(p.row / agg.factor) * agg.width + Math.floor(p.col / agg.factor)];
      return Number.isNaN(s) ? null : s;
    };
    const kindOf = (slope: number | null): 'STEEP_SECTION' | 'IMPASSABLE_SECTION' | null => {
      if (slope === null) return null;
      const m = multiplierFor(slope, o.slopeClasses);
      if (m === null) return 'IMPASSABLE_SECTION';
      return m >= 2 ? 'STEEP_SECTION' : null;
    };
    let run: { kind: 'STEEP_SECTION' | 'IMPASSABLE_SECTION'; from: number; to: number; max: number } | null = null;
    const flush = () => {
      if (!run) return;
      out.push({
        code: run.kind,
        message: `${run.kind === 'STEEP_SECTION' ? 'Steep' : 'Impassable-rated'} terrain (up to ${run.max.toFixed(1)}°) from ${run.from.toFixed(0)} m to ${run.to.toFixed(0)} m.`,
        fromDistance: run.from,
        toDistance: run.to,
      });
      run = null;
    };
    for (const p of path) {
      const slope = cellSlope(p);
      const k = kindOf(slope);
      if (k && run && run.kind === k) {
        run.to = p.distance;
        run.max = Math.max(run.max, slope!);
      } else {
        flush();
        if (k) run = { kind: k, from: p.distance, to: p.distance, max: slope! };
      }
    }
    flush();
    return out;
  }
}
