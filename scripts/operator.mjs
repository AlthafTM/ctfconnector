import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { config } from '../agent/config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
import { materializeTask, challengeDirectory, inside } from '../agent/workspace.mjs';
const [action, id, path] = process.argv.slice(2);
if (!action || action === '--help') {
  console.log('operator.mjs next | prepare <id> | draft <id> <challenge.txt> | outgoing <id> <pesan.txt> | outgoing_take <id> | outgoing_sent <id> | note <id> <note.txt> | question <id> <question.txt> | settings <id> <settings.json> | limit <id> <limit.txt> | account <id> <handoff.json> | take <id> | session <id> <url> | result <id> <result.json>'); process.exit(0);
}
const cfg = config(), relay = new GitHubRelay(cfg.repo, cfg.token, await keyFromSecret(cfg.secret)); await relay.verify();
const snapshot = (await relay.read('state.json'))?.value; if (!snapshot) throw new Error('Worker belum punya state.');
const root = cfg.workspaceRoot || resolve(process.cwd(), '..', 'local');
if (action === 'next') {
  console.log(JSON.stringify(Object.values(snapshot.tasks).filter(t => !['COMPLETED','STOPPED'].includes(t.status)).map(t => ({ id: t.id, name: t.name, status: t.status, testOnly: !!t.testOnly, question: t.question || null, folder: challengeDirectory(root, t.id) })), null, 2)); process.exit(0);
}
const task = snapshot.tasks[id]; if (!task) throw new Error('Task tidak ditemukan.');
const directory = await materializeTask(root, task, relay);
if (action === 'prepare') { console.log(directory); process.exit(0); }
let type, payload;
if (['draft','note','question','limit','outgoing'].includes(action)) {
  const text = await readFile(path, 'utf8'); type = { draft: 'transcribe', note: 'operator_note', question: 'question', limit: 'report_limit', outgoing: 'outgoing' }[action]; payload = { text };
} else if (action === 'account') { type = 'account_handoff'; payload = JSON.parse(await readFile(path, 'utf8')); }
else if (['outgoing_take','outgoing_sent'].includes(action)) { type = action; payload = { id: task.outgoing?.id, revision: task.outgoing?.revision }; }
else if (action === 'settings') { type = 'operator_settings'; payload = JSON.parse(await readFile(path, 'utf8')); }
else if (action === 'take') { type = 'take'; payload = { operationId: task.pending?.id }; }
else if (action === 'session') { type = 'session'; payload = { url: path }; }
else if (action === 'result') {
  type = 'result'; payload = JSON.parse(await readFile(path, 'utf8'));
  const solverFiles = [], paths = payload.solverPaths || [];
  if (!Array.isArray(paths) || paths.length > 10 || (!payload.solverRequired && paths.length)) throw new Error('Daftar solver tidak sesuai kebutuhan.');
  for (const name of paths) {
    if (typeof name !== 'string' || !name.replaceAll('\\', '/').startsWith('solver/')) throw new Error('Solver harus berada di solver/ milik soal ini.');
    const file = await realpath(inside(directory, name)), base = await realpath(directory), rel = relative(base, file);
    if (rel.startsWith('..') || isAbsolute(rel) || !(await stat(file)).isFile()) throw new Error('File solver keluar dari folder soal.');
    solverFiles.push(await relay.upload(new File([await readFile(file)], basename(file), { type: 'application/octet-stream' })));
  }
  payload = { ...payload, solverFiles }; delete payload.solverPaths;
} else throw new Error('Perintah tidak dikenal.');
const commandId = await relay.command(type, id, payload);
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000)); const updated = (await relay.read('state.json'))?.value, ack = updated?.processed[commandId];
  if (!ack) continue;
  if (ack.status !== 'ok') throw new Error(ack.error);
  if (type === 'transcribe') await writeFile(resolve(directory, 'challenge.txt'), payload.text, { mode: 0o600 });
  if (type === 'result') {
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(updated.tasks[id].result, null, 2), { mode: 0o600 });
    await writeFile(resolve(directory, 'flag.txt'), payload.flag + '\n', { mode: 0o600 });
    await writeFile(resolve(directory, 'chat-url.txt'), payload.chatUrl + '\n', { mode: 0o600 });
  }
  await materializeTask(root, updated.tasks[id], relay);
  console.log(JSON.stringify({ acknowledged: true, commandId, taskId: id, website: 'https://althaftm.github.io/ctfconnector/', folder: directory, ...(type === 'outgoing_take' ? { outgoing: updated.tasks[id].outgoing } : {}) })); process.exit(0);
}
throw new Error(`Command ${commandId} tersimpan, tetapi belum di-ack. Periksa status sebelum retry.`);
