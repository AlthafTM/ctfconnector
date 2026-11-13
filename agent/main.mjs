import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, localDir } from './config.mjs';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret, seal, open } from '../web/crypto.mjs';
import { initialState, applyCommand, log, recordResponse } from './core.mjs';
import { BrowserManager } from './browser.mjs';
import { materializeTask, saveResult, workspaceMarker } from './workspace.mjs';
import { cleanDeletedTasks } from './deletion.mjs';
export class Worker {
  constructor(relay, cfg, browser, dataDir = localDir) {
    this.relay = relay; this.cfg = cfg; this.browser = browser; this.dir = dataDir;
    this.owner = crypto.randomUUID(); this.active = new Map(); this.localWork = new Map(); this.chain = Promise.resolve(); this.running = true; this.ready = false;
  }
  transaction(fn) { const p = this.chain.then(fn); this.chain = p.catch(() => {}); return p; }
  async save() {
    this.state.sequence = (this.state.sequence || 0) + 1;
    const value = await seal(this.relay.key, this.state, `${this.relay.repo}/local-state`);
    await writeFile(resolve(this.dir, 'state.tmp'), JSON.stringify(value), { mode: 0o600 });
    await rename(resolve(this.dir, 'state.tmp'), resolve(this.dir, 'state.json'));
  }
  async lease() {
    await this.relay.verify();
    const l = await this.relay.read('lease.json');
    if (l && l.value.owner !== this.owner && l.value.expires > Date.now()) throw new Error('Worker lain masih punya lease. Tunggu lease habis; jangan menjalankan dua worker.');
    await this.relay.write('lease.json', { owner: this.owner, expires: Date.now() + 180000 }, l?.sha);
    this.leaseAt = Date.now();
  }
  async start() {
    await mkdir(this.dir, { recursive: true });
    await this.relay.verify(); await this.lease();
    const remote = await this.relay.read('state.json'); this.stateSha = remote?.sha;
    try {
      this.state = await open(this.relay.key, JSON.parse(await readFile(resolve(this.dir, 'state.json'), 'utf8')), `${this.relay.repo}/local-state`);
      if ((remote?.value.sequence || 0) > (this.state.sequence || 0)) this.state = remote.value;
    }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Local state gagal dibaca. Jangan reset key/state; periksa pairing key.'); this.state = remote?.value || initialState(); }
    for (const t of Object.values(this.state.tasks)) if (t.pending && !['queued','operator'].includes(t.pending.stage)) {
      t.pending = null; t.status = 'WAITING_FOR_USER'; log(this.state, t, 'Worker restart saat pengiriman. Periksa conversation dan impor respons; tidak dikirim ulang otomatis.');
    }
    for (const p of this.state.providers) {
      const profiles = Object.values(this.cfg.profiles).filter(x => x.provider === p.id);
      p.profiles = profiles.map(x => ({ profile: x.profile, model: x.model || p.requestedModel, mode: x.mode, freeTierVerified: !!x.freeTierVerified }));
      p.status = 'UNVERIFIED'; p.remaining = 'Unknown';
      if (p.id === 'claude' && profiles.some(x => x.mode === 'operator')) { p.status = 'OPERATOR_REQUIRED'; p.verification = 'ACCOUNT_UI_RECHECK_REQUIRED'; }
    }
    await this.save(); await this.publish(); this.ready = true;
  }
  async publish() {
    if (Date.now() - this.leaseAt > 120000) throw new Error('Lease belum diperbarui; pengiriman dihentikan.');
    this.state.heartbeat = new Date().toISOString(); this.state.workerId = this.owner;
    const result = await this.relay.write('state.json', this.state, this.stateSha);
    this.stateSha = result.content.sha; this.publishedAt = Date.now();
  }
  async process(c) {
    return this.transaction(async () => {
      if (!Object.hasOwn(this.state.processed, c.id)) {
        const next = structuredClone(this.state);
        try { applyCommand(next, c); this.state = next; }
        catch (e) { this.state.processed[c.id] = { status: 'rejected', error: e.message, at: new Date().toISOString() }; log(this.state, null, `Command ${c.type} ditolak: ${e.message}`); }
        if (['ok', 'pending'].includes(this.state.processed[c.id]?.status) && ['delete', 'pause', 'stop','skip', 'emergency', 'report_limit'].includes(c.type)) for (const [id, active] of this.active) {
          const task = this.state.tasks[c.taskId];
          if (c.type === 'emergency' || id === c.taskId || (c.type === 'report_limit' && active.profile === `${task.provider}:${task.profile}`)) active.controller.abort();
        }
        await this.save();
      }
      await this.publish();
    });
  }
  dispatch() {
    if (this.state.emergency || Date.now() - this.leaseAt > 120000) return;
    for (const t of Object.values(this.state.tasks)) {
      if (!t.pending || t.pending.stage !== 'queued' || t.status !== 'SUBMITTING_PROMPT' || this.active.has(t.id)) continue;
      if (this.cfg.workspaceRoot && (t.localRevision !== t.revision || t.localError)) continue;
      // Browser profiles are serialized; independent profiles can keep working.
      if ([...this.active.values()].some(a => a.profile === `${t.provider}:${t.profile}`)) continue;
      const controller = new AbortController();
      const active = { controller, profile: `${t.provider}:${t.profile}` };
      this.active.set(t.id, active);
      active.promise = this.runTask(t.id, t.pending.id, controller.signal).catch(e => console.error('Task worker:', e.message)).finally(() => this.active.delete(t.id));
    }
  }
  async runTask(id, operationId, signal) {
    const current = () => { const t = this.state.tasks[id]; if (signal.aborted || !t?.pending || t.pending.id !== operationId || this.state.emergency || Date.now() - this.leaseAt > 120000) throw new Error('Operasi dibatalkan.'); return t; };
    try {
      const t = current(), profile = this.cfg.profiles[`${t.provider}:${t.profile}`];
      if (profile?.mode === 'operator' && t.provider === 'claude') {
        await this.transaction(async () => {
          const task = current(); task.pending.stage = 'operator'; task.status = 'WAITING_FOR_OPERATOR';
          log(this.state, task, 'Prompt disetujui. Menunggu operator Codex mengambil task untuk Claude desktop Sonnet 5, Thinking OFF.');
          await this.save(); await this.publish();
        }); return;
      }
      if (!profile || profile.mode !== 'automated' || !profile.freeTierVerified || !profile.verificationEvidence || !profile.automationPermissionEvidence) {
        await this.transaction(async () => {
          const task = current(); task.pending.stage = 'manual'; task.status = 'WAITING_FOR_USER';
          log(this.state, task, 'Handoff manual: buka provider resmi, cek model/free tier, salin prompt yang disetujui dan upload file. Impor respons serta URL conversation lewat dashboard. Automation belum diizinkan/diverifikasi untuk profile ini.');
          await this.save(); await this.publish();
        }); return;
      }
      const pstate = this.state.providers.find(p => p.id === t.provider);
      if (pstate.status === 'RATE_LIMITED' && pstate.profile === t.profile) throw new Error('Profile ini mencapai limit. Pilih provider/profile lain secara manual setelah menyelesaikan limit.');
      const files = [], taskDir = resolve(this.dir, 'downloads', id); await mkdir(taskDir, { recursive: true });
      for (const f of t.files) {
        current(); const bytes = await this.relay.download(f);
        const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'artifact';
        const path = resolve(taskDir, `${f.id}-${safeName}`); await writeFile(path, bytes, { mode: 0o600 }); files.push(path);
      }
      const result = await this.browser.submit(structuredClone(current()), profile, files, signal, (stage, url) => this.transaction(async () => {
        const task = current(); task.pending.stage = stage; task.status = stage === 'sent' ? 'AI_WORKING' : 'SUBMITTING_PROMPT';
        if (url) task.sessionUrl = url;
        log(this.state, task, stage === 'sent' ? 'Prompt dikirim melalui browser. Menunggu respons.' : 'Batas pengiriman disimpan. Tidak akan replay otomatis jika proses terputus.');
        await this.save(); await this.publish();
      }));
      await this.transaction(async () => {
        const task = current(); task.sessionUrl = result.url; task.model = profile.model; recordResponse(this.state, task, result.text);
        const provider = this.state.providers.find(p => p.id === task.provider);
        provider.status = 'CONNECTED'; provider.profile = task.profile; provider.model = profile.model; provider.remaining = 'Unknown';
        await this.save(); await this.publish();
      });
    } catch (e) {
      await this.transaction(async () => {
        const task = this.state.tasks[id];
        if (signal.aborted) {
          if (task?.pending?.id === operationId) {
            task.pending = null;
            if (task.status === 'PAUSED') task.resumeStatus = 'WAITING_FOR_USER';
            else if (task.status !== 'STOPPED') {
              const provider = this.state.providers.find(p => p.id === task.provider);
              task.status = provider.status === 'RATE_LIMITED' && provider.profile === task.profile ? 'RATE_LIMITED' : 'WAITING_FOR_USER';
            }
            log(this.state, task, 'Operasi browser dibatalkan. Cek provider sebelum mengirim ulang.');
          }
        } else if (task?.pending?.id === operationId) {
          task.status = e.rateLimited ? 'RATE_LIMITED' : 'FAILED'; task.pending = null; log(this.state, task, e.message);
          if (e.rateLimited) { const p = this.state.providers.find(p => p.id === task.provider); p.status = 'RATE_LIMITED'; p.profile = task.profile; p.limitNotice = e.message; p.remaining = 'Unknown'; }
        }
        await this.save(); await this.publish();
      });
    }
  }
  async tick() {
    if (Date.now() - this.leaseAt > 60000) await this.transaction(() => this.lease());
    if (Object.keys(this.state.deletions || {}).length) await this.transaction(async () => {
      await cleanDeletedTasks(this.state, this.relay); await this.save(); await this.publish();
    });
    const entries = await this.relay.commands(), commands = [];
    for (const e of entries) {
      if (commands.length >= 100) break;
      const item = await this.relay.read(e.path);
      if (!item) continue;
      if (item.value.id !== e.path.slice(9, -5)) throw new Error('ID/path command tidak cocok.');
      commands.push({ ...item, path: e.path });
    }
    commands.sort((a, b) => (a.value.type === 'emergency' ? -1 : b.value.type === 'emergency' ? 1 : (a.value.at || '').localeCompare(b.value.at || '')));
    for (const c of commands) { await this.process(c.value); await this.relay.remove(c.path, c.sha); }
    this.syncWorkspace();
    if (Date.now() - this.publishedAt > 60000) await this.transaction(() => this.publish());
    this.dispatch();
  }
  syncWorkspace() {
    if (!this.cfg.workspaceRoot) return;
    for (const task of Object.values(this.state.tasks)) {
      if (this.localWork.size >= 2) break;
      const marker = workspaceMarker(task);
      if (this.localWork.has(task.id) || task.localFailedMarker === marker || (task.localMarker === marker && (!task.result || task.localResultAt === task.result.at))) continue;
      const snapshot = structuredClone(task);
      const job = (async () => {
        await materializeTask(this.cfg.workspaceRoot, snapshot, this.relay);
        if (snapshot.result && snapshot.localResultAt !== snapshot.result.at) await saveResult(this.cfg.workspaceRoot, snapshot, this.relay);
        await this.transaction(async () => {
          const current = this.state.tasks[snapshot.id];
          if (!current) return;
          if (current.revision === snapshot.revision) { current.localRevision = snapshot.revision; current.localReady = true; current.localError = null; current.localMarker = marker; }
          if (current.result?.at === snapshot.result?.at && snapshot.result) current.localResultAt = snapshot.result.at;
          await this.save(); await this.publish();
        });
      })().catch(e => this.transaction(async () => {
        const current = this.state.tasks[snapshot.id];
        if (!current) return;
        if (current.localError !== e.message) log(this.state, current, `Folder lokal: ${e.message}. Gunakan Retry file lokal setelah penyebabnya ditangani.`);
        current.localError = e.message; current.localFailedMarker = workspaceMarker(current); await this.save(); await this.publish();
      })).catch(e => console.error('Local workspace:', e.message)).finally(() => this.localWork.delete(task.id));
      this.localWork.set(task.id, job);
    }
  }
  async stop() {
    this.running = false;
    const operations = [...this.active.values()]; for (const a of operations) a.controller.abort(); this.browser.close();
    await Promise.allSettled(operations.map(a => a.promise).filter(Boolean));
    await Promise.allSettled([...this.localWork.values()]);
  }
}
async function main() {
  const cfg = config(), relay = new GitHubRelay(cfg.repo, cfg.token, await keyFromSecret(cfg.secret));
  const lock = resolve(localDir, 'worker.lock'); await mkdir(localDir, { recursive: true });
  try { await mkdir(lock); } catch { throw new Error('worker.lock ada. Jika proses sebelumnya crash, pastikan tidak ada worker aktif lalu hapus .local/worker.lock secara manual.'); }
  const worker = new Worker(relay, cfg, new BrowserManager(cfg));
  const cleanup = async () => {
    await worker.stop();
    try { const lease = await relay.read('lease.json'); if (lease?.value.owner === worker.owner) await relay.write('lease.json', { owner: worker.owner, expires: 0 }, lease.sha); } catch {}
    await rm(lock, { recursive: true, force: true });
  };
  process.on('SIGINT', () => cleanup().then(() => process.exit(0)));
  process.on('SIGTERM', () => cleanup().then(() => process.exit(0)));
  try {
    await worker.start(); console.log(`Worker aktif: ${cfg.repo}. Polling ${cfg.pollMs || 10000}ms. Tidak menjalankan solver lokal.`);
    let failures = 0;
    while (worker.running) {
      try { await worker.tick(); failures = 0; } catch (e) {
        failures++; for (const a of worker.active.values()) a.controller.abort();
        console.error(`Relay gagal (${failures}): ${e.message}. State lokal dipertahankan.`);
      }
      await new Promise(r => setTimeout(r, Math.min(60000, (cfg.pollMs || 10000) * 2 ** Math.min(failures, 3))));
    }
  } finally { await cleanup(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
