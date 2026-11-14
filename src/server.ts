import { buildServer } from './app.ts';
import { HOST, PORT } from './config.ts';

export default async function main() {
    const app = await buildServer();
    console.log(`Server is running on http://${HOST}:${PORT}`);
    await app.listen({ port: PORT, host: HOST });
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
