import path from 'node:path';
import type { PointInput, RasterStats, Sample, Waypoint } from '../../shared/types.ts';
import { FILES } from '../config.ts';
import { loadRaster, type Raster } from './geotiff.ts';
import { loadWaypoints } from './gpkg.ts';
import { gridBounds, inBounds, pixelCenter, sameGrid, worldToPixel, type GridTransform } from './transform.ts';

export class BadRequestError extends Error {
  readonly statusCode = 400;
}

export interface ResolvedPoint {
  x: number;
  y: number;
  row: number;
  col: number;
}

/** Values below this are treated as missing (covers PDS MISSING_CONSTANT ≈ -3.4e38). */
const MIN_PLAUSIBLE = -1e30;

function isMissing(v: number, nodata: number | null): boolean {
  return !Number.isFinite(v) || v === nodata || v < MIN_PLAUSIBLE;
}

function stats(data: Float32Array, valid: Uint8Array): RasterStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (!valid[i]) continue;
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return { min, max, mean: n ? sum / n : NaN };
}

/** Elevation + slope rasters on a shared pixel grid, plus the START/END waypoints. */
export class Terrain {
  readonly transform: GridTransform;
  /** 1 where both elevation and slope are present. */
  readonly valid: Uint8Array;
  readonly validCount: number;
  readonly elevationStats: RasterStats;
  readonly slopeStats: RasterStats;
  readonly waypoints: Waypoint[];

  constructor(
    readonly elevation: Raster,
    readonly slope: Raster,
    rawWaypoints: { name: string; x: number; y: number }[],
    readonly crsName: string | null = null,
    readonly crsWkt: string | null = null,
  ) {
    if (!sameGrid(elevation, slope)) {
      throw new Error('Elevation and slope rasters do not share the same pixel grid');
    }
    this.transform = {
      width: elevation.width,
      height: elevation.height,
      originX: elevation.originX,
      originY: elevation.originY,
      resX: elevation.resX,
      resY: elevation.resY,
    };

    const n = elevation.width * elevation.height;
    this.valid = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!isMissing(elevation.data[i], elevation.nodata) && !isMissing(slope.data[i], slope.nodata)) {
        this.valid[i] = 1;
        count++;
      }
    }
    this.validCount = count;
    this.elevationStats = stats(elevation.data, this.valid);
    this.slopeStats = stats(slope.data, this.valid);

    this.waypoints = rawWaypoints.map((w) => {
      const { row, col } = worldToPixel(this.transform, w.x, w.y);
      const s = this.sampleAt(row, col);
      return { name: w.name, x: w.x, y: w.y, row, col, elevation: s.elevation, slope: s.slope };
    });
  }

  static async load(dataDir: string): Promise<Terrain> {
    const [elevation, slope] = await Promise.all([
      loadRaster(path.join(dataDir, FILES.elevation)),
      loadRaster(path.join(dataDir, FILES.slope)),
    ]);
    const wp = loadWaypoints(path.join(dataDir, FILES.waypoints));
    return new Terrain(elevation, slope, wp.points, wp.crsName, wp.crsWkt);
  }

  get width() {
    return this.transform.width;
  }
  get height() {
    return this.transform.height;
  }
  get pixelSize() {
    return Math.abs(this.transform.resX);
  }
  get bounds() {
    return gridBounds(this.transform);
  }

  inBounds(row: number, col: number) {
    return inBounds(this.transform, row, col);
  }

  isValid(row: number, col: number): boolean {
    return this.inBounds(row, col) && this.valid[row * this.width + col] === 1;
  }

  /** Values at a pixel; null for out-of-bounds or NoData. */
  sampleAt(row: number, col: number): Sample {
    const { x, y } = pixelCenter(this.transform, row, col);
    if (!this.isValid(row, col)) return { x, y, row, col, elevation: null, slope: null, valid: false };
    const i = row * this.width + col;
    return { x, y, row, col, elevation: this.elevation.data[i], slope: this.slope.data[i], valid: true };
  }

  sampleWorld(x: number, y: number): Sample {
    const { row, col } = worldToPixel(this.transform, x, y);
    return { ...this.sampleAt(row, col), x, y };
  }

  /** Normalises a {x,y} or {row,col} input; throws BadRequestError if outside the raster. */
  resolvePoint(p: PointInput, label = 'point'): ResolvedPoint {
    let r: ResolvedPoint;
    if ('x' in p) {
      r = { x: p.x, y: p.y, ...worldToPixel(this.transform, p.x, p.y) };
    } else {
      r = { row: p.row, col: p.col, ...pixelCenter(this.transform, p.row, p.col) };
    }
    if (!this.inBounds(r.row, r.col)) {
      throw new BadRequestError(`${label} (${r.x.toFixed(2)}, ${r.y.toFixed(2)}) is outside the terrain raster`);
    }
    return r;
  }
}
