import { DatabaseSync } from 'node:sqlite';

export interface RawWaypoint {
  name: string;
  x: number;
  y: number;
}

export interface GpkgPoints {
  points: RawWaypoint[];
  srsId: number | null;
  crsName: string | null;
  crsWkt: string | null;
}

const quoteIdent = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** Envelope sizes in bytes, indexed by the GeoPackage envelope-contents indicator. */
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/**
 * Decodes a GeoPackage geometry blob (http://www.geopackage.org/spec/#gpb_format)
 * holding a WKB Point (2D, Z, M or ZM). Returns null for empty geometries.
 */
export function decodeGpkgPoint(blob: Uint8Array): { x: number; y: number } | null {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob[0] !== 0x47 || blob[1] !== 0x50) throw new Error('Not a GeoPackage geometry blob (missing "GP" magic)');
  const flags = blob[3];
  const isEmpty = (flags >> 4) & 1;
  const envelope = (flags >> 1) & 0b111;
  if (envelope >= ENVELOPE_BYTES.length) throw new Error(`Invalid envelope indicator ${envelope}`);
  if (isEmpty) return null;

  let off = 8 + ENVELOPE_BYTES[envelope];
  const little = view.getUint8(off) === 1;
  off += 1;
  const type = view.getUint32(off, little);
  off += 4;
  // ISO WKB: 1, 1001 (Z), 2001 (M), 3001 (ZM). EWKB-style high-bit flags are also tolerated.
  const baseType = (type & 0x0fffffff) % 1000;
  if (baseType !== 1) throw new Error(`Expected WKB Point, got geometry type ${type}`);

  const x = view.getFloat64(off, little);
  const y = view.getFloat64(off + 8, little);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return { x, y };
}

/** Reads every point from the first feature table of a GeoPackage. Expects a `name` column. */
export function loadWaypoints(path: string): GpkgPoints {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const gc = db
      .prepare(
        `SELECT g.table_name AS t, g.column_name AS c, g.srs_id AS srs
         FROM gpkg_geometry_columns g
         JOIN gpkg_contents ct ON ct.table_name = g.table_name
         WHERE ct.data_type = 'features'
         LIMIT 1`,
      )
      .get() as { t: string; c: string; srs: number } | undefined;
    if (!gc) throw new Error(`${path}: no feature table found`);

    const srs = db
      .prepare('SELECT srs_name AS name, definition AS wkt FROM gpkg_spatial_ref_sys WHERE srs_id = ?')
      .get(gc.srs) as { name: string; wkt: string } | undefined;

    const rows = db
      .prepare(`SELECT name, ${quoteIdent(gc.c)} AS geom FROM ${quoteIdent(gc.t)}`)
      .all() as { name: string | null; geom: Uint8Array | null }[];

    const points: RawWaypoint[] = [];
    for (const row of rows) {
      if (!row.geom) continue;
      const p = decodeGpkgPoint(row.geom);
      if (p) points.push({ name: row.name ?? '', ...p });
    }

    return {
      points,
      srsId: gc.srs,
      crsName: srs?.name ?? null,
      crsWkt: srs && srs.wkt !== 'undefined' ? srs.wkt : null,
    };
  } finally {
    db.close();
  }
}
