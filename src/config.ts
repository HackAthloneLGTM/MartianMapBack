import path from 'node:path';
import type { RouteOptions } from '../shared/types.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? '0.0.0.0';

export const FILES = {
  elevation: 'jezero_elevation_crop.tif',
  slope: 'jezero_slope_crop.tif',
  waypoints: 'waypoints.gpkg',
} as const;

/** Project assumptions for demonstration — not official NASA safety limits. */
export const DEFAULT_OPTIONS: RouteOptions = {
  cellSize: 4,
  aggregation: 'max',
  slopeClasses: [
    { maxDeg: 5, multiplier: 1.0, label: 'Low slope' },
    { maxDeg: 10, multiplier: 1.5, label: 'Moderate' },
    { maxDeg: 15, multiplier: 3.0, label: 'Steep' },
    { maxDeg: 90, multiplier: null, label: 'Very steep' },
  ],
  uphillPenalty: 0,
  walkingSpeedKmh: 1,
  scienceStopMin: 30,
  returnTrip: true,
  // Curiosity RAD, Gale Crater — historical average, not a live Jezero measurement.
  doseRateMSvPerDay: 0.67,
};

export const CELL_SIZE_LIMITS = { min: 1, max: 50 } as const;
