import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { bus, type LiveEvent } from './bus.js';

const HEARTBEAT_MS = 15_000;
// A client that stopped reading (stuck tab, dead network) is dropped instead
// of buffering events for it forever.
const MAX_BUFFERED_BYTES = 1024 * 1024;

const openStreams = new Set<ServerResponse>();

// Opens an SSE stream and forwards bus events that pass `filter`/`map`.
// Used by the admin stream now and by the public status page later.
export function openEventStream(
  req: FastifyRequest,
  reply: FastifyReply,
  transform: (event: LiveEvent) => LiveEvent | null = (e) => e,
) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // nginx: don't buffer this response (belt and braces with proxy_buffering off).
    'x-accel-buffering': 'no',
  });
  // Reconnect delay for EventSource after a dropped connection.
  res.write('retry: 3000\n\n');
  openStreams.add(res);

  let seq = 0;
  const send = (type: string, data: unknown) => {
    res.write(`id: ${++seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      req.log.warn('SSE client too slow, dropping connection');
      res.destroy();
    }
  };

  send('hello', { serverTime: new Date() });
  const unsubscribe = bus.subscribe((event) => {
    const out = transform(event);
    if (out) send(out.type, out.data);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    openStreams.delete(res);
  });
}

export async function streamRoutes(app: FastifyInstance) {
  app.get('/api/stream', (req, reply) => openEventStream(req, reply));
  app.get('/api/stream/clients', async () => ({ clients: bus.subscriberCount }));
}

// Long-lived streams would keep the server from closing on shutdown.
export function closeAllStreams() {
  for (const res of openStreams) res.end();
  openStreams.clear();
}
