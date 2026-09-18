import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return reply.status(404).send({ error: 'not_found' });
      if (err.code === 'P2002') return reply.status(409).send({ error: 'already_exists' });
      if (err.code === 'P2003') return reply.status(400).send({ error: 'invalid_reference' });
    }
    const statusCode = 'statusCode' in err && err.statusCode ? err.statusCode : 500;
    if (statusCode >= 500) req.log.error(err);
    return reply.status(statusCode).send({ error: statusCode >= 500 ? 'internal_error' : err.message });
  });
}
