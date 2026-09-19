import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { prisma } from './db.js';
import { registerErrorHandler } from './errors.js';
import { authRoutes, requireAdmin } from './auth.js';
import { checkRoutes } from './routes/checks.js';
import { groupRoutes } from './routes/groups.js';
import { historyRoutes } from './routes/history.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { publicRoutes } from './routes/public.js';
import { closeAllStreams, streamRoutes } from './live/stream.js';
import { Scheduler } from './scheduler/scheduler.js';
import { AlertDispatcher } from './alerts/dispatcher.js';
import { startSummaryPublisher } from './dashboard/summary.js';

const app = Fastify({ logger: true });
const alerts = new AlertDispatcher(app.log.child({ component: 'alerts' }));
const scheduler = new Scheduler(app.log.child({ component: 'scheduler' }), () => alerts.kick());
registerErrorHandler(app);
await app.register(cookie, { secret: config.sessionSecret });

app.get('/api/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok' };
});

await app.register(authRoutes);
await app.register(publicRoutes);

// Everything registered inside this scope requires the admin session.
await app.register(async (admin) => {
  admin.addHook('preHandler', requireAdmin);
  await admin.register(checkRoutes, { scheduler });
  await admin.register(groupRoutes);
  await admin.register(historyRoutes);
  await admin.register(maintenanceRoutes);
  await admin.register(streamRoutes);
});

const stopSummary = startSummaryPublisher(app.log.child({ component: 'summary' }));

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  stopSummary();
  await scheduler.stop();
  alerts.stop();
  closeAllStreams();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.port });
await scheduler.start();
alerts.start();
