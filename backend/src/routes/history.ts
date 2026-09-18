import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { idParam } from '../validation.js';
import { computeSummary } from '../dashboard/summary.js';

const resultsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

const incidentsQuery = z.object({
  checkId: z.coerce.number().int().positive().optional(),
  open: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function historyRoutes(app: FastifyInstance) {
  // Top-of-dashboard numbers. Kept fresh afterwards by `summary` SSE events.
  app.get('/api/dashboard/summary', async () => computeSummary());

  // Raw recent results (newest first) for the check details page. Charts over
  // days/weeks use aggregated queries (stage 10), never this endpoint.
  app.get('/api/checks/:id/results', async (req) => {
    const { id } = idParam.parse(req.params);
    const { limit } = resultsQuery.parse(req.query);
    const rows = await prisma.checkResult.findMany({
      where: { checkId: id },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });
    // BIGINT ids don't survive JSON.stringify.
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  });

  app.get('/api/incidents', async (req) => {
    const q = incidentsQuery.parse(req.query);
    return prisma.incident.findMany({
      where: {
        checkId: q.checkId,
        endedAt: q.open === 'true' ? null : q.open === 'false' ? { not: null } : undefined,
      },
      orderBy: { startedAt: 'desc' },
      take: q.limit,
      include: { check: { select: { id: true, name: true, url: true, groupId: true } } },
    });
  });
}
