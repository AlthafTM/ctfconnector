import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localDir } from './config.mjs';
import { providers, validSessionUrl } from './core.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); ws.addEventListener('message', e => {
    const v = JSON.parse(e.data); const p = this.pending.get(v.id); if (!p) return;
    this.pending.delete(v.id); clearTimeout(p.timer); v.error ? p.reject(new Error(v.error.message)) : p.resolve(v.result);
  }); ws.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Browser disconnected')); } this.pending.clear(); }); }
  call(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser timeout')); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression, sessionId) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error('Selector/DOM operation failed. Periksa config browser lokal.');
    return r.result.value;
  }
}
export class BrowserManager {
  constructor(config) { this.config = config; this.connections = new Map(); }
  async connection(profile) {
    const id = profile.provider + ':' + profile.profile;
    if (this.connections.has(id)) return this.connections.get(id);
    if (!/^[\w-]{1,80}$/.test(profile.profile)) throw new Error('Nama profile tidak aman.');
    const dir = resolve(localDir, 'profiles', profile.provider, profile.profile); mkdirSync(dir, { recursive: true });
    const child = spawn(this.config.browserExecutable, [`--user-data-dir=${dir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', 'about:blank'], { windowsHide: false, stdio: 'ignore' });
    let launchError; child.on('error', e => { launchError = e; });
    let wsUrl;
    for (let i = 0; i < 30; i++) {
      if (launchError) throw launchError;
      try { const [port, path] = readFileSync(resolve(dir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
        wsUrl = `ws://127.0.0.1:${Number(port)}${path}`; break; } catch { await delay(300); }
    }
    if (!wsUrl) throw new Error('Browser gagal start. Login/open profile secara lokal.');
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    const cdp = new CDP(ws); this.connections.set(id, cdp);
    ws.addEventListener('close', () => this.connections.delete(id)); return cdp;
  }
  async openProfile(profile) {
    const cdp = await this.connection(profile);
    return cdp.call('Target.createTarget', { url: providers.find(p => p.id === profile.provider).url });
  }
  async submit(task, profile, files, signal, checkpoint) {
    if (profile.mode !== 'automated' || !profile.freeTierVerified || !profile.verificationEvidence || !profile.model || !profile.automationPermissionEvidence) throw new Error('Perlu verifikasi free tier, model dan izin automation di config lokal.');
    if (!profile.editor || !profile.submit || !profile.response || !profile.busy || !profile.limit || !profile.login || !profile.modelSelector) throw new Error('Selector editor/submit/response/busy/limit/login/modelSelector wajib dikonfigurasi.');
    const cdp = await this.connection(profile);
    const url = task.sessionUrl ? validSessionUrl(task.provider, task.sessionUrl) : providers.find(p => p.id === task.provider).url;
    const { targetId } = await cdp.call('Target.createTarget', { url });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    const check = () => { if (signal.aborted) throw new Error('Operasi dibatalkan.'); };
    try {
      for (let i = 0; i < 60; i++) {
        check();
        if (await cdp.evaluate(`!!document.querySelector(${JSON.stringify(profile.editor)})`, sessionId)) break;
        if (i === 59) throw new Error('Editor tidak muncul. Login/CAPTCHA harus ditangani user.');
        await delay(500);
      }
      const guard = await cdp.evaluate(`({login:!!document.querySelector(${JSON.stringify(profile.login)}), model:document.querySelector(${JSON.stringify(profile.modelSelector)})?.textContent || '', origin:location.origin})`, sessionId);
      if (guard.origin !== new URL(url).origin || guard.login || !guard.model.includes(profile.model)) throw new Error('Login/model tidak sesuai verifikasi. Tidak ada prompt dikirim.');
      if (files.length) {
        if (!profile.fileInput) throw new Error('Provider belum dikonfigurasi untuk upload file.');
        await cdp.call('DOM.enable', {}, sessionId);
        const { root } = await cdp.call('DOM.getDocument', {}, sessionId);
        const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: root.nodeId, selector: profile.fileInput }, sessionId);
        if (!nodeId) throw new Error('Input upload tidak ditemukan.');
        await cdp.call('DOM.setFileInputFiles', { nodeId, files }, sessionId);
        if (!profile.uploadBusy) throw new Error('Selector uploadBusy wajib untuk attachment.');
        await delay(1500);
        for (let i = 0; await cdp.evaluate(`!!document.querySelector(${JSON.stringify(profile.uploadBusy)})`, sessionId); i++) { check(); if (i > 120) throw new Error('Upload timeout.'); await delay(500); }
      }
      check();
      const before = await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(profile.response)})).map(x=>x.innerText)`, sessionId);
      await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(profile.editor)});e.focus(); if(e instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(task.pending.text)});}else{e.textContent=${JSON.stringify(task.pending.text)};}e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));})()`, sessionId);
      check();
      // Persist the uncertain-send boundary before the browser click. Never replay it after a crash.
      await checkpoint('sending'); check();
      await cdp.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(profile.submit)});if(!b || b.disabled)throw Error('Submit unavailable');b.click();})()`, sessionId);
      await checkpoint('sent');
      let last = '', stable = 0;
      for (let i = 0; i < 300; i++) {
        check(); await delay(1500);
        const r = await cdp.evaluate(`({url:location.href,login:!!document.querySelector(${JSON.stringify(profile.login)}),limit:document.querySelector(${JSON.stringify(profile.limit)})?.innerText,busy:!!document.querySelector(${JSON.stringify(profile.busy)}),answers:Array.from(document.querySelectorAll(${JSON.stringify(profile.response)})).map(x=>x.innerText)})`, sessionId);
        if (r.login) throw new Error('Session login kedaluwarsa.');
        if (r.limit) { const e = new Error(r.limit.slice(0, 2000)); e.rateLimited = true; throw e; }
        if (r.answers.length <= before.length) continue;
        const text = r.answers.at(-1) || ''; stable = text && text === last && !r.busy ? stable + 1 : 0; last = text;
        if (stable >= 3) return { text, url: validSessionUrl(task.provider, r.url) };
      }
      throw new Error('Respons timeout/terputus. Cek conversation sebelum retry.');
    } finally { await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {}); }
  }
  close() { for (const cdp of this.connections.values()) cdp.ws.close(); this.connections.clear(); }
}
