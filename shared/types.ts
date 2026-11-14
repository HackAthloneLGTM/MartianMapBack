/**
 * Types shared between the backend and the webapp.
 * All coordinates are in the raster CRS ("EQUIRECTANGULAR MARS"), in metres — NOT lat/lon.
 */

export interface WorldPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  row: number;
  col: number;
}

/** A route endpoint may be given either in map metres or as a raster pixel. */
export type PointInput = WorldPoint | PixelPoint;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SlopeClass {
  /** Upper bound (inclusive) of this class, in degrees. */
  maxDeg: number;
  /** Terrain difficulty multiplier; null = impassable. */
  multiplier: number | null;
  label: string;
}

export type Aggregation = 'max' | 'p90';

export interface RouteOptions {
  /** Routing grid cell size in metres (native ≈ 1.01 m). */
  cellSize: number;
  /** How native slope pixels are combined into a routing cell. 'max' never erases narrow barriers. */
  aggregation: Aggregation;
  slopeClasses: SlopeClass[];
  /** Extra cost (in metres-equivalent) per metre of climb. 0 disables. */
  uphillPenalty: number;
  walkingSpeedKmh: number;
  scienceStopMin: number;
  returnTrip: boolean;
  doseRateMSvPerDay: number;
  /** Per-EVA radiation budget used for the max-distance limit (demo assumption, not a NASA limit). */
  doseLimitMSv: number;
  /** Hard cap on total EVA duration, including the science stop. */
  maxEvaMinutes: number;
}

/** Where the dose rate came from. `radlab` = fresh NASA RadLab download, `cache` = earlier download. */
export interface RadiationSource {
  doseRateMSvPerDay: number;
  /** Mean absorbed dose from RAD, before the quality factor. */
  absorbedMGyPerDay: number | null;
  qualityFactor: number | null;
  samples: number;
  /** Time span of the averaged RAD readings (ISO timestamps). */
  from: string | null;
  to: string | null;
  source: 'radlab' | 'cache' | 'fallback';
  fetchedAt: string | null;
  note: string;
}

export interface EvaLimits {
  /** Farthest one-way walking distance (metres) that keeps the EVA within both limits. */
  maxOneWayDistanceM: number;
  /** Total EVA minutes allowed (the lower of the dose and time limits). */
  maxTotalMinutes: number;
  limitedBy: 'dose' | 'time';
  /** Minutes until doseLimitMSv is reached at the current dose rate (null when the rate is 0). */
  doseLimitMinutes: number | null;
  /** Route distance ÷ maxOneWayDistanceM; > 1 means the route exceeds the limits. Null without a route or when the max distance is 0. */
  routeFraction: number | null;
}

export interface RasterStats {
  min: number;
  max: number;
  mean: number;
}

export interface Meta {
  width: number;
  height: number;
  pixelSizeX: number;
  pixelSizeY: number;
  /** Raster origin (top-left corner) in map metres. */
  originX: number;
  originY: number;
  bounds: Bounds;
  crsName: string | null;
  crsWkt: string | null;
  nodata: number | null;
  validFraction: number;
  elevation: RasterStats;
  slope: RasterStats;
  defaults: RouteOptions;
}

export interface Waypoint extends WorldPoint, PixelPoint {
  name: string;
  elevation: number | null;
  slope: number | null;
}

export interface Sample extends WorldPoint, PixelPoint {
  elevation: number | null;
  slope: number | null;
  valid: boolean;
}

export interface RoutePoint extends WorldPoint, PixelPoint {
  elevation: number | null;
  slope: number | null;
  /** Cumulative 2D distance from the start, in metres. */
  distance: number;
}

export interface RouteMetrics {
  distance2d: number;
  distance3d: number;
  ascent: number;
  descent: number;
  maxSlope: number;
  meanSlope: number;
  oneWayMinutes: number;
  totalEvaMinutes: number;
  doseMSv: number;
}

export interface StraightLineMetrics extends RouteMetrics {
  /** Samples along the line that fall on impassable slope or NoData. */
  blockedSamples: number;
  totalSamples: number;
}

export type WarningCode =
  | 'NO_ROUTE'
  | 'START_BLOCKED'
  | 'END_BLOCKED'
  | 'STEEP_SECTION'
  | 'IMPASSABLE_SECTION'
  | 'STRAIGHT_LINE_BLOCKED'
  | 'SAME_CELL'
  | 'EXCEEDS_EVA_LIMIT';

export interface RouteWarning {
  code: WarningCode;
  message: string;
  /** Distance range along the route (metres) the warning applies to, if any. */
  fromDistance?: number;
  toDistance?: number;
}

export interface RouteRequest {
  start: PointInput;
  end: PointInput;
  options?: Partial<RouteOptions>;
}

export interface RouteResponse {
  found: boolean;
  path: RoutePoint[];
  metrics: RouteMetrics | null;
  straightLine: {
    path: RoutePoint[];
    metrics: StraightLineMetrics;
  };
  warnings: RouteWarning[];
  options: RouteOptions;
  eva: EvaLimits;
  radiation: RadiationSource;
  stats: {
    computeMs: number;
    gridWidth: number;
    gridHeight: number;
    cellsExpanded: number;
  };
}
