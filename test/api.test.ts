import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RadiationSource, RouteResponse } from '../shared/types.ts';
import { buildServer } from '../src/app.ts';
import { DATA_DIR, hasDataFiles } from '../src/config.ts';

const hasData = hasDataFiles(DATA_DIR);

const RADIATION: RadiationSource = {
  doseRateMSvPerDay: 0.5,
  absorbedMGyPerDay: 0.164,
  qualityFactor: 3.05,
  samples: 1,
  from: null,
  to: null,
  source: 'radlab',
  fetchedAt: null,
  note: 'test',
};

describe.skipIf(!hasData)('API (real data)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer(DATA_DIR, { radiation: { current: RADIATION, refresh: async () => RADIATION } });
  });
  afterAll(() => app.close());

  const route = (payload: object) => app.inject({ method: 'POST', url: '/api/route', payload });
  const START = { row: 255, col: 851 };
  const END = { row: 755, col: 578 };

  it('exposes the raster-size headers to cross-origin fetch()', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/layers/slope.bin',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
    const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();
    expect(exposed).toContain('x-raster-width');
    expect(exposed).toContain('x-raster-height');
  });

  it('rejects tiles outside the grid, too deep, or not png', async () => {
    for (const url of ['/map_slope/1/2/0/png', '/map_slope/0/-1/0/png', '/map_slope/0/0/0/jpg', '/map_slope/1/0/0/png/x']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/map_slope/31/0/0/png' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/map_slope/1/1/1/png' })).statusCode).toBe(200);
  });

  it('serves elevation, slope and optical Leaflet tiles', async () => {
    for (const mapName of ['elevation', 'slope', 'optical']) {
      const res = await app.inject({ method: 'GET', url: `/map_${mapName}/0/0/0/png` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
  });

  it('counts straight-line samples above every slope class as blocked', async () => {
    // No null class: A* treats > 20° as impassable, so the straight line must too.
    const slopeClasses = [
      { maxDeg: 10, multiplier: 1, label: 'a' },
      { maxDeg: 20, multiplier: 2, label: 'b' },
    ];
    const r = (await route({ start: START, end: END, options: { slopeClasses } }).then((x) => x.json())) as RouteResponse;
    const above = r.straightLine.path.filter((p) => p.slope !== null && p.slope > 20).length;
    expect(above).toBeGreaterThan(0);
    expect(r.straightLine.metrics.blockedSamples).toBeGreaterThanOrEqual(above);
    expect(r.warnings.some((w) => w.code === 'STRAIGHT_LINE_BLOCKED')).toBe(true);
  });

  it('strips unknown options instead of echoing them back', async () => {
    const res = await route({ start: START, end: END, options: { foo: 'bar', cellSize: 8 } });
    expect(res.statusCode).toBe(200);
    const { options } = res.json() as RouteResponse;
    expect(options).not.toHaveProperty('foo');
    expect(options.cellSize).toBe(8);
  });

  it('rejects slope classes with maxDeg outside 0–90', async () => {
    const res = await route({
      start: START,
      end: END,
      options: { slopeClasses: [{ maxDeg: -5, multiplier: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('uses the injected RadLab dose rate and reports EVA limits on routes', async () => {
    const r = (await route({ start: START, end: END }).then((x) => x.json())) as RouteResponse;
    expect(r.options.doseRateMSvPerDay).toBe(0.5);
    expect(r.radiation.source).toBe('radlab');
    expect(r.eva.maxOneWayDistanceM).toBeGreaterThan(0);
    expect(r.eva.routeFraction).toBeCloseTo(r.metrics!.distance2d / r.eva.maxOneWayDistanceM);
  });

  it('warns when the route exceeds the EVA limit', async () => {
    const r = (await route({ start: START, end: END, options: { maxEvaMinutes: 31 } }).then((x) => x.json())) as RouteResponse;
    expect(r.eva.limitedBy).toBe('time');
    expect(r.warnings.some((w) => w.code === 'EXCEEDS_EVA_LIMIT')).toBe(true);
  });

  it('serves /api/radiation with query overrides', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiation?doseLimitMSv=0.1&returnTrip=false' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.radiation.doseRateMSvPerDay).toBe(0.5);
    expect(body.eva.limitedBy).toBe('dose');
    // 0.1 mSv at 0.5/24 mSv/h = 288 min, minus 30 min stop, one way at 1 km/h
    expect(body.eva.maxOneWayDistanceM).toBeCloseTo(((288 - 30) / 60) * 1000);
    const meta = await app.inject({ method: 'GET', url: '/api/meta' }).then((x) => x.json());
    expect(meta.defaults.doseRateMSvPerDay).toBe(0.5);
  });

  it('rejects a non-positive dose limit', async () => {
    const res = await route({ start: START, end: END, options: { doseLimitMSv: 0 } });
    expect(res.statusCode).toBe(400);
  });
});
