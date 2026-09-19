import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { openEventStream } from '../live/stream.js';
import { toPublicEvent, toPublicPatch, type PublicCheck } from '../public/view.js';

const DAY_MS = 24 * 60 * 60_000;

async function loadPublicChecks(): Promise<PublicCheck[]> {
  const checks = await prisma.check.findMany({
    where: { isPublic: true },
    orderBy: [{ group: { name: 'asc' } }, { name: 'asc' }],
    include: { group: { select: { name: true } } },
  });
  if (checks.length === 0) return [];
  const ids = checks.map((c) => c.id);
  const groupIds = [...new Set(checks.flatMap((c) => (c.groupId === null ? [] : [c.groupId])))];
  const now = new Date();

  const [uptimes, windows] = await Promise.all([
    // Hourly rollup: last 24 whole hours plus the current one.
    prisma.$queryRaw<{ checkId: number; uptime: number }[]>`
      SELECT check_id AS "checkId", 1 - sum(failures)::float8 / sum(total) AS uptime
      FROM check_results_hourly
      WHERE check_id = ANY(${ids}) AND hour >= date_trunc('hour', ${new Date(now.getTime() - DAY_MS)}::timestamptz, 'UTC')
      GROUP BY check_id`,
    prisma.maintenanceWindow.findMany({
      where: { endsAt: { gt: now }, OR: [{ checkId: { in: ids } }, { groupId: { in: groupIds } }] },
      select: { checkId: true, groupId: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    }),
  ]);
  const uptimeById = new Map(uptimes.map((u) => [u.checkId, Math.round(u.uptime * 10000) / 100]));

  return checks.map((c) => ({
    ...toPublicPatch(c),
    group: c.group?.name ?? null,
    uptime24h: uptimeById.get(c.id) ?? null,
    maintenance: windows
      .filter((w) => w.checkId === c.id || (w.groupId !== null && w.groupId === c.groupId))
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  }));
}

// No login: registered outside the admin scope. Everything here goes through
// the PublicCheck whitelist (public/view.ts).
export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/status', async () => ({ checks: await loadPublicChecks() }));
  app.get('/api/public/stream', (req, reply) => openEventStream(req, reply, toPublicEvent));
}
