import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyCommand } from '../agent/core.mjs';
import { cleanDeletedTasks } from '../agent/deletion.mjs';

test('delete removes task and audit, retries failed cleanup, preserves shared and unrelated files', async () => {
  const s = initialState(), id = crypto.randomUUID(), fileId = crypto.randomUUID(), sharedId = crypto.randomUUID();
  const file = id => ({ id, chunks: [`files/${id}/0.json`] });
  const own = file(fileId), shared = file(sharedId);
  s.tasks[id] = { id, files: [own], previousResults: [{ solverFiles: [shared] }], messages: [] };
  s.tasks.other = { files: [shared] };
  s.audit = [{ taskId: id, text: 'private' }, { taskId: 'other', text: 'keep' }];
  const c = { id: crypto.randomUUID(), type: 'delete', taskId: id, payload: {} };
  applyCommand(s, c);
  assert.equal(s.tasks[id], undefined); assert.equal(s.audit.length, 1);
  assert.equal(s.processed[c.id].status, 'pending');
  let fail = true; const removed = [];
  const relay = { async read(path) { return { sha: path }; }, async remove(path) { if (fail) throw Error('offline'); removed.push(path); } };
  await assert.rejects(cleanDeletedTasks(s, relay), /offline/);
  assert.ok(s.deletions[id]); assert.equal(s.processed[c.id].status, 'pending');
  fail = false; await cleanDeletedTasks(s, relay);
  assert.deepEqual(removed, own.chunks); assert.equal(s.processed[c.id].status, 'ok');
  assert.equal(Object.keys(s.deletions).length, 0);
  assert.equal(applyCommand(s, c), false);
});
