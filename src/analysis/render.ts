import { PNG } from 'pngjs';
import type { SlopeClass } from '../../shared/types.ts';
import type { Terrain } from '../data/terrain.ts';
import { classIndexFor } from '../routing/grid.ts';

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];


const ELEVATION_RAMP: [number, RGB][] = [
  [0, hex('#2b83ba')],
  [0.25, hex('#abdda4')],
  [0.5, hex('#ffffbf')],
  [0.75, hex('#fdae61')],
  [1, hex('#d7191c')],
];

const SLOPE_COLORS: RGB[] = ['#1a9641', '#a6d96a', '#fdae61', '#d7191c'].map(hex);

function ramp(t: number): RGB {
  for (let i = 1; i < ELEVATION_RAMP.length; i++) {
    const [t1, c1] = ELEVATION_RAMP[i];
    if (t <= t1) {
      const [t0, c0] = ELEVATION_RAMP[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as RGB;
    }
  }
  return ELEVATION_RAMP[ELEVATION_RAMP.length - 1][1];
}

function encode(terrain: Terrain, colorAt: (i: number) => RGB): Buffer {
  const { width, height } = terrain;
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (!terrain.valid[i]) {
      png.data[o + 3] = 0; // NoData → transparent
      continue;
    }
    const [r, g, b] = colorAt(i);
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

function colorFor(terrain: Terrain, kind: 'elevation' | 'slope', index: number, classes: SlopeClass[]): RGB | null {
  if (!terrain.valid[index]) return null;
  if (kind === 'elevation') {
    const span = terrain.elevationStats.max - terrain.elevationStats.min || 1;
    return ramp((terrain.elevation.data[index] - terrain.elevationStats.min) / span);
  }
  return SLOPE_COLORS[Math.min(classIndexFor(terrain.slope.data[index], classes), SLOPE_COLORS.length - 1)];
}

/**
 * Renders an XYZ tile where z=0 contains the complete raster and each zoom
 * level doubles the raster's tile subdivision.
 */
export function renderTile(
  terrain: Terrain,
  kind: 'elevation' | 'slope',
  z: number,
  x: number,
  y: number,
  classes: SlopeClass[],
  tileSize = 256,
): Buffer {
  const png = new PNG({ width: tileSize, height: tileSize });
  const tiles = 2 ** z;
  const rasterX0 = (x / tiles) * terrain.width;
  const rasterY0 = (y / tiles) * terrain.height;
  const rasterScaleX = terrain.width / tiles / tileSize;
  const rasterScaleY = terrain.height / tiles / tileSize;

  for (let py = 0; py < tileSize; py++) {
    for (let px = 0; px < tileSize; px++) {
      const col = Math.floor(rasterX0 + px * rasterScaleX);
      const row = Math.floor(rasterY0 + py * rasterScaleY);
      if (!terrain.inBounds(row, col)) continue;
      const color = colorFor(terrain, kind, row * terrain.width + col, classes);
      if (!color) continue;
      const offset = (py * tileSize + px) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export function renderElevation(terrain: Terrain): Buffer {
  return encode(terrain, (i) => colorFor(terrain, 'elevation', i, [])!);
}

export function renderSlope(terrain: Terrain, classes: SlopeClass[]): Buffer {
  return encode(terrain, (i) => colorFor(terrain, 'slope', i, classes)!);
}
