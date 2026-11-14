import { buildServer } from './app.js';
import { HOST, PORT } from './config.js';

const app = await buildServer();
await app.listen({ port: PORT, host: HOST });
