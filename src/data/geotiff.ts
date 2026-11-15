import { fromFile } from 'geotiff';
import type { GridTransform } from './transform.ts';

export interface Raster extends GridTransform {
  data: Float32Array;
  nodata: number | null;
}

export interface OpticalRaster extends GridTransform {
  /** Interleaved RGB bytes, row-major (three bytes per pixel). */
  data: Uint8Array;
}

/** Reads band 1 of a single-band GeoTIFF into a Float32Array (row-major). */
export async function loadRaster(path: string): Promise<Raster> {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const width = image.getWidth();
    const height = image.getHeight();
    const nodata = image.getGDALNoData();

    const raw = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>;
    const data = raw instanceof Float32Array ? raw : Float32Array.from(raw);

    if (data.length !== width * height) {
      throw new Error(`${path}: expected ${width * height} samples, got ${data.length}`);
    }

    return { data, width, height, originX, originY, resX, resY, nodata };
  } finally {
    await tiff.close?.();
  }
}

/** Reads the RGB representation of an optical GeoTIFF into interleaved bytes. */
export async function loadOpticalRaster(path: string): Promise<OpticalRaster> {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const width = image.getWidth();
    const height = image.getHeight();
    const raw = (await image.readRGB({ interleave: true })) as unknown as ArrayLike<number>;
    const data = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);

    if (data.length !== width * height * 3) {
      throw new Error(`${path}: expected ${width * height * 3} RGB samples, got ${data.length}`);
    }

    return { data, width, height, originX, originY, resX, resY };
  } finally {
    await tiff.close?.();
  }
}
