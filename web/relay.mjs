import { b64, unb64, seal, open } from './crypto.mjs';
export class GitHubRelay {
  constructor(repo, token, key, fetcher = fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Format repo: owner/private-repo');
    this.repo = repo; this.token = token; this.key = key; this.fetcher = fetcher;
    this.root = `https://api.github.com/repos/${repo}`;
  }
  async api(path = '', options = {}) {
    const r = await this.fetcher(this.root + path, {
      ...options, signal: options.signal ?? AbortSignal.timeout(30000), cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers }
    });
    this.remaining = r.headers.get('x-ratelimit-remaining');
    if (!r.ok) {
      const e = new Error(`GitHub ${r.status}${r.status === 401 ? ': token kedaluwarsa/tidak valid' : r.status === 403 ? ': izin atau rate limit; tunggu sebelum retry' : ''}`);
      e.status = r.status;
      e.retryAfter = Number(r.headers.get('retry-after') || 60);
      throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  async verify() {
    const info = await this.api();
    if (!info.private || info.archived || info.disabled) throw new Error('Relay wajib repo PRIVATE yang aktif.');
    this.branch = info.default_branch;
    return info;
  }
  async read(path) {
    try {
      const file = await this.api(`/contents/${path}?ref=${encodeURIComponent(this.branch || 'main')}`);
      if (file.type !== 'file' || file.size > 6000000) throw new Error('Objek relay bukan file atau terlalu besar.');
      const envelope = file.content ? JSON.parse(new TextDecoder().decode(unb64(file.content.replace(/\s/g, ''))))
        : await this.api(`/contents/${path}?ref=${encodeURIComponent(this.branch || 'main')}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      return { value: await open(this.key, envelope, `${this.repo}/${path}`), sha: file.sha };
    } catch (e) { if (e.status === 404) return null; throw e; }
  }
  async write(path, value, sha) {
    const envelope = await seal(this.key, value, `${this.repo}/${path}`);
    const body = JSON.stringify({
      message: `relay: ${path.split('/')[0]}`, branch: this.branch || 'main',
      content: b64(new TextEncoder().encode(JSON.stringify(envelope))), ...(sha ? { sha } : {})
    });
    for (let attempt = 0; ; attempt++) {
      try { return await this.api(`/contents/${path}`, { method: 'PUT', body }); }
      catch (e) {
        if (e.status !== 409 || attempt >= 3) throw e;
        // Contents writes to different paths can race on the branch head.
        // A changed file SHA is a real competing writer and must remain a conflict.
        const current = await this.read(path);
        if ((current?.sha || undefined) !== (sha || undefined)) throw e;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  async remove(path, sha) {
    return this.api(`/contents/${path}`, { method: 'DELETE', body: JSON.stringify({ message: 'relay: acknowledge command', sha, branch: this.branch }) });
  }
  async commands() {
    const tree = await this.api(`/git/trees/${encodeURIComponent(this.branch || 'main')}?recursive=1`);
    if (tree.truncated) throw new Error('Tree relay terpotong; arsipkan relay sebelum lanjut.');
    return tree.tree.filter(x => /^commands\/[0-9a-f-]{36}\.json$/.test(x.path)).sort((a, b) => a.path.localeCompare(b.path));
  }
  async command(type, taskId, payload = {}) {
    const id = crypto.randomUUID();
    await this.write(`commands/${id}.json`, { id, type, taskId, payload, at: new Date().toISOString() });
    return id;
  }
  async upload(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Maksimum 20 MiB per file.');
    const id = crypto.randomUUID(), bytes = new Uint8Array(await file.arrayBuffer()), chunks = [];
    for (let i = 0; i < bytes.length; i += 384 * 1024) {
      const path = `files/${id}/${chunks.length}.json`;
      await this.write(path, { data: b64(bytes.subarray(i, i + 384 * 1024)) }); chunks.push(path);
    }
    return { id, name: file.name.slice(0, 180), type: file.type || 'application/octet-stream', size: bytes.length, chunks,
      digest: b64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) };
  }
  async download(file) {
    if (!/^[0-9a-f-]{36}$/.test(file.id) || file.size > 20 * 1024 * 1024 || !Array.isArray(file.chunks) || file.chunks.length > 54) throw new Error('Metadata file tidak valid.');
    const parts = [];
    for (let i = 0; i < file.chunks.length; i++) {
      const path = `files/${file.id}/${i}.json`;
      if (file.chunks[i] !== path) throw new Error('Path file tidak valid.');
      const chunk = await this.read(path);
      if (!chunk) throw new Error('Chunk file hilang.');
      parts.push(unb64(chunk.value.data));
    }
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    if (bytes.length !== file.size || b64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) !== file.digest) throw new Error('Checksum file tidak cocok.');
    return bytes;
  }
}
