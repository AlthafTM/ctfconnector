import { credential } from '../agent/config.mjs';
const token = credential(), root = 'https://api.github.com/repos/AlthafTM/ctfconnector';
async function request(path, method = 'GET', body) {
  const r = await fetch(root + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { const e = new Error(`GitHub Pages ${r.status}: ${await r.text()}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
const mode = process.argv[2] || 'status';
if (mode === 'enable') {
  let pages;
  try { pages = await request('/pages'); } catch (e) { if (e.status !== 404) throw e; }
  if (!pages) pages = await request('/pages', 'POST', { build_type: 'workflow' });
  else if (pages.build_type !== 'workflow') pages = await request('/pages', 'PUT', { build_type: 'workflow' });
  console.log(JSON.stringify({ url: pages?.html_url, build_type: pages?.build_type }));
} else {
  const [pages, runs] = await Promise.all([request('/pages'), request('/actions/runs?per_page=3')]);
  console.log(JSON.stringify({ pages: { url: pages.html_url, status: pages.status, build_type: pages.build_type }, runs: runs.workflow_runs.map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion, sha: r.head_sha, url: r.html_url })) }));
}
