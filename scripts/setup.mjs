import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { credential, localDir, protect, saveConfig } from '../agent/config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
if (existsSync(resolve(localDir, 'config.json'))) throw new Error('Sudah dikonfigurasi. Gunakan node scripts/pair.mjs untuk pairing; jangan overwrite key.');
const token = credential();
const api = async (path, options = {}) => {
  const r = await fetch('https://api.github.com' + path, { ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`GitHub setup ${r.status}`);
  return r.json();
};
const user = await api('/user');
const name = process.env.CTF_RELAY_NAME || 'ctfconnector-relay';
if (!/^[\w-]+$/.test(name)) throw new Error('Nama repo tidak valid.');
let info;
try { info = await api(`/repos/${user.login}/${name}`); }
catch (e) {
  if (!e.message.endsWith('404')) throw e;
  info = await api('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: true, auto_init: true,
    description: 'Private encrypted relay for CTF Connector. Do not change visibility.' }) });
}
if (!info.private) throw new Error('Relay sudah ada dan PUBLIC. Setup dibatalkan.');
const secret = process.env.CTF_PAIRING_KEY || randomBytes(32).toString('base64url');
const relay = new GitHubRelay(info.full_name, token, await keyFromSecret(secret));
await relay.verify();
if (await relay.read('state.json').catch(() => ({ existing: true }))) throw new Error('Relay sudah memiliki state/key lain. Jangan overwrite.');
const profiles = Object.fromEntries(['chatgpt', 'claude', 'gemini'].map(id => [id + ':default', {
  provider: id, profile: 'default', mode: 'manual', freeTierVerified: false, model: '', verificationEvidence: '',
  automationPermissionEvidence: '', editor: '', submit: '', response: '', busy: '', limit: '', login: '', modelSelector: ''
}]));
profiles['claude:default'].mode = 'operator'; profiles['claude:default'].model = 'Sonnet 5'; profiles['claude:default'].thinking = 'off';
saveConfig({ repo: info.full_name, protectedKey: process.platform === 'win32' ? protect(secret) : undefined,
  browserExecutable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', pollMs: 10000, workspaceRoot: resolve(process.cwd(), '..', 'local'), profiles });
console.log(`Relay private siap: ${info.full_name}. Key disimpan dengan Windows DPAPI.\nJalankan node scripts/pair.mjs secara lokal, lalu node agent/main.mjs. Tidak ada token yang disimpan di repo.`);
