import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError } from './errors.js';

const COOKIE_NAME = 'session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Hash both sides first so timingSafeEqual gets equal-length buffers.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// The cookie holds only the expiry timestamp, signed with SESSION_SECRET.
// There is a single admin account, so there is nothing else to identify.
function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  const expiresAt = Number(unsigned.value);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply) {
  if (!isAuthenticated(req)) throw new HttpError(401, 'unauthorized');
}

const loginBody = z.object({ username: z.string(), password: z.string() });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = loginBody.parse(req.body);
    const ok =
      safeEqual(username, config.adminUsername) && safeEqual(password, config.adminPassword);
    if (!ok) throw new HttpError(401, 'invalid_credentials');

    const expiresAt = Date.now() + SESSION_TTL_MS;
    reply.setCookie(COOKIE_NAME, String(expiresAt), {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt),
    });
    return { username: config.adminUsername };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!isAuthenticated(req)) throw new HttpError(401, 'unauthorized');
    return { username: config.adminUsername };
  });
}
