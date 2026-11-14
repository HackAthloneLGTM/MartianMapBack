import { describe, expect, it } from 'vitest';
import type { Raster } from '../src/data/geotiff.ts';
import { Terrain } from '../src/data/terrain.ts';
import { RoutePlanner } from '../src/routing/planner.ts';

/** Flat synthetic terrain with 1 m pixels; `slopeAt` overrides individual pixels. */
function syntheticTerrain(width: number, height: number, slopeAt: Record<string, number> = {}): Terrain {
  const n = width * height;
  const grid = { width, height, originX: 0, originY: height, resX: 1, resY: -1, nodata: -9999 };
  const elevation: Raster = { ...grid, data: new Float32Array(n) };
  const slope: Raster = { ...grid, data: new Float32Array(n) };
  for (const [key, deg] of Object.entries(slopeAt)) {
    const [r, c] = key.split(',').map(Number);
    slope.data[r * width + c] = deg;
  }
  return new Terrain(elevation, slope, []);
}

describe('RoutePlanner slope warnings', () => {
  it('reports a steep patch inside a routing cell even when the cell centre is flat', () => {
    // One row of three 4×4 cells. The middle cell (cols 4–7) has a 12° pixel at (0,4);
    // its centre pixel (2,6) is flat. A* costs the cell by its max slope, so warnings must too.
    const terrain = syntheticTerrain(12, 4, { '0,4': 12 });
    const r = new RoutePlanner(terrain).plan({ row: 2, col: 1 }, { row: 2, col: 10 }, { cellSize: 4 });
    expect(r.found).toBe(true);
    const steep = r.warnings.find((w) => w.code === 'STEEP_SECTION');
    expect(steep).toBeDefined();
    expect(steep!.message).toContain('12.0°');
  });

  it('gives no steep warning on flat ground', () => {
    const terrain = syntheticTerrain(12, 4);
    const r = new RoutePlanner(terrain).plan({ row: 2, col: 1 }, { row: 2, col: 10 }, { cellSize: 4 });
    expect(r.warnings.filter((w) => w.code === 'STEEP_SECTION')).toEqual([]);
  });
});
