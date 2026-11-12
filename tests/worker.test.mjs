import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from '../agent/main.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
class MemoryRelay {
  constructor(key) { this.key = key; this.repo = 'owner/private'; this.files = new Map(); this.n = 0; }
  async verify() {}
  async read(path) { return structuredClone(this.files.get(path) || null); }
  async write(path, value, sha) {
    assert.equal(sha, this.files.get(path)?.sha); const id = String(++this.n); this.files.set(path, { sha: id, value: structuredClone(value) }); return { content: { sha: id } };
  }
}
const command = (type, taskId, payload = {}) => ({ id: crypto.randomUUID(), type, taskId, payload, at: new Date().toISOString() });
test('worker runs approval -> manual handoff -> response; restart and replay do not duplicate execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctf-worker-')), r = new MemoryRelay(await keyFromSecret(Buffer.alloc(32, 7).toString('base64url'))), cfg = { profiles: {} }, browser = { close() {} };
  try {
    const w = new Worker(r, cfg, browser, dir); await w.start();
    const id = crypto.randomUUID(), c = command('create', id, { name: 'Safe', category: 'misc', description: 'No remote target', provider: 'chatgpt', files: [] });
    await w.process(c); await w.process(command('approve', id, { revision: 1 }));
    const op = w.state.tasks[id].pending.id; await w.runTask(id, op, new AbortController().signal);
    assert.equal(w.state.tasks[id].pending.stage, 'manual');
    await w.process(command('response', id, { text: 'FLAG: DEMO{test}' }));
    const count = w.state.tasks[id].messages.length; await w.process(c); assert.equal(w.state.tasks[id].messages.length, count);
    const contents = await readFile(join(dir, 'state.json'), 'utf8'); assert.equal(contents.includes('DEMO{test}'), false);
    r.files.delete('lease.json'); const restart = new Worker(r, cfg, browser, dir); await restart.start();
    assert.equal(restart.state.tasks[id].candidateFlag, 'DEMO{test}'); assert.equal(restart.state.tasks[id].pending, null);
    await restart.process(command('shell', id)); assert.equal(restart.state.audit.at(-1).text.includes('ditolak'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('uncertain send is never replayed after restart and only one worker holds lease', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctf-restart-')), r = new MemoryRelay(await keyFromSecret(Buffer.alloc(32, 8).toString('base64url'))), cfg = { profiles: {} }, browser = { close() {} };
  try {
    const w = new Worker(r, cfg, browser, dir); await w.start(); const id = crypto.randomUUID();
    await w.process(command('create', id, { name: 'Safe', category: 'misc', description: 'Sample', provider: 'chatgpt', files: [] }));
    await w.process(command('approve', id, { revision: 1 })); w.state.tasks[id].pending.stage = 'sending'; await w.save();
    const other = new Worker(r, cfg, browser, dir); await assert.rejects(other.start(), /Worker lain/);
    r.files.delete('lease.json'); await other.start(); assert.equal(other.state.tasks[id].status, 'WAITING_FOR_USER'); assert.equal(other.state.tasks[id].pending, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('pause aborts an actual running operation and resume waits for user without replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ctf-cancel-')), r = new MemoryRelay(await keyFromSecret(Buffer.alloc(32, 9).toString('base64url')));
  const cfg = { profiles: { 'chatgpt:default': { mode: 'automated', freeTierVerified: true, verificationEvidence: 'test only', automationPermissionEvidence: 'test only' } } };
  const browser = { close() {}, async submit(t, p, f, signal, checkpoint) {
    await checkpoint('sent');
    await new Promise((resolve, reject) => { if (signal.aborted) reject(new Error('cancelled')); else signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
  } };
  try {
    const w = new Worker(r, cfg, browser, dir); await w.start(); const id = crypto.randomUUID();
    await w.process(command('create', id, { name: 'Safe', category: 'misc', description: 'Sample', provider: 'chatgpt', files: [] }));
    await w.process(command('approve', id, { revision: 1 })); w.dispatch();
    for (let i = 0; i < 100 && w.state.tasks[id].status !== 'AI_WORKING'; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(w.state.tasks[id].status, 'AI_WORKING'); const operation = w.active.get(id).promise;
    await w.process(command('pause', id)); await operation;
    assert.equal(w.state.tasks[id].status, 'PAUSED'); assert.equal(w.state.tasks[id].pending, null);
    await w.process(command('resume', id)); assert.equal(w.state.tasks[id].status, 'WAITING_FOR_USER');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
