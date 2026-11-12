import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from './codex.mjs';
import { runWorkflow } from './workflow.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const origin = `http://${host}:${port}`;
const assets = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};
let running = false;

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");

  // This demo is private to this machine, including its agent endpoint.
  if (req.headers.host !== `${host}:${port}` || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(403).end('Use the local URL printed by npm start.');
    return;
  }

  if (req.method === 'GET' && assets[req.url]) {
    const [file, type] = assets[req.url];
    try {
      const content = await readFile(join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(content);
    } catch {
      res.writeHead(500).end('Could not load the interface.');
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/run') {
    res.writeHead(404).end('Not found.');
    return;
  }
  if (!req.headers['content-type']?.startsWith('application/json')) {
    res.writeHead(415).end('Send application/json.');
    return;
  }
  if (running) {
    res.writeHead(409).end('A run is already in progress.');
    return;
  }

  let request;
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 65_536) {
        res.writeHead(413).end('Request is too long.');
        return;
      }
    }
    request = JSON.parse(body).request;
    if (typeof request !== 'string' || !request.trim() || request.length > 16_000) {
      res.writeHead(400).end('Enter a request of 1–16,000 characters.');
      return;
    }
  } catch {
    res.writeHead(400).end('Invalid JSON request.');
    return;
  }

  // Recheck after reading the body: another request may have started meanwhile.
  if (running) {
    res.writeHead(409).end('A run is already in progress.');
    return;
  }
  running = true;
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  const emit = (event) => {
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 15_000);

  try {
    const instructions = await readFile(join(root, 'AGENTS.md'), 'utf8');
    if (!instructions.trim()) throw new Error('AGENTS.md is empty.');
    await runWorkflow(request, instructions, createAgent(root, controller.signal), emit);
  } catch (error) {
    emit({ type: 'error', message: error.message });
  } finally {
    clearInterval(heartbeat);
    running = false;
    res.end();
  }
});

server.listen(port, host, () => console.log(`AGENTS.md demo: ${origin}`));
