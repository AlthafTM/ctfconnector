import { config } from '../agent/config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
const cfg = config(), relay = new GitHubRelay(cfg.repo, cfg.token, await keyFromSecret(cfg.secret)); await relay.verify();
const before = await relay.read('state.json'), task = Object.values(before?.value.tasks || {}).find(t => t.name.startsWith('TEST transport'));
if (!task) throw new Error('Jalankan live-check lebih dulu untuk membuat task TEST, bukan challenge asli.');
const id = await relay.command('message', task.id, { text: '[TEST] Cek ack command dari worker background yang benar-benar berjalan. Tidak diteruskan ke AI.', followup: false });
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 2000)); const state = await relay.read('state.json');
  if (state?.value.processed[id]) {
    if (state.value.processed[id].status !== 'ok') throw new Error('Command ditolak worker.');
    console.log(JSON.stringify({ result: 'PASS', commandId: id, heartbeat: state.value.heartbeat, workerId: state.value.workerId, externalAIContacted: false })); process.exit(0);
  }
}
throw new Error('Belum ada ack dalam 30 detik. Periksa log worker; jangan anggap sukses.');
