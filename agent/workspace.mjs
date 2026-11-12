import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { WEBSITE, SOLVER_POLICY, promptMakerInstructions } from './operator-prompt.mjs';
export function challengeDirectory(root, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('ID soal tidak valid.');
  return resolve(root, id);
}
export function inside(directory, name) {
  const full = resolve(directory, name), rel = relative(directory, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path harus berada dalam folder soal.');
  return full;
}
export function workspaceMarker(task) { return `${task.revision}:${task.approvedRevision}:${task.messages.at(-1)?.id || ''}:${task.result?.at || ''}`; }
export async function materializeTask(root, task, relay) {
  const directory = challengeDirectory(root, task.id);
  await mkdir(resolve(directory, 'input'), { recursive: true });
  await mkdir(resolve(directory, 'screenshots'), { recursive: true });
  const files = [];
  for (const file of task.files) {
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'artifact';
    const path = inside(directory, `input/${file.id}-${name}`);
    let existing;
    try { existing = await readFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existing) {
      if (existing.length !== file.size || createHash('sha256').update(existing).digest('base64') !== file.digest) throw new Error('Artefak lokal berubah. Pulihkan/salin secara eksplisit; file asli tidak ditimpa.');
    } else await writeFile(path, await relay.download(file), { mode: 0o600, flag: 'wx' });
    files.push({ ...file, localPath: path });
  }
  await writeFile(resolve(directory, 'challenge.json'), JSON.stringify({ id: task.id, name: task.name, description: task.description, scope: task.scope, files, website: WEBSITE, policy: SOLVER_POLICY,
    status: task.status, revision: task.revision, approvedRevision: task.approvedRevision, autoAccept: !!task.autoAccept, outgoing: task.outgoing || null, outgoingHistory: task.outgoingHistory || [], profile: task.profile, accountHistory: task.accountHistory || [], accountHandoff: task.accountHandoff || null, sessionUrl: task.sessionUrl, operation: task.pending, question: task.question || null, messages: task.messages, result: task.result || null }, null, 2), { mode: 0o600 });
  await writeFile(resolve(directory, 'prompt-maker.md'), promptMakerInstructions(task.id, directory), { mode: 0o600 });
  await writeFile(resolve(directory, 'prompt-draft.txt'), task.prompt || '', { mode: 0o600 });
  if (task.approvedRevision === task.revision) await writeFile(resolve(directory, `approved-prompt-r${task.revision}.txt`), task.prompt, { mode: 0o600 });
  if (!task.transcriptionRequired && task.description) {
    try { await writeFile(resolve(directory, 'challenge.txt'), task.description, { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return directory;
}
export async function saveResult(root, task, relay) {
  const directory = challengeDirectory(root, task.id), result = task.result;
  await mkdir(directory, { recursive: true });
  for (const [name, value] of [['flag.txt', result.flag + '\n'], ['chat-url.txt', result.chatUrl + '\n'], ['result.json', JSON.stringify(result, null, 2)]]) await writeFile(resolve(directory, name), value, { mode: 0o600 });
  if (result.solverRequired) {
    await mkdir(resolve(directory, 'solver'), { recursive: true });
    for (const file of result.solverFiles) {
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'solver';
      const path = inside(directory, `solver/${file.id}-${name}`);
      try { await writeFile(path, await relay.download(file), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
}
