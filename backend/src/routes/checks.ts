import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { checkInput, idParam } from '../validation.js';

export async function checkRoutes(app: FastifyInstance, opts: { scheduler: Scheduler }) {
  app.get('/api/checks', async () => {
    return prisma.check.findMany({
      orderBy: [{ groupId: 'asc' }, { name: 'asc' }],
      include: { group: { select: { id: true, name: true } } },
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
    const check = await prisma.check.create({ data });
    return reply.status(201).send(check);
  });

  app.put('/api/checks/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = checkInput.parse(req.body);
    return prisma.check.update({ where: { id }, data });
  });

  app.post('/api/checks/:id/pause', async (req) => {
    const { id } = idParam.parse(req.params);
    return prisma.check.update({ where: { id }, data: { isPaused: true } });
  });

  app.post('/api/checks/:id/resume', async (req) => {
    const { id } = idParam.parse(req.params);
    // Run right away instead of waiting for the stale next_run_at.
    return prisma.check.update({ where: { id }, data: { isPaused: false, nextRunAt: new Date() } });
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
    return reply.status(204).send();
  });
}
