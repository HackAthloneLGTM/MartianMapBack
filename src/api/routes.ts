import type { FastifyInstance } from 'fastify';
import type { Meta, RouteOptions, RouteRequest } from '../../shared/types.ts';
import { evaLimits } from '../analysis/eva.ts';
import { renderElevation, renderSlope, renderTile } from '../analysis/render.ts';
import type { RadiationStore } from '../data/radlab.ts';
import { DEFAULT_OPTIONS } from '../config.ts';
import type { Terrain } from '../data/terrain.ts';
import { resolveOptions, type RoutePlanner } from '../routing/planner.ts';

const pointSchema = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    row: { type: 'integer' },
    col: { type: 'integer' },
  },
  oneOf: [{ required: ['x', 'y'] }, { required: ['row', 'col'] }],
} as const;

// additionalProperties: false — Fastify strips unknown keys so they are not echoed back in `options`.
const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cellSize: { type: 'number' },
    aggregation: { type: 'string', enum: ['max', 'p90'] },
    slopeClasses: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['maxDeg', 'multiplier'],
        properties: {
          maxDeg: { type: 'number', minimum: 0, maximum: 90 },
          multiplier: { type: ['number', 'null'] },
          label: { type: 'string' },
        },
      },
    },
    uphillPenalty: { type: 'number' },
    walkingSpeedKmh: { type: 'number' },
    scienceStopMin: { type: 'number' },
    returnTrip: { type: 'boolean' },
    doseRateMSvPerDay: { type: 'number' },
    doseLimitMSv: { type: 'number' },
    maxEvaMinutes: { type: 'number' },
  },
} as const;

/** Native raster is ~1135 px, so z≈3 is 1:1; deeper zooms just upsample (Leaflet asks for up to z18 by default). */
const MAX_TILE_ZOOM = 30;
/** Most-recently-used tiles kept in memory (each ≤ ~100 KB). */
const TILE_CACHE_MAX = 2000;

/** Options that affect the EVA reach limit, accepted as query parameters on /api/radiation. */
const evaQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    walkingSpeedKmh: { type: 'number' },
    scienceStopMin: { type: 'number' },
    returnTrip: { type: 'boolean' },
    doseRateMSvPerDay: { type: 'number' },
    doseLimitMSv: { type: 'number' },
    maxEvaMinutes: { type: 'number' },
  },
} as const;

export async function registerRoutes(app: FastifyInstance, terrain: Terrain, planner: RoutePlanner, radiation?: RadiationStore) {
  const layerCache = new Map<string, Buffer>();
  const tileCache = new Map<string, Buffer>();

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/meta', async (): Promise<Meta> => {
    const t = terrain.transform;
    return {
      width: t.width,
      height: t.height,
      pixelSizeX: Math.abs(t.resX),
      pixelSizeY: Math.abs(t.resY),
      originX: t.originX,
      originY: t.originY,
      bounds: terrain.bounds,
      crsName: terrain.crsName,
      crsWkt: terrain.crsWkt,
      nodata: terrain.elevation.nodata,
      validFraction: terrain.validCount / (t.width * t.height),
      elevation: terrain.elevationStats,
      slope: terrain.slopeStats,
      defaults: planner.defaults(),
    };
  });

  /** Dose rate in use (RadLab Curiosity average or fallback) and the max EVA reach for the given options. */
  app.get<{ Querystring: Partial<RouteOptions> }>(
    '/api/radiation',
    { schema: { querystring: evaQuerySchema } },
    async (req) => {
      const o = resolveOptions(req.query, planner.defaults());
      return { radiation: { ...planner.radiation }, eva: evaLimits(o), options: o };
    },
  );

  /** Re-download the RadLab record (slow: ~275k rows). */
  app.post('/api/radiation/refresh', async (_req, reply) => {
    if (!radiation) return reply.code(501).send({ error: 'Radiation store not configured' });
    try {
      return { radiation: { ...(await radiation.refresh()) } };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message, radiation: { ...planner.radiation } });
    }
  });

  app.get('/api/waypoints', async () => terrain.waypoints);

  app.get<{ Querystring: { x?: number; y?: number; row?: number; col?: number } }>(
    '/api/sample',
    { schema: { querystring: pointSchema } },
    async (req) => {
      const q = req.query;
      const p = terrain.resolvePoint(q.x !== undefined ? { x: q.x, y: q.y! } : { row: q.row!, col: q.col! });
      return { ...terrain.sampleAt(p.row, p.col), x: p.x, y: p.y };
    },
  );

  app.get<{ Params: { layer: string } }>('/api/layers/:layer', async (req, reply) => {
    const { layer } = req.params;
    const m = /^(elevation|slope)\.(png|bin)$/.exec(layer);
    if (!m) return reply.code(404).send({ error: 'Unknown layer. Use elevation|slope with .png or .bin' });
    const [, kind, ext] = m;

    reply.header('Cache-Control', 'public, max-age=3600');
    if (ext === 'bin') {
      // Raw little-endian Float32, row-major, width × height from /api/meta. NoData kept as-is.
      const data = kind === 'elevation' ? terrain.elevation.data : terrain.slope.data;
      reply.header('X-Raster-Width', terrain.width).header('X-Raster-Height', terrain.height);
      return reply.type('application/octet-stream').send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
    let png = layerCache.get(kind);
    if (!png) {
      png = kind === 'elevation' ? renderElevation(terrain) : renderSlope(terrain, DEFAULT_OPTIONS.slopeClasses);
      layerCache.set(kind, png);
    }
    return reply.type('image/png').send(png);
  });

  app.get<{ Params: { mapName: string; z: string; x: string; y: string; format: string } }>(
    '/map_:mapName/:z/:x/:y/:format',
    async (req, reply) => {
      const { mapName, z: rawZ, x: rawX, y: rawY, format } = req.params;
      if (mapName !== 'elevation' && mapName !== 'slope') {
        return reply.code(404).send({ error: 'Unknown map. Use elevation or slope' });
      }
      if (format !== 'png') {
        return reply.code(404).send({ error: 'Only png tiles are available' });
      }
      if (!/^\d+$/.test(rawZ) || !/^-?\d+$/.test(rawX) || !/^-?\d+$/.test(rawY)) {
        return reply.code(400).send({ error: 'Tile coordinates must be integers' });
      }

      const z = Number(rawZ);
      const x = Number(rawX);
      const y = Number(rawY);
      if (!Number.isSafeInteger(z) || z > MAX_TILE_ZOOM || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        return reply.code(400).send({ error: `Tile coordinates are out of range (z ≤ ${MAX_TILE_ZOOM})` });
      }
      // Tiles outside the raster's 2^z × 2^z grid are empty: don't render or cache them.
      const tiles = 2 ** z;
      if (x < 0 || y < 0 || x >= tiles || y >= tiles) {
        return reply.code(404).send({ error: 'Tile is outside the map' });
      }

      const key = `${mapName}/${z}/${x}/${y}`;
      let tile = tileCache.get(key);
      if (tile) {
        // Re-insert so Map order tracks recency (LRU).
        tileCache.delete(key);
      } else {
        tile = renderTile(terrain, mapName, z, x, y, DEFAULT_OPTIONS.slopeClasses);
        if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
      }
      tileCache.set(key, tile);
      return reply.header('Cache-Control', 'public, max-age=3600').type('image/png').send(tile);
    },
  );

  app.post<{ Body: RouteRequest }>(
    '/api/route',
    {
      schema: {
        body: {
          type: 'object',
          required: ['start', 'end'],
          properties: { start: pointSchema, end: pointSchema, options: optionsSchema },
        },
      },
    },
    async (req) => planner.plan(req.body.start, req.body.end, req.body.options),
  );

  /** Convenience: route between the GeoPackage START and END waypoints with default options. */
  app.get('/api/route/default', async (_req, reply) => {
    const s = terrain.waypoints.find((w) => w.name.toUpperCase() === 'START');
    const e = terrain.waypoints.find((w) => w.name.toUpperCase() === 'END');
    if (!s || !e) return reply.code(404).send({ error: 'START/END waypoints not found' });
    return planner.plan({ x: s.x, y: s.y }, { x: e.x, y: e.y });
  });
}
