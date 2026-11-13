import { GitHubRelay } from './relay.mjs';
import { keyFromSecret } from './crypto.mjs';
import { promptMakerInstructions } from './operator-prompt.mjs';
import { savedSession, rememberSession, forgetSession } from './session.mjs';
const $ = id => document.getElementById(id);
let relay, state, selected, timer, polling = false, signedIn = false, renderSignature = '', generation = 0, pollFailures = 0;
const urls = new Set(), pendingCommands = new Set();
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function append(parent, ...children) { parent.append(...children); return parent; }
function disclosure(title, ...children) { const d = el('details'); d.append(el('summary', title), ...children); return d; }
const statusNames = { WAITING_FOR_TRANSCRIPTION: 'Baca foto', WAITING_FOR_APPROVAL: 'Review prompt', WAITING_FOR_OPERATOR: 'Menunggu Codex', AI_WORKING: 'Dikerjakan', WAITING_FOR_USER: 'Butuh jawaban', RATE_LIMITED: 'Limit provider', PAUSED: 'Dijeda', STOPPED: 'Dihentikan', SKIPPED: 'Skipped', COMPLETED: 'Selesai', FAILED: 'Gagal', SUBMITTING_PROMPT: 'Menyiapkan' };
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
  const draft = Object.fromEntries(['prompt-draft', 'outgoing-draft', 'skip-reason', 'message-draft', 'response-draft', 'session-url', 'result-flag', 'result-chat', 'answer-text', 'transcript-text', 'limit-notice'].map(id => [id, $(id)?.value]));
  const checkboxes = Object.fromEntries(['needs-solver','followup'].map(id => [id, $(id)?.checked]));
  const selectedFiles = Object.fromEntries([...view.querySelectorAll('input[type=file]')].map(n => [n.id, [...n.files]]));
  const detailKey = d => d.querySelector('summary')?.textContent.replace(/\([^)]*\)|\/ revisi \d+/g, '').trim();
  const openSections = new Map([...view.querySelectorAll('details')].map(d => [detailKey(d), d.open]));
  const oldId = view.dataset.taskId, oldRev = view.dataset.revision, oldOutgoing = view.dataset.outgoing;
  const outgoingVersion = `${t.outgoing?.id || ''}:${t.outgoing?.revision || ''}`;
  if (oldOutgoing !== outgoingVersion) delete draft['outgoing-draft'];
  view.replaceChildren(); view.dataset.taskId = t.id; view.dataset.revision = t.revision; view.dataset.outgoing = outgoingVersion;
  const heading = el('div', undefined, 'task-title'); append(heading, el('h2', t.name), el('span', statusNames[t.status] || t.status, 'status')); view.append(heading);
  if (t.status === 'SKIPPED') view.append(el('p', `Skipped: ${t.skip?.reason || 'Search ended.'}`, 'notice'), button('Send a new question', () => $('create-dialog').showModal(), 'primary'));
  const autoLabel = el('label', undefined, 'remember-device'), auto = el('input'); auto.type = 'checkbox'; auto.id = 'auto-accept'; auto.checked = !!t.autoAccept; auto.disabled = state.emergency;
  auto.addEventListener('change', () => { auto.disabled = true; send('auto_accept', t.id, { enabled: auto.checked }).catch(e => { auto.checked = !!t.autoAccept; auto.disabled = false; notify(e.message); }); });
  append(autoLabel, auto, document.createTextNode('Auto accept teks ke Claude')); view.append(autoLabel);
  if (t.outgoing) {
    const out = t.outgoing, box = el('section', undefined, 'approval'), text = field(`Teks berikutnya ke Claude · ${out.status}`, 'outgoing-draft', 'textarea', out.text);
    text.n.readOnly = !['DRAFT','APPROVED'].includes(out.status) || !['AI_WORKING','WAITING_FOR_OPERATOR'].includes(t.status) || state.emergency;
    const payload = () => ({ id: out.id, revision: out.revision });
    append(box, text.wrap, button('Simpan teks', () => send('outgoing_edit', t.id, { ...payload(), text: text.n.value }), '', text.n.readOnly),
      button('Setujui teks', () => { if (text.n.value !== out.text) throw new Error('Simpan teks dulu sebelum approval.'); return send('outgoing_approve', t.id, payload()); }, 'primary', out.status !== 'DRAFT' || text.n.readOnly)); view.append(box);
  }
  if (t.result) {
    const result = el('section', undefined, 'result'); result.append(el('h3', 'Hasil'), el('pre', t.result.flag));
    const actions = el('div', undefined, 'toolbar'), link = el('a', 'Buka chat AI'); link.href = t.result.chatUrl; link.target = '_blank'; link.rel = 'noreferrer';
    actions.append(button('Salin flag', () => navigator.clipboard.writeText(t.result.flag).then(() => notify('Flag disalin.'))), link); result.append(actions);
    if (t.result.solverRequired) result.append(filesPanel(t.result.solverFiles, 'Solver'));
    view.append(result);
  }
  if (t.transcriptionRequired) view.append(el('p', 'Foto tersimpan. Operator akan menyalin soal ke teks sebelum dikirim ke Claude.', 'notice'));
  if (t.question) {
    const form = el('form', undefined, 'question'), answer = field(t.question, 'answer-text'); answer.n.required = true;
    const submit = el('button', 'Kirim jawaban', 'primary'); submit.type = 'submit'; append(form, answer.wrap, submit);
    form.addEventListener('submit', e => { e.preventDefault(); action(submit, () => send('answer', t.id, { text: answer.n.value })); }); view.append(form);
  }
  const description = el('details'); append(description, el('summary', 'Deskripsi challenge'), richText(t.description)); view.append(description);
  const controls = el('div', undefined, 'toolbar');
  controls.append(button('Jeda', () => send('pause', t.id), '', ['PAUSED', 'STOPPED', 'COMPLETED','SKIPPED'].includes(t.status)),
    button('Lanjutkan', () => send('resume', t.id), '', t.status !== 'PAUSED' || state.emergency),
    button('Hentikan', async () => { if (await confirmAction('Hentikan task?', 'Worker akan membatalkan operasi task ini. Respons yang sudah berjalan di provider mungkin tetap berjalan.')) await send('stop', t.id); }, 'danger', ['STOPPED','SKIPPED'].includes(t.status)),
    button('Retry dengan review', () => send('retry', t.id), '', !['FAILED','RATE_LIMITED','STOPPED','SKIPPED'].includes(t.status)),
    button('Tandai selesai', () => send('complete', t.id), '', !!t.pending || t.status !== 'WAITING_FOR_USER' || (t.provider === 'claude' && !t.result)));
  const skipReason = field('Reason to skip (optional)', 'skip-reason', 'input'); skipReason.n.maxLength = 4000;
  view.append(disclosure('Kontrol task', controls, skipReason.wrap, button('Skip question', () => send('skip', t.id, { text: skipReason.n.value.trim() || 'User requested to skip this question.' }), '', ['STOPPED','COMPLETED','SKIPPED'].includes(t.status))));
  if (t.candidateFlag && !t.result) {
    const flag = el('section', undefined, 'flag'); append(flag, el('h3', 'Kandidat flag'), el('pre', t.candidateFlag), el('p', 'Belum berarti diterima scoreboard.'), button('Salin kandidat flag', () => navigator.clipboard.writeText(t.candidateFlag).then(() => notify('Kandidat flag disalin.')))); view.append(flag);
  }
  if (t.prompt) {
    const approval = el('details', undefined, 'approval'); approval.open = t.status === 'WAITING_FOR_APPROVAL'; approval.append(el('summary', `Prompt dari AI - revisi ${t.revision}`));
    const { wrap, n } = field('Isi prompt lengkap', 'prompt-draft', 'textarea', t.prompt); n.readOnly = !['WAITING_FOR_APPROVAL','WAITING_FOR_USER','SUBMITTING_PROMPT','WAITING_FOR_OPERATOR'].includes(t.status) || (!!t.pending && (t.pending.kind !== 'initial' || !['queued','operator'].includes(t.pending.stage)));
    approval.append(wrap);
    const bar = el('div', undefined, 'toolbar');
    bar.append(button('Salin prompt', () => navigator.clipboard.writeText(n.value).then(() => notify('Prompt disalin.'))),
      button('Simpan perubahan', () => send('edit', t.id, { text: n.value, revision: t.revision }), '', n.readOnly),
      button('Setujui prompt', async () => {
        if (n.value !== t.prompt) throw new Error('Simpan edit dulu dan tunggu revisi baru sebelum approval.');
        await send('approve', t.id, { revision: t.revision });
      }, 'primary', t.status !== 'WAITING_FOR_APPROVAL' || state.emergency),
      button('Tolak prompt', () => send('reject', t.id), '', t.status !== 'WAITING_FOR_APPROVAL'));
    approval.append(bar); view.append(approval);
  }
  if (t.files.length) view.append(disclosure(`File soal (${t.files.length})`, filesPanel(t.files, 'Attachment')));
  if (t.artifacts?.length) view.append(disclosure('File lain', filesPanel(t.artifacts, 'Artefak')));
  const conversation = el('details'), info = el('p', 'Claude desktop: Sonnet 5, Thinking OFF, akun Free.', 'muted');
  const a = el('a', t.sessionUrl ? 'Buka conversation tersimpan' : 'Buka provider resmi');
  a.href = t.sessionUrl || state.providers.find(p => p.id === t.provider).url; a.target = '_blank'; a.rel = 'noreferrer';
  append(conversation, el('summary', 'Operator'), a, info);
  if (t.localError) conversation.append(el('p', t.localError), button('Retry file lokal', () => send('retry_local', t.id)));
  const settingsForm = el('form'), checked = el('input'); checked.type = 'checkbox'; checked.id = 'settings-checked'; checked.required = true;
  const checkedLabel = el('label'); checkedLabel.htmlFor = checked.id; checkedLabel.append(checked, document.createTextNode('Sonnet 5, Thinking OFF, dan akun Free sudah saya cek di aplikasi.'));
  const settingsButton = el('button', 'Catat pemeriksaan'); settingsButton.type = 'submit'; settingsForm.append(checkedLabel, settingsButton);
  settingsForm.addEventListener('submit', e => { e.preventDefault(); action(settingsButton, () => send('operator_settings', t.id, { model: 'Sonnet 5', thinking: 'off', freeTier: true, evidence: 'User/operator mengonfirmasi pemeriksaan UI aplikasi melalui website.' })); });
  conversation.append(disclosure('Pemeriksaan model', settingsForm));
  const limitInfo = field('Pesan limit / waktu reset dari provider (jika ada)', 'limit-notice', 'input'); limitInfo.n.maxLength = 2000;
  const limitBar = el('div', undefined, 'toolbar');
  limitBar.append(button('Laporkan limit provider', async () => {
    if (await confirmAction('Tandai profile mencapai limit?', 'Worker membatalkan operasi task ini dan berhenti memakai profile yang limit.')) await send('report_limit', t.id, { text: limitInfo.n.value });
  }, '', !['WAITING_FOR_USER','AI_WORKING','SUBMITTING_PROMPT'].includes(t.status)), button('Konfirmasi limit sudah reset', async () => {
    if (await confirmAction('Limit benar-benar sudah reset?', 'Konfirmasi hanya setelah halaman provider menyatakan akun ini bisa dipakai lagi. Tidak mengubah limit resmi provider.')) await send('limit_reset', t.id);
  }, '', t.status !== 'RATE_LIMITED'));
  conversation.append(limitInfo.wrap, limitBar);
  const row = el('div', undefined, 'form-row'), provider = field('Pindah provider', 'switch-provider', 'select'), profile = field('Profile yang diotorisasi', 'switch-profile', 'input', t.profile);
  for (const p of state.providers.filter(p => p.id === 'claude' || p.id === t.provider)) { const o = el('option', p.name); o.value = p.id; o.selected = p.id === t.provider; provider.n.append(o); }
  append(row, provider.wrap, profile.wrap); conversation.append(row, button('Pindah dengan context handoff', async () => {
    if (await confirmAction('Pindah provider/profile?', 'Riwayat dibawa ke prompt baru untuk review. Tindakan ini tidak mengizinkan bypass limit provider.')) await send('switch', t.id, { provider: provider.n.value, profile: profile.n.value });
  }, '', !!t.pending || ['SUBMITTING_PROMPT','AI_WORKING'].includes(t.status)));
  const response = el('details'); response.open = t.pending?.stage === 'manual'; response.append(el('summary', 'Impor respons provider / jawab dari handoff manual'));
  const text = field('Respons asli provider', 'response-draft'), url = field('URL conversation resmi (tanpa token/query)', 'session-url', 'input', t.sessionUrl || ''); text.n.maxLength = 100000;
  append(response, text.wrap, url.wrap, button('Simpan respons & lanjutkan task', async () => {
    if (!text.n.value.trim()) throw new Error('Respons masih kosong.');
    await send('response', t.id, { text: text.n.value, url: url.n.value.trim() }); text.n.value = '';
  }, '', !['WAITING_FOR_USER','AI_WORKING','RATE_LIMITED'].includes(t.status) || t.approvedRevision !== t.revision)); conversation.append(response); view.append(conversation);
  const resultForm = el('form'), flagField = field('Flag', 'result-flag', 'input', t.result?.flag || t.candidateFlag || ''), chatField = field('Link chat AI', 'result-chat', 'input', t.sessionUrl || '');
  flagField.n.required = true; chatField.n.required = true; chatField.n.type = 'url';
  const needsSolver = el('input'); needsSolver.type = 'checkbox'; needsSolver.id = 'needs-solver';
  const solverLabel = el('label'); solverLabel.htmlFor = needsSolver.id; solverLabel.append(needsSolver, document.createTextNode('Perlu script solver'));
  const solverInput = field('File solver', 'result-solvers', 'input'); solverInput.n.type = 'file'; solverInput.n.multiple = true; solverInput.n.disabled = true;
  needsSolver.addEventListener('change', () => { solverInput.n.disabled = !needsSolver.checked; solverInput.n.required = needsSolver.checked; if (!needsSolver.checked) solverInput.n.value = ''; });
  const publishResult = el('button', 'Kirim hasil', 'primary'); publishResult.type = 'submit';
  publishResult.disabled = !['AI_WORKING','WAITING_FOR_USER','WAITING_FOR_OPERATOR'].includes(t.status) || t.approvedRevision !== t.revision;
  append(resultForm, flagField.wrap, chatField.wrap, solverLabel, solverInput.wrap, publishResult);
  resultForm.addEventListener('submit', e => { e.preventDefault(); action(publishResult, async () => {
    const files = Array.from(solverInput.n.files); if (files.length > 10 || files.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Maksimal 10 file solver, 20 MiB per file.');
    const solverFiles = []; for (const file of files) solverFiles.push(await relay.upload(file));
    await send('result', t.id, { flag: flagField.n.value, chatUrl: chatField.n.value, solverRequired: needsSolver.checked, solverFiles, validation: 'candidate' });
  }); }); conversation.append(disclosure('Kirim hasil operator', resultForm));
  const draftForm = el('form'), transcript = field('Teks soal dari foto', 'transcript-text'); transcript.n.required = true;
  const draftButton = el('button', 'Simpan teks & buat prompt'); draftButton.type = 'submit'; draftForm.append(transcript.wrap, draftButton);
  draftForm.addEventListener('submit', e => { e.preventDefault(); action(draftButton, () => send('transcribe', t.id, { text: transcript.n.value })); });
  if (!t.pending && !['COMPLETED','STOPPED','SKIPPED','PAUSED','AI_WORKING'].includes(t.status)) conversation.append(disclosure('Transkripsi soal', draftForm));
  const take = button('Ambil sebagai operator', () => send('take', t.id, { operationId: t.pending?.id }), '', t.status !== 'WAITING_FOR_OPERATOR'); conversation.append(take);
  const messages = el('section', undefined, 'messages'); messages.append(el('h3', 'Chat'));
  for (const m of t.messages) {
    const entry = el('article', undefined, `message ${m.role}`), header = el('div', undefined, 'message-header');
    append(header, el('strong', ({user:'Kamu',agent:'Orchestrator',provider:'Provider'})[m.role] || m.role), el('time', time(m.at)));
    append(entry, header, richText(m.text)); messages.append(entry);
  } view.append(messages);
  const form = el('form', undefined, 'composer'), message = field('Pesan', 'message-draft'); message.n.rows = 2;
  const moreFiles = field('File tambahan (membuat prompt untuk review ulang)', 'message-files', 'input'); moreFiles.n.type = 'file'; moreFiles.n.multiple = true;
  const label = el('label', undefined, 'inline'), follow = el('input'); follow.type = 'checkbox'; follow.id = 'followup'; label.htmlFor = follow.id;
  append(label, follow, document.createTextNode('Teruskan ke provider dalam scope yang sudah disetujui.'));
  const submit = el('button', 'Kirim pesan', 'primary'); submit.type = 'submit'; submit.disabled = t.status === 'SKIPPED'; append(form, message.wrap, disclosure('Lampiran & follow-up', moreFiles.wrap, label), submit);
  form.addEventListener('submit', e => { e.preventDefault(); action(submit, async () => {
    const uploads = Array.from(moreFiles.n.files);
    if (uploads.length) {
      if (t.pending || !['WAITING_FOR_APPROVAL','WAITING_FOR_USER','COMPLETED'].includes(t.status)) throw new Error('Selesaikan operasi aktif dulu sebelum menambahkan file.');
      if (uploads.length + t.files.length > 10 || uploads.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Maksimal 10 attachment, masing-masing 20 MiB.');
      const files = []; for (const f of uploads) { notify(`Mengunggah ${f.name}...`); files.push(await relay.upload(f)); }
      await send('attachments', t.id, { files, text: message.n.value });
    } else { if (!message.n.value.trim()) throw new Error('Isi pesan atau pilih file.'); await send(follow.checked && t.provider === 'claude' ? 'outgoing' : 'message', t.id, { text: message.n.value, followup: follow.checked }); }
    message.n.value = ''; moreFiles.n.value = ''; follow.checked = false;
  }); });
  const resultBubble = view.querySelector('.result'); if (resultBubble) view.append(resultBubble);
  view.append(form);
  if (oldId === t.id) for (const [id, value] of Object.entries(draft)) if (value !== undefined && $(id) && !$(id).readOnly && (id !== 'prompt-draft' || oldRev === String(t.revision))) $(id).value = value;
  if (oldId === t.id) {
    for (const d of view.querySelectorAll('details')) if (openSections.has(detailKey(d)) && !(d.classList.contains('approval') && oldRev !== String(t.revision))) d.open = openSections.get(detailKey(d));
    for (const [id, checked] of Object.entries(checkboxes)) if (checked !== undefined && $(id)) { $(id).checked = checked; $(id).dispatchEvent(new Event('change')); }
    for (const [id, files] of Object.entries(selectedFiles)) if (files.length && $(id)) {
      try { const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file); $(id).files = transfer.files; }
      catch { notify('Update diterima. Pilih ulang lampiran yang belum dikirim.'); }
    }
  }
}
function render() {
  const tasks = Object.values(state.tasks);
  if (selected && !tasks.some(t => t.id === selected)) selected = undefined;
  $('desk').classList.toggle('in-chat', !!selected); $('task-view').hidden = !selected; $('back-home').hidden = !selected;
  $('count').textContent = tasks.length; $('empty-list').hidden = !!tasks.length;
  $('task-list').replaceChildren();
  for (const t of tasks) {
    const b = button(t.name, () => { selected = t.id; renderSignature = ''; render(); }); b.className = 'task-choice'; b.setAttribute('aria-current', String(t.id === selected));
    b.append(el('small', statusNames[t.status] || t.status), el('p', (t.description || 'Foto / file soal').slice(0, 100)), el('span', `${t.files.length} file - Buka chat`, 'muted')); b.dataset.status = t.status; $('task-list').append(b);
  }
  $('providers').replaceChildren();
  for (const p of state.providers) {
    const n = el('article', undefined, 'provider-row'); append(n, el('strong', p.name), el('p', p.status), el('p', `${p.status === 'CONNECTED' ? 'Model teramati' : 'Model diminta'}: ${p.model}`), el('p', `Profile: ${p.profile || 'belum aktif'}`), el('p', `Sisa: ${p.remaining || 'Unknown'}`));
    const a = el('a', 'Sumber model/free tier'); a.href = p.source; a.target = '_blank'; a.rel = 'noreferrer'; n.append(a);
    const verification = { ACCOUNT_UI_RECHECK_REQUIRED: 'Cek Sonnet 5 dan Thinking OFF di aplikasi sebelum kirim.', CONFLICTING_CURRENT_SOURCES: 'Model gratis saat ini perlu dicek ulang.', HISTORICAL_FREE_CURRENT_UNVERIFIED: 'Perlu pemeriksaan ulang pada akun.', UNVERIFIED_FREE: 'Akses free tier belum terverifikasi.' };
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
  if (polling || !signedIn) return; polling = true; const gen = generation; let nextDelay = document.hidden ? 30000 : 10000;
  try {
    await relay.verify(); const result = await relay.read('state.json');
    if (!signedIn || gen !== generation) return;
    pollFailures = 0;
    if (result) { state = result.value; render(); } else notify('Relay terhubung. Worker belum mengirim state; jalankan agent di PC.');
  } catch (e) { if (gen === generation && signedIn) {
    pollFailures++; nextDelay = Math.max(Math.min(300000, 10000 * 2 ** Math.min(pollFailures, 5)), (e.retryAfter || 0) * 1000);
    $('connection').textContent = 'Relay terputus'; notify(`${e.message}. Riwayat terakhir tetap ditampilkan; retry sekitar ${Math.ceil(nextDelay / 1000)} detik lagi.`);
  } }
  finally { polling = false; if (signedIn && gen === generation) { clearTimeout(timer); timer = setTimeout(poll, nextDelay); } }
}
async function connect(candidate) {
  await candidate.verify(); await candidate.read('lease.json'); const snapshot = await candidate.read('state.json');
  relay = candidate; generation++; signedIn = true; localStorage.setItem('ctf-relay', relay.repo); $('token').value = ''; $('key').value = '';
  $('login').hidden = true; $('desk').hidden = false; $('logout').hidden = false; $('login-error').textContent = '';
  if (snapshot) { state = snapshot.value; render(); } clearTimeout(timer); timer = setTimeout(poll, 0);
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter; b.disabled = true; $('login-error').textContent = 'Memeriksa relay privat dan pairing key...';
  try {
    const candidate = new GitHubRelay($('repo').value.trim(), $('token').value.trim(), await keyFromSecret($('key').value.trim()));
    await connect(candidate);
    try { if ($('remember').checked) await rememberSession(candidate); else await forgetSession(); }
    catch { notify('Terhubung, tetapi browser tidak bisa menyimpan koneksi. Setelah tab ditutup perlu pairing ulang.'); }
  } catch (e) { $('login-error').textContent = e.name === 'OperationError' ? 'Pairing key salah atau data tidak cocok.' : e.message; }
  finally { b.disabled = false; }
});
async function restoreConnection() {
  const controls = [...$('login-form').querySelectorAll('input,button')];
  controls.forEach(n => { n.disabled = true; });
  try {
    const saved = await savedSession(); if (!saved) return;
    $('repo').value = saved.repo; $('remember').checked = true;
    $('login-error').textContent = 'Menghubungkan kembali...';
    await connect(new GitHubRelay(saved.repo, saved.token, saved.key));
  } catch { $('login-error').textContent = 'Koneksi tersimpan belum bisa digunakan. Periksa internet atau masukkan token dan pairing key kembali.'; }
  finally { controls.forEach(n => { n.disabled = false; }); }
}
restoreConnection();
$('repo').value = localStorage.getItem('ctf-relay') || 'AlthafTM/ctfconnector-relay';
$('logout').addEventListener('click', async () => {
  signedIn = false; generation++; clearTimeout(timer); relay = undefined; state = undefined; selected = undefined; renderSignature = ''; pendingCommands.clear();
  for (const url of urls) URL.revokeObjectURL(url); urls.clear();
  $('task-view').replaceChildren(); $('audit').replaceChildren(); $('providers').replaceChildren(); $('task-list').replaceChildren(); $('monitor-data').replaceChildren();
  for (const d of document.querySelectorAll('dialog[open]')) d.close(); $('preview-image').removeAttribute('src'); $('create-form').reset();
  $('desk').hidden = true; $('login').hidden = false; $('logout').hidden = true; $('connection').textContent = 'Belum terhubung';
  $('remember').checked = false;
  try { await forgetSession(); } catch { $('login-error').textContent = 'Koneksi tersimpan gagal dihapus. Hapus data situs ini lewat pengaturan browser.'; }
});
$('refresh').addEventListener('click', () => { clearTimeout(timer); poll(); });
$('new-task').addEventListener('click', () => $('create-dialog').showModal());
$('close-create').addEventListener('click', () => $('create-dialog').close());
$('close-image').addEventListener('click', () => $('image-dialog').close());
$('prompt-maker').addEventListener('click', () => { $('maker-text').value = promptMakerInstructions(selected || '<TASK_ID>'); $('maker-dialog').showModal(); });
$('close-maker').addEventListener('click', () => $('maker-dialog').close());
$('copy-maker').addEventListener('click', e => action(e.target, () => navigator.clipboard.writeText($('maker-text').value).then(() => { $('maker-status').textContent = 'Prompt disalin.'; })));
$('image-dialog').addEventListener('close', () => { const url = $('preview-image').src; URL.revokeObjectURL(url); urls.delete(url); $('preview-image').removeAttribute('src'); });
$('emergency').addEventListener('click', e => action(e.target, async () => {
  if (await confirmAction('Emergency stop semua task?', 'Worker akan membatalkan semua operasi yang dikelolanya saat command diterima. Jika koneksi putus, hentikan worker langsung di PC.')) await send('emergency', null);
}));
$('reset-emergency').addEventListener('click', e => action(e.target, async () => { if (await confirmAction('Reset emergency?', 'Membuka antrean baru. Task yang dihentikan tidak dilanjutkan otomatis.')) await send('reset_emergency', null); }));
$('create-form').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter; b.disabled = true; const currentRelay = relay;
  try {
    const uploads = Array.from($('files').files);
    if (!$('description').value.trim() && !uploads.length) throw new Error('Isi teks soal atau lampirkan foto/file.');
    if (uploads.length > 10 || uploads.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Maksimal 10 file, masing-masing 20 MiB.');
    const files = [];
    for (const f of uploads) { $('create-error').textContent = `Mengenkripsi dan mengunggah ${f.name}...`; files.push(await currentRelay.upload(f)); }
    if (!signedIn || currentRelay !== relay) throw new Error('Session logout saat upload. Masuk kembali.');
    const taskId = crypto.randomUUID();
    await send('create', taskId, { name: $('name').value.trim() || `Soal ${new Date().toLocaleString('id-ID')}`, category: $('category').value, description: $('description').value, scope: $('scope').value,
      flagFormat: $('flag-format').value, provider: 'claude', profile: $('profile').value, autoAccept: $('create-auto-accept').checked, files, inputMode: !$('description').value.trim() && uploads.some(f => f.type.startsWith('image/')) ? 'photo' : 'text' });
    selected = taskId; $('create-dialog').close(); $('create-form').reset(); $('profile').value = 'default'; $('create-error').textContent = '';
  } catch (e) { $('create-error').textContent = e.message; } finally { b.disabled = false; }
});

$('back-home').addEventListener('click', () => { selected = undefined; renderSignature = ''; render(); });
