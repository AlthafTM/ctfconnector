import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'https://althaftm.github.io/ctfconnector/';
const paths = ['index.html', 'app.mjs', 'relay.mjs', 'crypto.mjs', 'operator-prompt.mjs', 'style.css', 'mobile.css'];
const results = await Promise.allSettled(paths.map(async path => {
  const r = await fetch(base + (path === 'index.html' ? '' : path), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, 200, path);
  const remote = (await r.text()).replaceAll('\r\n', '\n'), local = (await readFile(new URL('../web/' + path, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(remote, local, `Deployment belum sesuai source lokal: ${path}`);
  if (path.endsWith('.mjs')) assert.match(r.headers.get('content-type'), /javascript/);
  return { path, status: 200, sourceMatches: true };
}));
for (const result of results) {
  if (result.status === 'fulfilled') console.log(JSON.stringify(result.value));
  else { console.error(result.reason.message.slice(0, 400)); process.exitCode = 1; }
}
