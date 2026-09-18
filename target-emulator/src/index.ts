import http from 'node:http';

// Emulates the sites being monitored. Zero dependencies, runs as plain .ts
// through Node's built-in type stripping (so: no enums / parameter properties).
//
// Fixed behaviours:
//   GET /ok                 200, body contains "status: ok"
//   GET /slow?ms=3000       200 after a delay (max 10 min)
//   GET /error?code=500     responds with the given status code
//   GET /timeout            never responds (socket stays open)
//   GET /flaky?rate=0.5     500 with probability `rate`, otherwise 200
//
// Switchable targets, for "down -> up" scenarios without editing the check:
//   GET /switch/<name>                behaves according to the current mode
//   PUT /control/switch/<name>        body: {"mode":"ok"|"error"|"slow"|"timeout","code"?,"ms"?}
//   GET /control/switch               current modes
//   DELETE /control/switch            reset all to "ok"
//
// Request log (independent evidence of when checks actually hit the target):
//   GET /control/hits?path=/ok&since=<ISO>   recorded hits, oldest first
//   DELETE /control/hits                     clear the log

const PORT = Number(process.env.PORT ?? 4000);
const MAX_SLOW_MS = 10 * 60 * 1000;
const MAX_HITS = 20_000;

type Mode = 'ok' | 'error' | 'slow' | 'timeout';
interface SwitchState {
  mode: Mode;
  code: number;
  ms: number;
}
interface Hit {
  at: string;
  path: string;
  query: string;
}

const switches = new Map<string, SwitchState>();
const hits: Hit[] = [];

function send(res: http.ServerResponse, status: number, body: unknown) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json' });
  res.end(isText ? body : JSON.stringify(body));
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function respondOk(res: http.ServerResponse) {
  send(res, 200, 'status: ok\n');
}

function respondError(res: http.ServerResponse, code: number) {
  send(res, code, `status: error ${code}\n`);
}

function respondSlow(res: http.ServerResponse, ms: number) {
  const timer = setTimeout(() => send(res, 200, `status: ok after ${ms}ms\n`), ms);
  // The checker may give up first; don't keep a timer for a dead socket.
  res.on('close', () => clearTimeout(timer));
}

// Deliberately never answer. The connection is closed by the client's timeout.
function respondTimeout(_res: http.ServerResponse) {}

function applyMode(res: http.ServerResponse, s: SwitchState) {
  if (s.mode === 'ok') return respondOk(res);
  if (s.mode === 'error') return respondError(res, s.code);
  if (s.mode === 'slow') return respondSlow(res, s.ms);
  return respondTimeout(res);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseSwitch(raw: string): SwitchState | string {
  let body: { mode?: unknown; code?: unknown; ms?: unknown };
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return 'body must be JSON';
  }
  const modes: Mode[] = ['ok', 'error', 'slow', 'timeout'];
  if (!modes.includes(body.mode as Mode)) return `mode must be one of ${modes.join(', ')}`;
  return {
    mode: body.mode as Mode,
    code: clampInt(body.code === undefined ? null : String(body.code), 500, 100, 599),
    ms: clampInt(body.ms === undefined ? null : String(body.ms), 3000, 0, MAX_SLOW_MS),
  };
}

async function handleControl(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const path = url.pathname;

  if (path === '/control/hits') {
    if (req.method === 'DELETE') {
      hits.length = 0;
      return send(res, 200, { ok: true });
    }
    const onlyPath = url.searchParams.get('path');
    const since = url.searchParams.get('since');
    const result = hits.filter((h) => (!onlyPath || h.path === onlyPath) && (!since || h.at >= since));
    return send(res, 200, result);
  }

  if (path === '/control/switch') {
    if (req.method === 'DELETE') {
      switches.clear();
      return send(res, 200, { ok: true });
    }
    return send(res, 200, Object.fromEntries(switches));
  }

  const m = path.match(/^\/control\/switch\/([\w-]+)$/);
  if (m && req.method === 'PUT') {
    const parsed = parseSwitch(await readBody(req));
    if (typeof parsed === 'string') return send(res, 400, { error: parsed });
    switches.set(m[1], parsed);
    console.log(`switch ${m[1]} -> ${JSON.stringify(parsed)}`);
    return send(res, 200, parsed);
  }

  return send(res, 404, { error: 'not found' });
}

function handleTarget(res: http.ServerResponse, url: URL) {
  const path = url.pathname;
  const q = url.searchParams;

  if (path === '/ok') return respondOk(res);
  if (path === '/slow') return respondSlow(res, clampInt(q.get('ms'), 3000, 0, MAX_SLOW_MS));
  if (path === '/error') return respondError(res, clampInt(q.get('code'), 500, 100, 599));
  if (path === '/timeout') return respondTimeout(res);
  if (path === '/flaky') {
    const rate = Math.min(1, Math.max(0, Number(q.get('rate') ?? 0.5) || 0));
    return Math.random() < rate ? respondError(res, 500) : respondOk(res);
  }

  const m = path.match(/^\/switch\/([\w-]+)$/);
  if (m) return applyMode(res, switches.get(m[1]) ?? { mode: 'ok', code: 500, ms: 0 });

  return send(res, 404, 'not found\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') return send(res, 200, 'ok');
  if (url.pathname.startsWith('/control/')) {
    handleControl(req, res, url).catch((err) => send(res, 500, { error: String(err) }));
    return;
  }

  hits.push({ at: new Date().toISOString(), path: url.pathname, query: url.search });
  if (hits.length > MAX_HITS) hits.splice(0, hits.length - MAX_HITS);
  handleTarget(res, url);
});

// /timeout and long /slow must not be cut by Node's own server timeouts.
server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`target-emulator listening on :${PORT}`);
});

process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
