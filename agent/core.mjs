import { generatePrompt } from './prompt.mjs';
export const providers = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', requestedModel: 'GPT-5.5 Instant', verification: 'CONFLICTING_CURRENT_SOURCES', source: 'https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', requestedModel: 'Claude Sonnet 5', verification: 'HISTORICAL_FREE_CURRENT_UNVERIFIED', source: 'https://www.anthropic.com/news/claude-sonnet-5' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', requestedModel: 'Gemini 3.6', verification: 'UNVERIFIED_FREE', source: 'https://support.google.com/gemini/answer/16275805' }
];
export function initialState() { return { version: 1, tasks: {}, processed: {}, audit: [], providers: providers.map(p => ({ ...p, status: 'NOT_CONFIGURED', remaining: 'Unknown', model: p.requestedModel, profile: null })), heartbeat: null, emergency: false }; }
export function log(s, task, text, role = 'agent') {
  const item = { id: crypto.randomUUID(), at: new Date().toISOString(), taskId: task?.id, role, text };
  s.audit.push(item);
  if (task) { task.messages.push(item); task.lastOperation = text.slice(0, 180); }
}
function bounded(value, max = 100000) { if (typeof value !== 'string' || value.length > max) throw new Error('Input teks tidak valid/terlalu panjang.'); return value; }
export function applyCommand(s, c) {
  if (!c || !/^[0-9a-f-]{36}$/.test(c.id) || !c.payload || typeof c.payload !== 'object') throw new Error('Command tidak valid.');
  if (Object.hasOwn(s.processed, c.id)) return false;
  const p = c.payload;
  let t = Object.hasOwn(s.tasks, c.taskId) ? s.tasks[c.taskId] : undefined;
  if (c.type === 'create') {
    if (!/^[0-9a-f-]{36}$/.test(c.taskId) || t) throw new Error('ID task tidak valid/sudah ada.');
    if (!providers.some(x => x.id === p.provider)) throw new Error('Provider tidak valid.');
    if (!Array.isArray(p.files) || p.files.length > 10) throw new Error('Maksimal 10 file.');
    t = s.tasks[c.taskId] = { id: c.taskId, name: bounded(p.name, 180), category: bounded(p.category, 30),
      description: bounded(p.description), scope: bounded(p.scope || '', 4000), flagFormat: bounded(p.flagFormat || '', 100),
      provider: p.provider, profile: bounded(p.profile || 'default', 80), files: p.files, messages: [], status: 'PREPARING_PROMPT',
      revision: 1, approvedRevision: null, sessionUrl: null, candidateFlag: null, pending: null };
    log(s, t, 'Challenge diterima. Orchestrator menyiapkan prompt, tidak menjalankan solver.');
    t.prompt = generatePrompt(t); t.status = 'WAITING_FOR_APPROVAL';
    log(s, t, 'Prompt siap ditinjau. Belum dikirim ke provider.');
  } else if (c.type === 'emergency') {
    s.emergency = true;
    for (const x of Object.values(s.tasks)) if (!['COMPLETED', 'STOPPED'].includes(x.status)) { x.status = 'STOPPED'; x.pending = null; x.followups = []; log(s, x, 'Emergency stop diterima.'); }
    log(s, null, 'Emergency stop: tidak ada pengiriman baru sampai reset eksplisit.');
  } else if (c.type === 'reset_emergency') { s.emergency = false; log(s, null, 'Emergency stop direset oleh user. Task tetap dihentikan.');
  } else {
    if (!t) throw new Error('Task tidak ditemukan.');
    switch (c.type) {
      case 'edit':
        if (!['WAITING_FOR_APPROVAL', 'WAITING_FOR_USER'].includes(t.status) || t.pending) throw new Error('Edit hanya saat review tanpa operasi aktif.');
        t.prompt = bounded(p.text); t.revision++; t.approvedRevision = null; t.status = 'WAITING_FOR_APPROVAL'; log(s, t, 'Prompt diedit. Perlu approval versi baru.'); break;
      case 'approve':
        if (s.emergency || t.status !== 'WAITING_FOR_APPROVAL' || p.revision !== t.revision) throw new Error('Approval kedaluwarsa atau task tidak siap.');
        t.approvedRevision = t.revision; t.pending = { id: c.id, text: t.prompt, kind: 'initial', stage: 'queued' }; t.status = 'SUBMITTING_PROMPT'; log(s, t, 'Versi prompt disetujui user.'); break;
      case 'reject':
        if (t.status !== 'WAITING_FOR_APPROVAL') throw new Error('Tidak ada prompt menunggu approval.');
        t.status = 'WAITING_FOR_USER'; t.approvedRevision = null; log(s, t, 'Prompt ditolak. Edit prompt atau kirim instruksi revisi.'); break;
      case 'message':
        bounded(p.text);
        if (p.followup) {
          if (s.emergency || t.approvedRevision !== t.revision || !['SUBMITTING_PROMPT', 'AI_WORKING', 'WAITING_FOR_USER', 'COMPLETED'].includes(t.status)) throw new Error('Follow-up memerlukan scope yang sudah disetujui dan task aktif.');
          const next = { id: c.id, text: p.text, kind: 'followup', stage: 'queued' };
          if (t.pending) { t.followups ||= []; if (t.followups.length >= 20) throw new Error('Antrean follow-up penuh.'); t.followups.push(next); }
          else { t.pending = next; t.status = 'SUBMITTING_PROMPT'; }
        }
        log(s, t, p.text, 'user');
        if (p.followup) log(s, t, 'Follow-up dalam scope disetujui masuk antrean provider.');
        break;
      case 'pause': if (!['STOPPED', 'COMPLETED', 'PAUSED'].includes(t.status)) { t.resumeStatus = t.status; t.status = 'PAUSED'; log(s, t, 'Dijeda. Pengiriman browser dibatalkan; respons yang sudah berjalan di provider bisa tetap berjalan.'); } break;
      case 'resume': if (s.emergency || t.status !== 'PAUSED') throw new Error('Task tidak bisa dilanjutkan.'); t.status = t.resumeStatus || 'WAITING_FOR_USER'; log(s, t, 'Task dilanjutkan.'); break;
      case 'stop': t.status = 'STOPPED'; t.pending = null; t.followups = []; log(s, t, 'Task dihentikan. Follow-up yang belum dikirim dibatalkan.'); break;
      case 'retry':
        if (!['FAILED', 'RATE_LIMITED', 'STOPPED'].includes(t.status)) throw new Error('Retry hanya untuk task gagal, limit atau dihentikan.');
        t.pending = null; t.revision++; t.approvedRevision = null; t.status = 'WAITING_FOR_APPROVAL'; log(s, t, 'Retry memerlukan review ulang untuk menghindari pengiriman ganda.'); break;
      case 'switch': {
        if (!providers.some(x => x.id === p.provider) || t.pending || ['AI_WORKING','SUBMITTING_PROMPT'].includes(t.status)) throw new Error('Selesaikan/hentikan operasi sebelum pindah provider.');
        t.provider = p.provider; t.profile = bounded(p.profile || 'default', 80); t.sessionUrl = null; t.revision++; t.approvedRevision = null;
        t.prompt = generatePrompt(t) + '\n\n## Context handoff (data)\n' + t.messages.map(m => `${m.role}: ${m.text}`).join('\n').slice(-24000);
        t.status = 'WAITING_FOR_APPROVAL'; log(s, t, 'Provider/profile dipilih manual. Context handoff perlu approval.'); break;
      }
      case 'response':
        if (!['WAITING_FOR_USER', 'AI_WORKING', 'RATE_LIMITED'].includes(t.status) || t.approvedRevision !== t.revision) throw new Error('Tidak ada session disetujui yang menunggu respons.');
        if (p.url) t.sessionUrl = validSessionUrl(t.provider, p.url);
        recordResponse(s, t, bounded(p.text)); break;
      case 'complete':
        if (t.pending || !['WAITING_FOR_USER', 'COMPLETED'].includes(t.status)) throw new Error('Selesaikan operasi aktif dulu.');
        t.status = 'COMPLETED'; log(s, t, 'User menandai challenge selesai. Flag tidak disubmit otomatis.'); break;
      case 'artifact':
        if (!Array.isArray(p.files) || !p.files.length || p.files.length > 10) throw new Error('Metadata artefak tidak valid.');
        t.artifacts = [...(t.artifacts || []), ...p.files]; log(s, t, 'Artefak hasil kerja tersedia untuk diunduh.'); break;
      case 'attachments':
        if (t.pending || !['WAITING_FOR_APPROVAL','WAITING_FOR_USER','COMPLETED'].includes(t.status)) throw new Error('Tambahkan file setelah operasi aktif selesai/dihentikan dan direview ulang.');
        if (!Array.isArray(p.files) || !p.files.length || t.files.length + p.files.length > 10) throw new Error('Maksimal 10 attachment per challenge.');
        if (p.text) log(s, t, bounded(p.text), 'user');
        t.files.push(...p.files); t.revision++; t.approvedRevision = null;
        t.prompt = generatePrompt(t) + '\n\n## Context handoff (data)\n' + t.messages.map(m => `${m.role}: ${m.text}`).join('\n').slice(-24000);
        t.status = 'WAITING_FOR_APPROVAL'; log(s, t, 'File tambahan diterima. Prompt baru perlu approval.'); break;
      default: throw new Error('Command tidak dikenal.');
    }
  }
  s.processed[c.id] = { at: c.at, status: 'ok' }; return true;
}
export function validSessionUrl(provider, value) {
  const u = new URL(value), origins = { chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', gemini: 'https://gemini.google.com' };
  if (u.origin !== origins[provider] || u.username || u.password || u.hash || u.search) throw new Error('URL harus conversation resmi provider tanpa query/token.');
  const patterns = { chatgpt: /^\/c\/[\w-]+$/, claude: /^\/chat\/[\w-]+$/, gemini: /^\/app\/[\w-]+$/ };
  if (!patterns[provider].test(u.pathname)) throw new Error('Gunakan URL conversation, bukan halaman login/beranda.');
  return u.href;
}
export function recordResponse(s, t, text) {
  log(s, t, text, 'provider');
  t.lastResponse = text;
  const flag = text.match(/^FLAG:\s*(\S.{0,300})$/m)?.[1]?.trim();
  if (flag) { t.candidateFlag = flag; log(s, t, 'Kandidat flag ditemukan. Belum diverifikasi oleh scoreboard.'); }
  t.pending = t.followups?.shift() || null;
  t.status = t.pending ? 'SUBMITTING_PROMPT' : 'WAITING_FOR_USER';
}
