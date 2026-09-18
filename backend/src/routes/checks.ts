import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { bus } from '../live/bus.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { checkInput, idParam } from '../validation.js';

const withGroup = { group: { select: { id: true, name: true } } } as const;

// Any change to a check can change its group's status or membership, so
// group lists are refreshed too (these are rare, user-initiated actions).
function publishCheck(check: { id: number }) {
  bus.publish({ type: 'check.upsert', data: check });
  bus.publish({ type: 'groups.changed', data: {} });
}

export async function checkRoutes(app: FastifyInstance, opts: { scheduler: Scheduler }) {
  app.get('/api/checks', async () => {
    return prisma.check.findMany({
      orderBy: [{ groupId: 'asc' }, { name: 'asc' }],
      include: withGroup,
    });
  });

  app.get('/api/checks/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return prisma.check.findUniqueOrThrow({
      where: { id },
      include: { group: { select: { id: true, name: true } } },
    });
  });

  app.post('/api/checks', async (req, reply) => {
    const data = checkInput.parse(req.body);
    // nextRunAt defaults to now(): a new check is picked up on the next tick.
    const check = await prisma.check.create({ data, include: withGroup });
    publishCheck(check);
    return reply.status(201).send(check);
  });

  app.put('/api/checks/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = checkInput.parse(req.body);
    // Run with the new config right away: otherwise shortening the interval
    // (e.g. 1 h -> 30 s) would only take effect after the old next_run_at.
    const check = await prisma.check.update({ where: { id }, data: { ...data, nextRunAt: new Date() }, include: withGroup });
    publishCheck(check);
    return check;
  });

  app.post('/api/checks/:id/pause', async (req) => {
    const { id } = idParam.parse(req.params);
    const check = await prisma.check.update({ where: { id }, data: { isPaused: true }, include: withGroup });
    publishCheck(check);
    return check;
  });

  app.post('/api/checks/:id/resume', async (req) => {
    const { id } = idParam.parse(req.params);
    // Run right away instead of waiting for the stale next_run_at.
    const check = await prisma.check.update({ where: { id }, data: { isPaused: false, nextRunAt: new Date() }, include: withGroup });
    publishCheck(check);
    return check;
  });

  // Runs in the background; the result shows up on the dashboard.
  app.post('/api/checks/:id/run', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const outcome = await opts.scheduler.runNow(id);
    if (outcome === 'not_found') throw new HttpError(404, 'not_found');
    if (outcome === 'already_running') throw new HttpError(409, 'already_running');
    return reply.status(202).send({ started: true });
  });

  app.get('/api/scheduler/stats', async () => opts.scheduler.stats());

  app.delete('/api/checks/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await prisma.check.delete({ where: { id } });
    bus.publish({ type: 'check.deleted', data: { id } });
    bus.publish({ type: 'groups.changed', data: {} });
    return reply.status(204).send();
  });
}
