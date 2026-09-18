import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { bus } from '../live/bus.js';
import { idParam } from '../validation.js';

// Times come from the client, but "start now" must mean the server's now:
// a browser (or Docker VM) clock that is off by minutes would otherwise put
// the window in the future and let alerts through. So startsAt may be omitted
// (= server now) and the end may be given as a duration instead of a time.
const windowBody = z.object({
  checkId: z.number().int().positive().nullable().default(null),
  groupId: z.number().int().positive().nullable().default(null),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(1).max(60 * 24 * 31).optional(),
  note: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

const windowInput = windowBody
  .refine((w) => (w.checkId === null) !== (w.groupId === null), { message: 'Укажите либо проверку, либо группу', path: ['checkId'] })
  .refine((w) => (w.endsAt === undefined) !== (w.durationMinutes === undefined), {
    message: 'Укажите либо время окончания, либо длительность',
    path: ['endsAt'],
  })
  .transform(({ durationMinutes, ...w }) => {
    const startsAt = w.startsAt ?? new Date();
    const endsAt = w.endsAt ?? new Date(startsAt.getTime() + durationMinutes! * 60_000);
    return { ...w, startsAt, endsAt };
  })
  .refine((w) => w.endsAt > w.startsAt, { message: 'Окончание должно быть позже начала', path: ['endsAt'] });

const listQuery = z.object({ scope: z.enum(['current', 'past', 'all']).default('current') });

const withTarget = { check: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } } as const;

function changed() {
  bus.publish({ type: 'maintenance.changed', data: {} });
}

export async function maintenanceRoutes(app: FastifyInstance) {
  // "current" = active now or upcoming: what the dashboard needs to show badges.
  app.get('/api/maintenance', async (req) => {
    const { scope } = listQuery.parse(req.query);
    const now = new Date();
    const where: Prisma.MaintenanceWindowWhereInput =
      scope === 'current' ? { endsAt: { gt: now } } : scope === 'past' ? { endsAt: { lte: now } } : {};
    return prisma.maintenanceWindow.findMany({
      where,
      orderBy: scope === 'past' ? { endsAt: 'desc' } : { startsAt: 'asc' },
      take: 200,
      include: withTarget,
    });
  });

  app.post('/api/maintenance', async (req, reply) => {
    const data = windowInput.parse(req.body);
    const window = await prisma.maintenanceWindow.create({ data, include: withTarget });
    changed();
    return reply.status(201).send(window);
  });

  app.put('/api/maintenance/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = windowInput.parse(req.body);
    const window = await prisma.maintenanceWindow.update({ where: { id }, data, include: withTarget });
    changed();
    return window;
  });

  // Finish an active window now (works were done earlier than planned).
  // Alerts held back by it go out on the next dispatcher run.
  app.post('/api/maintenance/:id/end', async (req) => {
    const { id } = idParam.parse(req.params);
    const now = new Date();
    const current = await prisma.maintenanceWindow.findUniqueOrThrow({ where: { id } });
    if (current.endsAt <= now) throw new HttpError(409, 'already_ended');
    // A window that has not started yet is simply cancelled.
    const window =
      current.startsAt >= now
        ? await prisma.maintenanceWindow.delete({ where: { id }, include: withTarget })
        : await prisma.maintenanceWindow.update({ where: { id }, data: { endsAt: now }, include: withTarget });
    changed();
    return window;
  });

  app.delete('/api/maintenance/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await prisma.maintenanceWindow.delete({ where: { id } });
    changed();
    return reply.status(204).send();
  });
}
