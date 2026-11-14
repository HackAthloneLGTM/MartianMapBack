import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RouteResponse } from '../shared/types.ts';
import { buildServer } from '../src/app.ts';
import { DATA_DIR, hasDataFiles } from '../src/config.ts';

const hasData = hasDataFiles(DATA_DIR);

describe.skipIf(!hasData)('API (real data)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer(DATA_DIR);
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

  it('serves elevation and slope Leaflet tiles', async () => {
    for (const mapName of ['elevation', 'slope']) {
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
});
