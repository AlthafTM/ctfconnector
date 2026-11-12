import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyCommand, validSessionUrl } from '../agent/core.mjs';
const command = (type, taskId, payload = {}) => ({ id: crypto.randomUUID(), type, taskId, payload, at: new Date().toISOString() });
function task() {
  const s = initialState(), id = crypto.randomUUID();
  const create = command('create', id, { name: 'Harmless sample', description: 'Cari teks flag dari file latihan.', category: 'misc', provider: 'chatgpt', files: [], scope: 'hanya file latihan' });
  applyCommand(s, create); return { s, id, t: s.tasks[id], create };
}
test('initial prompt uses casual English, stays scoped, and waits for approval', () => {
  const { t } = task(); assert.equal(t.status, 'WAITING_FOR_APPROVAL'); assert.equal(t.pending, null);
  assert.match(t.prompt, /pls solve this/); assert.match(t.prompt, /hanya file latihan/); assert.equal((t.prompt.match(/^## \d\./gm) || []).length, 6);
});
test('approval revision and duplicate commands are enforced', () => {
  const { s, id, t, create } = task(); assert.equal(applyCommand(s, create), false);
  applyCommand(s, command('edit', id, { text: 'Prompt yang diedit user' }));
  assert.throws(() => applyCommand(s, command('approve', id, { revision: 1 })), /kedaluwarsa/);
  const approve = command('approve', id, { revision: 2 }); applyCommand(s, approve);
  assert.equal(t.pending.text, 'Prompt yang diedit user'); assert.equal(applyCommand(s, approve), false);
});
test('reject, pause, resume, stop and retry change worker state', () => {
  const { s, id, t } = task(); applyCommand(s, command('reject', id)); assert.equal(t.status, 'WAITING_FOR_USER');
  applyCommand(s, command('edit', id, { text: 'Revisi baru' })); applyCommand(s, command('pause', id)); assert.equal(t.status, 'PAUSED');
  applyCommand(s, command('resume', id)); assert.equal(t.status, 'WAITING_FOR_APPROVAL');
  applyCommand(s, command('stop', id)); applyCommand(s, command('retry', id)); assert.equal(t.status, 'WAITING_FOR_APPROVAL'); assert.equal(t.pending, null);
});
test('emergency prevents approvals and reset does not resume stopped tasks', () => {
  const { s, id, t } = task(); applyCommand(s, command('emergency', null)); assert.equal(t.status, 'STOPPED');
  assert.throws(() => applyCommand(s, command('approve', id, { revision: 1 })));
  applyCommand(s, command('reset_emergency', null)); assert.equal(t.status, 'STOPPED'); assert.equal(s.emergency, false);
});
test('challenge context is isolated; provider switch requires new approval', () => {
  const { s, id, t } = task(), id2 = crypto.randomUUID();
  applyCommand(s, command('create', id2, { name: 'Other', description: 'Other data', category: 'web', provider: 'claude', files: [] }));
  applyCommand(s, command('message', id, { text: 'Catatan hanya A' }));
  assert.equal(s.tasks[id2].messages.some(m => m.text === 'Catatan hanya A'), false);
  applyCommand(s, command('switch', id, { provider: 'gemini', profile: 'default' }));
  assert.equal(t.status, 'WAITING_FOR_APPROVAL'); assert.match(t.prompt, /Catatan hanya A/); assert.equal(t.approvedRevision, null);
});
test('candidate flags are retained without claiming scoreboard acceptance', () => {
  const { s, id, t } = task(); applyCommand(s, command('approve', id, { revision: 1 }));
  t.pending.stage = 'manual'; t.status = 'WAITING_FOR_USER';
  applyCommand(s, command('response', id, { text: 'Hasil latihan\nFLAG: DEMO{harmless}', url: 'https://chatgpt.com/c/demo-123' }));
  assert.equal(t.candidateFlag, 'DEMO{harmless}'); assert.equal(t.status, 'WAITING_FOR_USER'); assert.equal(t.pending, null);
  const follow = command('message', id, { text: 'Periksa bukti dalam scope ini', followup: true }); applyCommand(s, follow);
  assert.equal(t.sessionUrl, 'https://chatgpt.com/c/demo-123'); assert.equal(t.pending.kind, 'followup');
});
test('arbitrary commands and non-provider URLs are rejected', () => {
  const { s, id } = task(); assert.throws(() => applyCommand(s, command('shell', id, { text: 'calc.exe' })));
  for (const url of ['http://chatgpt.com/c/a', 'https://evil.example/c/a', 'https://chatgpt.com.evil.test/c/a', 'https://chatgpt.com/c/a?token=secret', 'https://chatgpt.com/login']) assert.throws(() => validSessionUrl('chatgpt', url));
});
test('instructions during provider work are queued in order and stop clears unsent followups', () => {
  const { s, id, t } = task(); applyCommand(s, command('approve', id, { revision: 1 })); t.status = 'AI_WORKING';
  applyCommand(s, command('message', id, { text: 'Instruksi pertama dalam scope', followup: true }));
  applyCommand(s, command('message', id, { text: 'Instruksi kedua dalam scope', followup: true }));
  assert.equal(t.followups.length, 2);
  applyCommand(s, command('response', id, { text: 'Respons awal' })); assert.equal(t.pending.text, 'Instruksi pertama dalam scope');
  applyCommand(s, command('stop', id)); assert.equal(t.pending, null); assert.deepEqual(t.followups, []);
});
test('additional attachments invalidate previous approval and regenerate scoped handoff', () => {
  const { s, id, t } = task(); applyCommand(s, command('attachments', id, { files: [{ name: 'safe.txt', size: 1, digest: 'test' }], text: 'File tambahan untuk dianalisis' }));
  assert.equal(t.revision, 2); assert.equal(t.approvedRevision, null); assert.match(t.prompt, /safe.txt/); assert.equal(t.status, 'WAITING_FOR_APPROVAL');
});
test('manual quota reports stop the profile and reset requires explicit user action', () => {
  const { s, id, t } = task(); applyCommand(s, command('report_limit', id, { text: 'Reset pukul 16:00 menurut provider' }));
  assert.equal(t.status, 'RATE_LIMITED'); assert.equal(s.providers[0].remaining, 'Unknown'); assert.match(s.providers[0].limitNotice, /16:00/);
  applyCommand(s, command('limit_reset', id)); assert.equal(s.providers[0].status, 'UNVERIFIED'); assert.equal(t.status, 'RATE_LIMITED');
});
test('auto triage only classifies category and uses a category-specific prompt plan', () => {
  const s = initialState(), id = crypto.randomUUID();
  applyCommand(s, command('create', id, { name: 'RSA sample', category: 'auto', description: 'RSA ciphertext with modulus n', provider: 'chatgpt', files: [] }));
  assert.equal(s.tasks[id].category, 'crypto'); assert.match(s.tasks[id].prompt, /list the algorithm, parameters, nonces/); assert.equal(s.tasks[id].pending, null);
});
