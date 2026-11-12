import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { initialState, applyCommand } from '../agent/core.mjs';
import { materializeTask, saveResult, inside } from '../agent/workspace.mjs';
import { promptMakerInstructions } from '../web/operator-prompt.mjs';
import { BrowserManager } from '../agent/browser.mjs';
const cmd = (type, id, payload = {}) => ({ id: crypto.randomUUID(), type, taskId: id, payload, at: new Date().toISOString() });
function create(photo = false) {
  const s = initialState(), id = crypto.randomUUID();
  applyCommand(s, cmd('create', id, { name: 'Fixture operator', category: 'auto', provider: 'claude', description: photo ? '' : 'Latihan tanpa target', files: [], inputMode: photo ? 'photo' : 'text' }));
  return { s, id, t: s.tasks[id] };
}
function ready() {
  const item = create(), { s, id, t } = item;
  applyCommand(s, cmd('approve', id, { revision: 1 })); t.pending.stage = 'operator'; t.status = 'WAITING_FOR_OPERATOR';
  applyCommand(s, cmd('operator_settings', id, { model: 'Sonnet 5', thinking: 'off', freeTier: true, evidence: 'TEST UI receipt' }));
  applyCommand(s, cmd('take', id, { operationId: t.pending.id })); return item;
}
test('photo cannot be approved until it has an explicit text transcription', () => {
  const { s, id, t } = create(true); assert.equal(t.status, 'WAITING_FOR_TRANSCRIPTION'); assert.equal(t.prompt, '');
  assert.throws(() => applyCommand(s, cmd('approve', id, { revision: 1 })));
  applyCommand(s, cmd('transcribe', id, { text: 'RSA ciphertext dan modulus dari foto latihan.' }));
  assert.equal(t.status, 'WAITING_FOR_APPROVAL'); assert.equal(t.category, 'crypto'); assert.match(t.prompt, /LINK_AI:/);
});
test('Sonnet 5.5, thinking low/on, unknown free tier, and stale settings cannot authorize take', () => {
  const { s, id, t } = create();
  for (const payload of [
    { model: 'Sonnet 5.5', thinking: 'off', freeTier: true },
    { model: 'Sonnet 5', thinking: 'low', freeTier: true },
    { model: 'Sonnet 5', thinking: 'off', freeTier: false }
  ]) assert.throws(() => applyCommand(s, cmd('operator_settings', id, { ...payload, evidence: 'TEST' })));
  applyCommand(s, cmd('approve', id, { revision: 1 })); t.status = 'WAITING_FOR_OPERATOR'; t.pending.stage = 'operator';
  assert.throws(() => applyCommand(s, cmd('take', id, { operationId: t.pending.id })));
  applyCommand(s, cmd('operator_settings', id, { model: 'Sonnet 5', thinking: 'off', freeTier: true, evidence: 'TEST' }));
  t.operatorSettings.observedAt -= 600001; assert.throws(() => applyCommand(s, cmd('take', id, { operationId: t.pending.id })));
});
test('result requires actual URL and solver only when necessary; completion is not a shortcut', () => {
  const { s, id, t } = ready(); assert.equal(t.status, 'AI_WORKING');
  assert.throws(() => applyCommand(s, cmd('result', id, { flag: 'DEMO{fixture}', chatUrl: 'https://evil.test/a', solverRequired: false })));
  assert.throws(() => applyCommand(s, cmd('result', id, { flag: 'DEMO{fixture}', chatUrl: 'https://claude.ai/chat/fixture', solverRequired: true })));
  applyCommand(s, cmd('result', id, { flag: 'DEMO{fixture}', chatUrl: 'https://claude.ai/chat/fixture', solverRequired: false }));
  assert.equal(t.status, 'COMPLETED'); assert.deepEqual(t.result.solverFiles, []); assert.equal(t.result.thinking, 'off');
  const other = create(); other.t.status = 'WAITING_FOR_USER'; assert.throws(() => applyCommand(other.s, cmd('complete', other.id)));
});
test('question and answer use the same task while preserving independent tasks', () => {
  const { s, id, t } = ready(); applyCommand(s, cmd('question', id, { text: 'Target port mana?' }));
  assert.equal(t.status, 'WAITING_FOR_USER'); applyCommand(s, cmd('answer', id, { text: 'Port latihan 1234' })); assert.equal(t.status, 'AI_WORKING');
  applyCommand(s, cmd('stop', id)); assert.throws(() => applyCommand(s, cmd('question', id, { text: 'Revive?' })));
});
test('local packet preserves original inputs, approved revisions, and optional solver output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctf-workspace-')), bytes = Buffer.from('fixture input'), { t } = create();
  const file = { id: crypto.randomUUID(), name: '../fixture.bin', size: bytes.length, digest: createHash('sha256').update(bytes).digest('base64') };
  t.files = [file]; const relay = { async download() { return bytes; } };
  try {
    const directory = await materializeTask(root, t, relay), packet = JSON.parse(await readFile(join(directory, 'challenge.json'), 'utf8'));
    assert.deepEqual(await readFile(packet.files[0].localPath), bytes);
    await assert.rejects(access(join(directory, 'approved-prompt-r1.txt')));
    t.approvedRevision = 1; await materializeTask(root, t, relay); assert.equal(await readFile(join(directory, 'approved-prompt-r1.txt'), 'utf8'), t.prompt);
    t.result = { flag: 'DEMO{fixture}', chatUrl: 'https://claude.ai/chat/fixture', solverRequired: false, solverFiles: [] };
    await saveResult(root, t, relay); assert.equal((await readFile(join(directory, 'flag.txt'), 'utf8')).trim(), 'DEMO{fixture}'); await assert.rejects(access(join(directory, 'solver')));
    await writeFile(packet.files[0].localPath, 'tampered'); await assert.rejects(materializeTask(root, t, relay), /tidak ditimpa/);
    assert.throws(() => inside(directory, '../outside.txt'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('prompt maker knows website, text-first input, exact model and conditional solver deliverables', () => {
  const prompt = promptMakerInstructions();
  for (const expected of ['https://althaftm.github.io/ctfconnector/', 'Sonnet 5', 'Thinking OFF', 'challenge.txt', 'screenshots/', 'solverRequired', 'di-ack']) assert.ok(prompt.includes(expected));
});
test('needed solver is published and a later revision archives the old result', () => {
  const { s, id, t } = ready(), file = { id: crypto.randomUUID(), name: 'solver-fixture.py', size: 1, chunks: [] };
  applyCommand(s, cmd('result', id, { flag: 'DEMO{fixture}', chatUrl: 'https://claude.ai/chat/fixture', solverRequired: true, solverFiles: [file] }));
  assert.equal(t.result.solverFiles[0].name, 'solver-fixture.py');
  applyCommand(s, cmd('switch', id, { provider: 'claude', profile: 'default' }));
  assert.equal(t.result, null); assert.equal(t.candidateFlag, null); assert.equal(t.previousResults.length, 1); assert.equal(t.status, 'WAITING_FOR_APPROVAL');
});
test('Claude cannot silently use the legacy browser automation adapter', async () => {
  const browser = new BrowserManager({});
  await assert.rejects(browser.submit({ provider: 'claude' }, {}, [], new AbortController().signal, () => {}), /aplikasi desktop/);
});
test('quota handoff preserves scope and old chat, requires fresh settings and new session', () => {
 const {s,id,t}=ready();
 applyCommand(s,cmd('session',id,{url:'https://claude.ai/chat/old-account'}));
 assert.throws(()=>applyCommand(s,cmd('account_handoff',id,{account:'akun-2',context:'progress'})));
 applyCommand(s,cmd('report_limit',id,{text:'Fixture: quota exhausted'}));
 assert.throws(()=>applyCommand(s,cmd('account_handoff',id,{account:'default',context:'progress'})));
 applyCommand(s,cmd('account_handoff',id,{account:'akun-2',context:'Fixture progress; no new target'}));
 assert.equal(t.status,'WAITING_FOR_OPERATOR');assert.equal(t.approvedRevision,t.revision);assert.equal(t.sessionUrl,null);
 assert.equal(t.accountHistory[0].chatUrl,'https://claude.ai/chat/old-account');assert.match(t.pending.text,/Fixture progress/);
 assert.throws(()=>applyCommand(s,cmd('take',id,{operationId:t.pending.id})));
 applyCommand(s,cmd('operator_settings',id,{model:'Sonnet 5',thinking:'off',freeTier:true,evidence:'Fixture new account UI'}));
 applyCommand(s,cmd('take',id,{operationId:t.pending.id}));
 assert.throws(()=>applyCommand(s,cmd('session',id,{url:'https://claude.ai/chat/old-account'})));
 assert.throws(()=>applyCommand(s,cmd('result',id,{flag:'DEMO{x}',chatUrl:'https://claude.ai/chat/old-account',solverRequired:false})));
 applyCommand(s,cmd('session',id,{url:'https://claude.ai/chat/new-account'}));
 applyCommand(s,cmd('report_limit',id,{text:'Fixture second limit'}));
 assert.throws(()=>applyCommand(s,cmd('account_handoff',id,{account:'default',context:'progress'})));
 applyCommand(s,cmd('stop',id));assert.throws(()=>applyCommand(s,cmd('account_handoff',id,{account:'akun-3',context:'progress'})));
});
