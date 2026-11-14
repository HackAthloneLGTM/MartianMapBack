import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerRoutes } from './api/routes.ts';
import { DATA_DIR } from './config.ts';
import { Terrain } from './data/terrain.ts';
import { RoutePlanner } from './routing/planner.ts';

export async function buildServer(dataDir = DATA_DIR) {
  const app = Fastify({ logger: true });
  // Expose the raster-size headers sent with /api/layers/*.bin so browser fetch() can read them.
  await app.register(cors, { origin: true, exposedHeaders: ['X-Raster-Width', 'X-Raster-Height'] });

  const t0 = performance.now();
  const terrain = await Terrain.load(dataDir);
  app.log.info(
    {
      size: `${terrain.width}x${terrain.height}`,
      pixel: terrain.pixelSize,
      waypoints: terrain.waypoints.map((w) => `${w.name}@(${w.row},${w.col})`),
      ms: Math.round(performance.now() - t0),
    },
    'terrain loaded',
  );

  await registerRoutes(app, terrain, new RoutePlanner(terrain));
  return app;
}
