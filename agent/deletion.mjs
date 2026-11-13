export function filePaths(value, paths = new Set()) {
  if (!value || typeof value !== 'object') return paths;
  if (Array.isArray(value.chunks) && /^[0-9a-f-]{36}$/.test(value.id)) {
    for (const path of value.chunks) if (typeof path === 'string' && new RegExp(`^files/${value.id}/[0-9]+\\.json$`).test(path)) paths.add(path);
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') filePaths(child, paths);
  return paths;
}

export async function cleanDeletedTasks(state, relay) {
  for (const [id, job] of Object.entries(state.deletions || {})) {
    const shared = filePaths(state.tasks);
    for (const path of job.paths) {
      if (shared.has(path)) continue;
      const file = await relay.read(path);
      if (file) await relay.remove(path, file.sha);
    }
    state.processed[job.commandId] = { status: 'ok', at: new Date().toISOString() };
    delete state.deletions[id];
  }
}
