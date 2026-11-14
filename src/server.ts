import { buildServer } from './app.ts';
import { HOST, PORT } from './config.ts';

const app = await buildServer();
await app.listen({ port: PORT, host: HOST });
