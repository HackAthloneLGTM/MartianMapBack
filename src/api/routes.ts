import type { FastifyInstance } from 'fastify';
import type { Meta, RouteRequest } from '../../shared/types.ts';
import { renderElevation, renderSlope } from '../analysis/render.ts';
import { DEFAULT_OPTIONS } from '../config.ts';
import type { Terrain } from '../data/terrain.ts';
import type { RoutePlanner } from '../routing/planner.ts';

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
  },
} as const;

export async function registerRoutes(app: FastifyInstance, terrain: Terrain, planner: RoutePlanner) {
  const layerCache = new Map<string, Buffer>();

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
      defaults: DEFAULT_OPTIONS,
    };
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
