import { fromFile } from 'geotiff';
import type { GridTransform } from './transform.ts';

export interface Raster extends GridTransform {
  data: Float32Array;
  nodata: number | null;
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
