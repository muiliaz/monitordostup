import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { bus } from '../live/bus.js';
import { groupStatus } from '../monitor/groupStatus.js';
import { groupInput, idParam } from '../validation.js';

export async function groupRoutes(app: FastifyInstance) {
  app.get('/api/groups', async () => {
    const groups = await prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: { checks: { select: { isPaused: true, currentStatus: true } } },
    });
    return groups.map(({ checks, ...group }) => ({
      ...group,
      checkCount: checks.length,
      status: groupStatus(checks),
    }));
  });

  app.post('/api/groups', async (req, reply) => {
    const data = groupInput.parse(req.body);
    const group = await prisma.group.create({ data });
    bus.publish({ type: 'groups.changed', data: {} });
    return reply.status(201).send(group);
  });

  app.put('/api/groups/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = groupInput.parse(req.body);
    const group = await prisma.group.update({ where: { id }, data });
    bus.publish({ type: 'groups.changed', data: {} });
    return group;
  });

  // Checks of a deleted group stay, just ungrouped (FK is ON DELETE SET NULL).
  app.delete('/api/groups/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await prisma.group.delete({ where: { id } });
    bus.publish({ type: 'groups.changed', data: {} });
    return reply.status(204).send();
  });
}
