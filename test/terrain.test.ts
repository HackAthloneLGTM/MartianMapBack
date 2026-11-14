import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DATA_DIR, FILES } from '../src/config.ts';
import { Terrain } from '../src/data/terrain.ts';
import { RoutePlanner } from '../src/routing/planner.ts';

const hasData = existsSync(path.join(DATA_DIR, FILES.elevation));

describe.skipIf(!hasData)('Jezero terrain (real data)', () => {
  let terrain: Terrain;
  beforeAll(async () => {
    terrain = await Terrain.load(DATA_DIR);
  });

  it('loads matching 1135×1100 rasters at ~1.01 m', () => {
    expect(terrain.width).toBe(1135);
    expect(terrain.height).toBe(1100);
    expect(terrain.pixelSize).toBeCloseTo(1.0097, 3);
  });

  it('has the documented value ranges', () => {
    expect(terrain.elevationStats.min).toBeCloseTo(-2643.08, 1);
    expect(terrain.elevationStats.max).toBeCloseTo(-2608.33, 1);
    expect(terrain.slopeStats.max).toBeCloseTo(50.08, 1);
  });

  it('reads START/END from the GeoPackage and maps them to pixels', () => {
    const start = terrain.waypoints.find((w) => w.name === 'START')!;
    const end = terrain.waypoints.find((w) => w.name === 'END')!;
    expect(start.x).toBeCloseTo(1489.3703, 3);
    expect(start.y).toBeCloseTo(1090328.6568, 3);
    expect([start.row, start.col]).toEqual([255, 851]);
    expect([end.row, end.col]).toEqual([755, 578]);
    expect(start.elevation).toBeCloseTo(-2619.06, 1);
    expect(start.slope).toBeCloseTo(4.08, 1);
    expect(end.elevation).toBeCloseTo(-2628.23, 1);
    expect(end.slope).toBeCloseTo(1.8, 1);
  });

  it('finds a slope-aware route longer than the 575 m straight line', () => {
    const start = terrain.waypoints.find((w) => w.name === 'START')!;
    const end = terrain.waypoints.find((w) => w.name === 'END')!;
    const r = new RoutePlanner(terrain).plan(start, end);
    expect(r.found).toBe(true);
    expect(r.straightLine.metrics.distance2d).toBeCloseTo(575, -1);
    expect(r.metrics!.distance2d).toBeGreaterThan(r.straightLine.metrics.distance2d);
    expect(r.warnings.find((w) => w.code === 'IMPASSABLE_SECTION')).toBeUndefined();
    expect(r.metrics!.totalEvaMinutes).toBeGreaterThan(30 + 2 * 34);
  });
});
