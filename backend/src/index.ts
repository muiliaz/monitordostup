import Fastify from 'fastify';
import { config } from './config.js';
import { prisma } from './db.js';

const app = Fastify({ logger: true });

app.get('/api/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok' };
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.port });
