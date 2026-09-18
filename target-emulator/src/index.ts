import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4000);

// Endpoints (/ok, /slow, /error, /timeout, /flaky) are added in stage 3.
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`target-emulator listening on :${PORT}`);
});
