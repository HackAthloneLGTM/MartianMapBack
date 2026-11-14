/** Affine (north-up) mapping between map metres and raster pixels. */
export interface GridTransform {
  width: number;
  height: number;
  /** Map coordinate of the top-left corner of pixel (0,0). */
  originX: number;
  originY: number;
  /** Pixel size; resY is negative for north-up rasters. */
  resX: number;
  resY: number;
}

/** Same convention as rasterio's `src.index(x, y)`: floor of the fractional pixel. */
export function worldToPixel(t: GridTransform, x: number, y: number): { row: number; col: number } {
  return {
    col: Math.floor((x - t.originX) / t.resX),
    row: Math.floor((y - t.originY) / t.resY),
  };
}

/** Map coordinates for a (possibly fractional) pixel position. Integer inputs + 0.5 give the pixel centre. */
export function pixelToWorld(t: GridTransform, row: number, col: number): { x: number; y: number } {
  return {
    x: t.originX + col * t.resX,
    y: t.originY + row * t.resY,
  };
}

export function pixelCenter(t: GridTransform, row: number, col: number): { x: number; y: number } {
  return pixelToWorld(t, row + 0.5, col + 0.5);
}

export function inBounds(t: GridTransform, row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < t.height && col < t.width;
}

export function sameGrid(a: GridTransform, b: GridTransform, eps = 1e-6): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    Math.abs(a.originX - b.originX) < eps &&
    Math.abs(a.originY - b.originY) < eps &&
    Math.abs(a.resX - b.resX) < eps &&
    Math.abs(a.resY - b.resY) < eps
  );
}

export function gridBounds(t: GridTransform) {
  const x0 = t.originX;
  const x1 = t.originX + t.width * t.resX;
  const y0 = t.originY;
  const y1 = t.originY + t.height * t.resY;
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
  };
}
