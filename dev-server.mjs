import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.metadata': 'application/json',
};

const requestLog = [];

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/__test__/requests/reset') {
    requestLog.length = 0;
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === '/__test__/requests') {
    const body = Buffer.from(JSON.stringify(requestLog));
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    });
    res.end(body);
    return;
  }

  requestLog.push({ method: req.method ?? 'GET', pathname });
  let filePath = path.join(
    __dirname,
    pathname === '/' ? '/examples/browser-demo.html' : pathname,
  );
  const ext = path.extname(filePath);

  // Handle directory requests
  if (!ext) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log(`404: ${req.url}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', data.length); // Required for download progress tracking
    res.writeHead(200);
    res.end(data);
    console.log(`200: ${req.url} (${mimeType}, ${data.length} bytes)`);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Dev server running at http://localhost:${PORT}`);
  console.log(
    `   Demo page: http://localhost:${PORT}/examples/browser-demo.html`,
  );
  console.log(
    `   Cross-origin isolation intentionally disabled for no-pthread testing`,
  );
  console.log(`\n   Press Ctrl+C to stop\n`);
});
