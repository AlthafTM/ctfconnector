import { GitHubRelay } from './relay.mjs';
import { keyFromSecret } from './crypto.mjs';
const $ = id => document.getElementById(id);
let relay, state, selected, timer, polling = false, signedIn = false, renderSignature = '', generation = 0;
const urls = new Set(), pendingCommands = new Set();
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function append(parent, ...children) { parent.append(...children); return parent; }
function time(at) { return at ? new Date(at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }) : 'Belum ada'; }
function notify(text) { $('notice').textContent = text; }
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (e) { notify(e.message); } finally { if (button.isConnected) button.disabled = false; }
}
function button(text, fn, cls, disabled = false) {
  const b = el('button', text, cls); b.type = 'button'; b.disabled = disabled;
  b.addEventListener('click', () => action(b, () => fn(b))); return b;
}
async function confirmAction(title, text) {
  const d = $('confirm-dialog'); $('confirm-title').textContent = title; $('confirm-text').textContent = text;
  if (d.open) return false;
  return new Promise(resolve => { d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }); d.showModal(); });
}
async function send(type, taskId, payload) {
  const id = await relay.command(type, taskId, payload); pendingCommands.add(id);
  notify('Command tersimpan di relay. Menunggu worker mengonfirmasi.');
  clearTimeout(timer); timer = setTimeout(poll, 1500); return id;
}
function field(label, id, tag = 'textarea', value = '') {
  const wrap = el('div'), l = el('label', label), n = el(tag); l.htmlFor = id; n.id = id; n.value = value;
  if (tag === 'textarea') { n.rows = 4; n.maxLength = 100000; }
  append(wrap, l, n); return { wrap, n };
}
function richText(text) {
  const block = el('div', undefined, 'message-content');
  String(text).split('```').forEach((part, i) => {
    if (i % 2) { const pre = el('pre'); append(pre, el('code', part)); block.append(pre); }
    else block.append(document.createTextNode(part));
  }); return block;
}
async function fileAction(file) {
  const bytes = await relay.download(file), type = /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? file.type : 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([bytes], { type })); urls.add(url);
  if (type.startsWith('image/')) { $('preview-image').src = url; $('preview-image').alt = file.name; $('image-dialog').showModal(); }
  else { const a = el('a'); a.href = url; a.download = file.name.replace(/[\\/]/g, '_'); a.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); }
}
function filesPanel(files, title) {
  const panel = el('section'); panel.append(el('h3', title)); const list = el('div', undefined, 'file-list');
  for (const f of files) list.append(button(`${f.name} · ${Math.ceil(f.size / 1024)} KiB`, () => fileAction(f)));
  panel.append(list); return panel;
}
function renderTask(t) {
  const view = $('task-view');
  const draft = Object.fromEntries(['prompt-draft', 'message-draft', 'response-draft', 'session-url'].map(id => [id, $(id)?.value]));
  const oldId = view.dataset.taskId, oldRev = view.dataset.revision;
  view.replaceChildren(); view.dataset.taskId = t.id; view.dataset.revision = t.revision;
  const heading = el('div', undefined, 'task-title'); append(heading, el('h2', t.name), el('span', t.status, 'status')); view.append(heading);
  view.append(el('p', `${t.category} / ${t.provider} / profile ${t.profile}`, 'scope'), el('p', `Scope: ${t.scope || 'Lihat deskripsi challenge'}`, 'scope'));
  const description = el('details'); append(description, el('summary', 'Deskripsi challenge'), richText(t.description)); view.append(description);
  const controls = el('div', undefined, 'toolbar');
  controls.append(button('Jeda', () => send('pause', t.id), '', ['PAUSED', 'STOPPED', 'COMPLETED'].includes(t.status)),
    button('Lanjutkan', () => send('resume', t.id), '', t.status !== 'PAUSED' || state.emergency),
    button('Hentikan', async () => { if (await confirmAction('Hentikan task?', 'Worker akan membatalkan operasi task ini. Respons yang sudah berjalan di provider mungkin tetap berjalan.')) await send('stop', t.id); }, 'danger', t.status === 'STOPPED'),
    button('Retry dengan review', () => send('retry', t.id), '', !['FAILED','RATE_LIMITED','STOPPED'].includes(t.status)),
    button('Tandai selesai', () => send('complete', t.id), '', !!t.pending || t.status !== 'WAITING_FOR_USER'));
  view.append(controls);
  if (t.candidateFlag) {
    const flag = el('section', undefined, 'flag'); append(flag, el('h3', 'Kandidat flag'), el('pre', t.candidateFlag), el('p', 'Belum berarti diterima scoreboard.'), button('Salin kandidat flag', () => navigator.clipboard.writeText(t.candidateFlag).then(() => notify('Kandidat flag disalin.')))); view.append(flag);
  }
  if (t.prompt) {
    const approval = el('section', undefined, 'approval'); approval.append(el('h3', `Prompt / revisi ${t.revision}`));
    approval.append(el('p', t.approvedRevision === t.revision ? 'Versi ini sudah kamu setujui.' : 'Review scope dan isi sebelum dikirim ke provider.'));
    const { wrap, n } = field('Isi prompt lengkap', 'prompt-draft', 'textarea', t.prompt); n.readOnly = !['WAITING_FOR_APPROVAL','WAITING_FOR_USER'].includes(t.status) || !!t.pending;
    approval.append(wrap);
    const bar = el('div', undefined, 'toolbar');
    bar.append(button('Salin prompt', () => navigator.clipboard.writeText(n.value).then(() => notify('Prompt disalin.'))),
      button('Simpan edit', () => send('edit', t.id, { text: n.value }), '', n.readOnly),
      button('Setujui & teruskan', async () => {
        if (n.value !== t.prompt) throw new Error('Simpan edit dulu dan tunggu revisi baru sebelum approval.');
        await send('approve', t.id, { revision: t.revision });
      }, 'primary', t.status !== 'WAITING_FOR_APPROVAL' || state.emergency),
      button('Tolak prompt', () => send('reject', t.id), '', t.status !== 'WAITING_FOR_APPROVAL'));
    approval.append(bar); view.append(approval);
  }
  if (t.files.length) view.append(filesPanel(t.files, 'Attachment challenge'));
  if (t.artifacts?.length) view.append(filesPanel(t.artifacts, 'Artefak hasil kerja'));
  const conversation = el('section'), info = el('p', 'Buka provider di HP/PC untuk handoff manual. Pastikan model dan akun memakai free tier.', 'muted');
  const a = el('a', t.sessionUrl ? 'Buka conversation tersimpan' : 'Buka provider resmi');
  a.href = t.sessionUrl || state.providers.find(p => p.id === t.provider).url; a.target = '_blank'; a.rel = 'noreferrer';
  append(conversation, el('h3', 'Conversation & provider'), a, info);
  const row = el('div', undefined, 'form-row'), provider = field('Pindah provider', 'switch-provider', 'select'), profile = field('Profile yang diotorisasi', 'switch-profile', 'input', t.profile);
  for (const p of state.providers) { const o = el('option', p.name); o.value = p.id; o.selected = p.id === t.provider; provider.n.append(o); }
  append(row, provider.wrap, profile.wrap); conversation.append(row, button('Pindah dengan context handoff', async () => {
    if (await confirmAction('Pindah provider/profile?', 'Riwayat dibawa ke prompt baru untuk review. Tindakan ini tidak mengizinkan bypass limit provider.')) await send('switch', t.id, { provider: provider.n.value, profile: profile.n.value });
  }, '', !!t.pending || ['SUBMITTING_PROMPT','AI_WORKING'].includes(t.status)));
  const response = el('details'); response.open = t.pending?.stage === 'manual'; response.append(el('summary', 'Impor respons provider / jawab dari handoff manual'));
  const text = field('Respons asli provider', 'response-draft'), url = field('URL conversation resmi (tanpa token/query)', 'session-url', 'input', t.sessionUrl || ''); text.n.maxLength = 100000;
  append(response, text.wrap, url.wrap, button('Simpan respons & lanjutkan task', async () => {
    if (!text.n.value.trim()) throw new Error('Respons masih kosong.');
    await send('response', t.id, { text: text.n.value, url: url.n.value.trim() }); text.n.value = '';
  }, '', !['WAITING_FOR_USER','AI_WORKING','RATE_LIMITED'].includes(t.status) || t.approvedRevision !== t.revision)); conversation.append(response); view.append(conversation);
  const messages = el('section', undefined, 'messages'); messages.append(el('h3', 'Percakapan task'));
  for (const m of t.messages) {
    const entry = el('article', undefined, `message ${m.role}`), header = el('div', undefined, 'message-header');
    append(header, el('strong', ({user:'Kamu',agent:'Orchestrator',provider:'Provider'})[m.role] || m.role), el('time', time(m.at)));
    append(entry, header, richText(m.text)); messages.append(entry);
  } view.append(messages);
  const form = el('form', undefined, 'composer'), message = field('Pesan / instruksi tambahan', 'message-draft'); message.n.required = true;
  const moreFiles = field('File tambahan (membuat prompt untuk review ulang)', 'message-files', 'input'); moreFiles.n.type = 'file'; moreFiles.n.multiple = true;
  const label = el('label', undefined, 'inline'), follow = el('input'); follow.type = 'checkbox'; follow.id = 'followup'; label.htmlFor = follow.id;
  append(label, follow, document.createTextNode('Teruskan ke provider dalam scope yang sudah disetujui.'));
  const submit = el('button', 'Kirim pesan', 'primary'); submit.type = 'submit'; append(form, message.wrap, moreFiles.wrap, label, submit);
  form.addEventListener('submit', e => { e.preventDefault(); action(submit, async () => {
    const uploads = Array.from(moreFiles.n.files);
    if (uploads.length) {
      if (t.pending || !['WAITING_FOR_APPROVAL','WAITING_FOR_USER','COMPLETED'].includes(t.status)) throw new Error('Selesaikan operasi aktif dulu sebelum menambahkan file.');
      if (uploads.length + t.files.length > 10 || uploads.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Maksimal 10 attachment, masing-masing 20 MiB.');
      const files = []; for (const f of uploads) { notify(`Mengunggah ${f.name}...`); files.push(await relay.upload(f)); }
      await send('attachments', t.id, { files, text: message.n.value });
    } else await send('message', t.id, { text: message.n.value, followup: follow.checked });
    message.n.value = ''; moreFiles.n.value = ''; follow.checked = false;
  }); }); view.append(form);
  if (oldId === t.id) for (const [id, value] of Object.entries(draft)) if (value !== undefined && $(id) && (id !== 'prompt-draft' || oldRev === String(t.revision))) $(id).value = value;
}
function render() {
  const tasks = Object.values(state.tasks);
  if (!tasks.some(t => t.id === selected)) selected = tasks[0]?.id;
  $('count').textContent = tasks.length; $('empty-list').hidden = !!tasks.length;
  $('task-list').replaceChildren();
  for (const t of tasks) {
    const b = button(t.name, () => { selected = t.id; renderSignature = ''; render(); }); b.className = 'task-choice'; b.setAttribute('aria-current', String(t.id === selected));
    b.append(el('small', t.status)); $('task-list').append(b);
  }
  $('providers').replaceChildren();
  for (const p of state.providers) {
    const n = el('article', undefined, 'provider-row'); append(n, el('strong', p.name), el('p', p.status), el('p', `${p.status === 'CONNECTED' ? 'Model teramati' : 'Model diminta'}: ${p.model}`), el('p', `Profile: ${p.profile || 'belum aktif'}`), el('p', `Sisa: ${p.remaining || 'Unknown'}`));
    const a = el('a', 'Sumber model/free tier'); a.href = p.source; a.target = '_blank'; a.rel = 'noreferrer'; n.append(a);
    const verification = { CONFLICTING_CURRENT_SOURCES: 'Model gratis saat ini perlu dicek ulang.', HISTORICAL_FREE_CURRENT_UNVERIFIED: 'Pernah tersedia gratis; akses sekarang belum diverifikasi.', UNVERIFIED_FREE: 'Akses model ini di free tier belum terverifikasi.' };
    n.append(el('p', verification[p.verification] || 'Periksa model pada akun provider.')); if (p.limitNotice) n.append(el('p', p.limitNotice)); $('providers').append(n);
  }
  const task = state.tasks[selected];
  if (task) { const sig = JSON.stringify(task) + state.emergency; if (sig !== renderSignature) { renderTask(task); renderSignature = sig; } }
  $('monitor-data').replaceChildren();
  const data = [['Heartbeat', time(state.heartbeat)], ['Challenge', task?.name || 'Belum ada'], ['Status', task?.status || 'IDLE'], ['Provider / model', task ? `${task.provider} / ${task.model || 'belum diverifikasi'}` : 'Belum ada'], ['Browser profile', task?.profile || 'Belum ada'], ['Terakhir selesai', task?.lastOperation || 'Belum ada'], ['Operasi saat ini', task?.pending?.stage || 'Menunggu command'], ['Butuh user', task && ['WAITING_FOR_USER','WAITING_FOR_APPROVAL','RATE_LIMITED'].includes(task.status) ? 'Ya' : 'Tidak'], ['Kandidat flag', task?.candidateFlag ? 'Ada, belum diverifikasi scoreboard' : 'Belum ada'], ['API remaining', relay.remaining || 'Unknown']];
  for (const [k, v] of data) append($('monitor-data'), el('dt', k), el('dd', v));
  $('audit').replaceChildren();
  for (const m of state.audit.slice(-60).reverse()) { const li = el('li'); append(li, el('time', time(m.at)), document.createTextNode(m.text.slice(0, 250))); $('audit').append(li); }
  $('reset-emergency').hidden = !state.emergency; $('emergency').disabled = state.emergency;
  const fresh = state.heartbeat && Date.now() - Date.parse(state.heartbeat) < 150000;
  $('connection').textContent = fresh ? 'PC terhubung' : 'PC offline / heartbeat lama';
  if (state.emergency) notify('Emergency stop aktif. Reset hanya membuka antrean; task tetap dihentikan.');
  for (const id of pendingCommands) if (Object.hasOwn(state.processed, id)) {
    const p = state.processed[id]; notify(p.status === 'ok' ? 'Worker sudah menerima command.' : `Command ditolak: ${p.error}`); pendingCommands.delete(id);
  }
}
async function poll() {
  if (polling || !signedIn) return; polling = true; const gen = generation;
  try {
    await relay.verify(); const result = await relay.read('state.json');
    if (!signedIn || gen !== generation) return;
    if (result) { state = result.value; render(); } else notify('Relay terhubung. Worker belum mengirim state; jalankan agent di PC.');
  } catch (e) { if (gen === generation && signedIn) { $('connection').textContent = 'Relay terputus'; notify(`${e.message}. Riwayat terakhir tetap ditampilkan; sinkronisasi dicoba lagi dengan jeda.`); } }
  finally { polling = false; if (signedIn) timer = setTimeout(poll, document.hidden ? 30000 : 10000); }
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter; b.disabled = true; $('login-error').textContent = 'Memeriksa relay privat dan pairing key...';
  try {
    const candidate = new GitHubRelay($('repo').value.trim(), $('token').value.trim(), await keyFromSecret($('key').value.trim()));
    await candidate.verify(); await candidate.read('lease.json'); const snapshot = await candidate.read('state.json');
    relay = candidate; generation++; signedIn = true; localStorage.setItem('ctf-relay', relay.repo); $('token').value = ''; $('key').value = '';
    $('login').hidden = true; $('desk').hidden = false; $('logout').hidden = false; $('login-error').textContent = '';
    if (snapshot) { state = snapshot.value; render(); } await poll();
  } catch (e) { $('login-error').textContent = e.name === 'OperationError' ? 'Pairing key salah atau data tidak cocok.' : e.message; }
  finally { b.disabled = false; }
});
$('repo').value = localStorage.getItem('ctf-relay') || 'AlthafTM/ctfconnector-relay';
$('logout').addEventListener('click', () => {
  signedIn = false; generation++; clearTimeout(timer); relay = undefined; state = undefined; selected = undefined; renderSignature = ''; pendingCommands.clear();
  for (const url of urls) URL.revokeObjectURL(url); urls.clear();
  $('task-view').replaceChildren(); $('audit').replaceChildren(); $('providers').replaceChildren(); $('task-list').replaceChildren(); $('monitor-data').replaceChildren();
  for (const d of document.querySelectorAll('dialog[open]')) d.close(); $('preview-image').removeAttribute('src'); $('create-form').reset();
  $('desk').hidden = true; $('login').hidden = false; $('logout').hidden = true; $('connection').textContent = 'Belum terhubung';
});
$('refresh').addEventListener('click', () => { clearTimeout(timer); poll(); });
$('new-task').addEventListener('click', () => $('create-dialog').showModal());
$('close-create').addEventListener('click', () => $('create-dialog').close());
$('close-image').addEventListener('click', () => $('image-dialog').close());
$('image-dialog').addEventListener('close', () => { const url = $('preview-image').src; URL.revokeObjectURL(url); urls.delete(url); $('preview-image').removeAttribute('src'); });
$('emergency').addEventListener('click', e => action(e.target, async () => {
  if (await confirmAction('Emergency stop semua task?', 'Worker akan membatalkan semua operasi yang dikelolanya saat command diterima. Jika koneksi putus, hentikan worker langsung di PC.')) await send('emergency', null);
}));
$('reset-emergency').addEventListener('click', e => action(e.target, async () => { if (await confirmAction('Reset emergency?', 'Membuka antrean baru. Task yang dihentikan tidak dilanjutkan otomatis.')) await send('reset_emergency', null); }));
$('create-form').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter; b.disabled = true; const currentRelay = relay;
  try {
    const uploads = Array.from($('files').files);
    if (uploads.length > 10 || uploads.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Maksimal 10 file, masing-masing 20 MiB.');
    const files = [];
    for (const f of uploads) { $('create-error').textContent = `Mengenkripsi dan mengunggah ${f.name}...`; files.push(await currentRelay.upload(f)); }
    if (!signedIn || currentRelay !== relay) throw new Error('Session logout saat upload. Masuk kembali.');
    const taskId = crypto.randomUUID();
    await send('create', taskId, { name: $('name').value, category: $('category').value, description: $('description').value, scope: $('scope').value,
      flagFormat: $('flag-format').value, provider: $('provider').value, profile: $('profile').value, files });
    selected = taskId; $('create-dialog').close(); $('create-form').reset(); $('profile').value = 'default'; $('create-error').textContent = '';
  } catch (e) { $('create-error').textContent = e.message; } finally { b.disabled = false; }
});
