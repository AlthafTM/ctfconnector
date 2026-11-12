// LOCAL TEST ONLY: in-memory GitHub protocol fixture, never deployed to Pages.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
import { Worker } from '../agent/main.mjs';
const files = new Map(); let seq = 0;
async function github(url, options = {}) {
  const path = new URL(url, 'http://localhost').pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '').replace(/^\/api/, '');
  if (options.headers?.Authorization !== 'Bearer test-only') return new Response('{}', { status: 401 });
  if (!path) return Response.json({ private: true, default_branch: 'main' });
  if (path.startsWith('/git/trees/')) return Response.json({ tree: [...files.keys()].map(path => ({ path, type: 'blob' })), truncated: false });
  const name = path.replace(/^\/contents\//, '');
  if (options.method === 'PUT') {
    const b = JSON.parse(options.body);
    if (files.get(name)?.sha !== b.sha) return new Response('{}', { status: 409 });
    files.set(name, { type: 'file', content: b.content, sha: String(++seq) }); return Response.json({ content: { sha: String(seq) } });
  }
  if (options.method === 'DELETE') { files.delete(name); return Response.json({}); }
  return files.has(name) ? Response.json(files.get(name)) : new Response('{}', { status: 404 });
}
const relay = new GitHubRelay('test/private', 'test-only', await keyFromSecret('A'.repeat(43)), github);
const worker = new Worker(relay, { profiles: {} }, { close() {} }, await mkdtemp(join(tmpdir(), 'ctf-ui-'))); await worker.start();
let ticking = false; const interval = setInterval(async () => { if (ticking) return; ticking = true; try { await worker.tick(); } catch(e) { console.error(e.message); } finally { ticking = false; } }, 300);
const root = resolve('web');
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await github(req.url, { method: req.method, headers: { Authorization: req.headers.authorization }, body: Buffer.concat(chunks).toString() });
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(await r.text()); return;
    }
    if (req.url === '/test-bootstrap.mjs') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(`const original=globalThis.fetch;globalThis.fetch=(url,opts)=>original(String(url).startsWith('https://api.github.com/repos/test/private')?String(url).replace('https://api.github.com/repos/test/private','/api'):url,opts);await import('/app.mjs');`); return;
    }
    const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) throw Error('path');
    let body = await readFile(path);
    if (extname(path) === '.html') body = Buffer.from(body.toString().replace('src="./app.mjs"', 'src="/test-bootstrap.mjs"').replace('connect-src https://api.github.com', "connect-src 'self' https://api.github.com"));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end(e.message); }
});
server.listen(4174, '127.0.0.1', () => console.log('TEST FIXTURE ONLY http://127.0.0.1:4174 / repo=test/private token=test-only key=' + 'A'.repeat(43)));
process.on('SIGINT', () => { clearInterval(interval); server.close(); worker.stop(); });
