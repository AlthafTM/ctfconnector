import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function harness(command) {
  const nodes = new Map();
  class Node {
    constructor() { this.dataset = {}; this.attributes = {}; this.disabled = false; this.textContent = ''; this.isConnected = true; this.children = []; }
    set id(value) { nodes.set(value, this); }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    hasAttribute(k) { return k === 'data-command-disabled' ? this.dataset.commandDisabled !== undefined : k in this.attributes; }
    querySelectorAll(selector) { return selector === '[data-command-disabled]' ? this.children.filter(n => n.hasAttribute('data-command-disabled')) : this.children.filter(n => n.control); }
    querySelector() { return null; }
    prepend(n) { this.children.unshift(n); }
    remove() { for (const [id, n] of nodes) if (n === this) nodes.delete(id); }
    closest() { return null; }
  }
  const view = new Node(), notice = new Node(), control = new Node(); control.control = true; control.textContent = 'Setujui prompt'; view.children.push(control);
  nodes.set('task-view', view); nodes.set('notice', notice);
  const source = (await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').split('function field(')[0];
  const context = vm.createContext({ document: { getElementById: id => nodes.get(id), createElement: () => new Node() }, crypto, setTimeout: () => 1, clearTimeout() {}, Date });
  vm.runInContext(source + '\nfunction poll() {}\nselected="task"; relay={command: globalThis.command}; globalThis.api={action,send,syncPending,pendingCommands,approvePrompt,setupApproval:(s,fn)=>{state=s;signedIn=true;send=fn;}};', Object.assign(context, { command }));
  return { ...context.api, view, notice, control, nodes };
}

test('approval stays visibly pending until ACK and duplicate commands are blocked', async () => {
  let finish, calls = 0;
  const h = await harness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const sending = h.action(h.control, () => h.send('approve', 'task', {}));
  assert.equal(h.control.disabled, true);
  assert.equal(h.control.attributes['aria-busy'], 'true');
  await assert.rejects(h.send('reject', 'task'), /masih menunggu/);
  finish('command-id'); await sending;
  assert.equal(calls, 1); assert.equal(h.control.disabled, true);
  assert.match(h.nodes.get('task-command-status').textContent, /menunggu konfirmasi/);
  h.pendingCommands.clear(); h.syncPending();
  assert.equal(h.control.disabled, false);
  assert.equal(h.control.textContent, 'Setujui prompt');
});

test('failed relay write restores controls and shows an error instead of success', async () => {
  const h = await harness(async () => { throw new Error('Network unavailable'); });
  await h.action(h.control, () => h.send('approve', 'task'));
  assert.equal(h.pendingCommands.size, 0); assert.equal(h.control.disabled, false);
  assert.equal(h.notice.dataset.kind, 'error'); assert.match(h.notice.textContent, /Network unavailable/);
});

test('approval accepts textarea line endings without requiring a false edit', async () => {
  const h = await harness(), task = { id: 'task', revision: 5, prompt: 'CTF\r\nquestion\r\n' }, calls = [];
  h.setupApproval({ processed: {}, tasks: { task } }, async (...args) => { calls.push(args); });
  await h.approvePrompt(task, 'CTF\nquestion\n');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'approve'); assert.equal(calls[0][2].revision, 5);
});

test('approval saves changed text and approves only its ACKed new revision', async () => {
  const h = await harness(), task = { id: 'task', revision: 5, prompt: 'original' }, state = { processed: {}, tasks: { task } }, calls = [];
  h.setupApproval(state, async (type, id, payload) => {
    calls.push({ type, payload });
    if (type === 'edit') { state.tasks.task = { ...task, prompt: payload.text, revision: 6 }; state.processed.editId = { status: 'ok' }; return 'editId'; }
  });
  await h.approvePrompt(task, 'edited prompt');
  assert.deepEqual(calls.map(c => c.type), ['edit', 'approve']); assert.equal(calls[1].payload.revision, 6);
});
