import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { prisma } from './db.js';
import { registerErrorHandler } from './errors.js';
import { authRoutes, requireAdmin } from './auth.js';
import { checkRoutes } from './routes/checks.js';
import { groupRoutes } from './routes/groups.js';
import { Scheduler } from './scheduler/scheduler.js';

const app = Fastify({ logger: true });
const scheduler = new Scheduler(app.log.child({ component: 'scheduler' }));
registerErrorHandler(app);
await app.register(cookie, { secret: config.sessionSecret });

app.get('/api/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok' };
});

await app.register(authRoutes);

// Everything registered inside this scope requires the admin session.
await app.register(async (admin) => {
  admin.addHook('preHandler', requireAdmin);
  await admin.register(checkRoutes, { scheduler });
  await admin.register(groupRoutes);
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await scheduler.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.port });
await scheduler.start();
