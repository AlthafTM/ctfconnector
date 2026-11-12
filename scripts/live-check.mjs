// Opt-in integration check against the configured PRIVATE relay. No external AI is contacted.
import assert from 'node:assert/strict';
import { config, localDir } from '../agent/config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
import { Worker } from '../agent/main.mjs';
const cfg = config(), relay = new GitHubRelay(cfg.repo, cfg.token, await keyFromSecret(cfg.secret));
const worker = new Worker(relay, { ...cfg, profiles: {} }, { close() {} }, localDir);
await worker.start();
async function send(type, taskId, payload = {}) {
  const id = await relay.command(type, taskId, payload); await worker.tick();
  assert.equal(worker.state.processed[id].status, 'ok'); return id;
}
try {
  const bytes = new TextEncoder().encode('Harmless connector transport test. No solver execution.');
  const file = await relay.upload(new File([bytes], 'connector-smoke.txt', { type: 'text/plain' }));
  assert.deepEqual(await relay.download(file), bytes);
  const taskId = crypto.randomUUID();
  const create = await send('create', taskId, { name: 'TEST transport / tanpa AI', category: 'misc', provider: 'chatgpt', description: 'Uji transport saja. Teks FLAG di respons berikut adalah fixture pengujian, bukan hasil solver.', scope: 'hanya fixture test connector', files: [file] });
  assert.equal(worker.state.tasks[taskId].status, 'WAITING_FOR_APPROVAL');
  await send('approve', taskId, { revision: 1 });
  for (let i = 0; i < 100 && worker.state.tasks[taskId].pending?.stage !== 'manual'; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(worker.state.tasks[taskId].pending.stage, 'manual');
  await worker.chain;
  await send('response', taskId, { text: '[FIXTURE TEST, bukan respons AI]\nFLAG: DEMO{connector_transport_only}' });
  assert.equal(worker.state.tasks[taskId].candidateFlag, 'DEMO{connector_transport_only}');
  await send('complete', taskId);
  const snapshot = await relay.read('state.json'); assert.equal(snapshot.value.tasks[taskId].status, 'COMPLETED');
  assert.ok(snapshot.value.processed[create]);
  console.log(JSON.stringify({ result: 'PASS', relay: cfg.repo, taskId, checks: ['authenticated private relay', 'encrypted command roundtrip', 'binary checksum roundtrip', 'Indonesian prompt approval', 'manual handoff', 'response relay and candidate extraction', 'persistent completed snapshot'], externalAIContacted: false }));
} finally {
  await worker.stop(); const lease = await relay.read('lease.json');
  if (lease?.value.owner === worker.owner) await relay.write('lease.json', { owner: worker.owner, expires: 0 }, lease.sha);
}
