// Real relay/worker test only. No provider prompt or fake AI response is submitted.
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../agent/config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
const cfg = config(), relay = new GitHubRelay(cfg.repo, cfg.token, await keyFromSecret(cfg.secret)); await relay.verify();
const id = crypto.randomUUID();
async function snapshot() { return (await relay.read('state.json')).value; }
async function send(type, payload = {}) {
  const command = await relay.command(type, id, payload);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000)); const s = await snapshot();
    if (s.processed[command]) { assert.equal(s.processed[command].status, 'ok', s.processed[command].error); return s.tasks[id]; }
  }
  throw new Error('Ack timeout. Periksa command sebelum retry.');
}
let t = await send('create', { name: 'TEST operator queue only', testOnly: true, category: 'misc', provider: 'claude', description: 'Transport fixture only. Do not send this task to any AI.', files: [] });
assert.equal(t.status, 'WAITING_FOR_APPROVAL');
await send('approve', { revision: t.revision });
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000)); t = (await snapshot()).tasks[id]; if (t.status === 'WAITING_FOR_OPERATOR') break;
}
assert.equal(t.status, 'WAITING_FOR_OPERATOR');
const directory = resolve(cfg.workspaceRoot, id); await access(resolve(directory, 'approved-prompt-r1.txt'));
const packet = JSON.parse(await readFile(resolve(directory, 'challenge.json'), 'utf8')); assert.equal(packet.approvedRevision, 1);
t = await send('question', { text: 'TEST: jawaban ini hanya memverifikasi relay pertanyaan.' }); assert.equal(t.status, 'WAITING_FOR_USER');
t = await send('answer', { text: 'TEST answer, no external action.' }); assert.equal(t.status, 'WAITING_FOR_OPERATOR');
t = await send('stop'); assert.equal(t.status, 'STOPPED');
console.log(JSON.stringify({ result: 'PASS', taskId: id, folder: directory, checks: ['real worker ack', 'approval', 'native operator queue', 'local approved packet', 'website question/answer', 'stop'], externalAIContacted: false }));
