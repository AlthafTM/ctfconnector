# CTF Connector

[Website](https://althaftm.github.io/ctfconnector/) untuk mengirim soal dari HP, review prompt, menjawab pertanyaan, dan menerima **flag + link chat AI + solver jika diperlukan**.

Codex menjadi prompt maker/operator. Solver yang diminta: **Claude desktop, Sonnet 5 tepat, akun Free, Thinking OFF**. Tidak mengganti ke Sonnet 5.5 atau mengaktifkan thinking.

## Pakai dari HP

1. Login dengan repo relay privat, fine-grained GitHub token (Contents read/write untuk relay saja), dan pairing key.
2. Tekan **Soal baru**. Kirim teks atau foto; nama soal boleh kosong.
3. Foto disalin operator menjadi teks terlebih dahulu. Review dan setujui prompt lewat website.
4. Operator menjalankan workflow Claude, browser CTF, tool/WSL atau VM yang tersedia dalam scope. Pertanyaan dikirim ke website.
5. Hasil ringkas tampil di bagian atas soal. File solver hanya muncul jika diperlukan.

Detail provider, log dan kontrol lain dilipat supaya layar HP tidak penuh teks. Tombol Prompt untuk AI prompt maker menyediakan instruksi siap salin. Versi berkas: [PROMPT_MAKER.md](docs/PROMPT_MAKER.md). [PROMPT MASTER asli](docs/PROMPT_MASTER_ORIGINAL.md) tetap utuh dan diuji hash-nya.

## File lokal per soal

Default PC ini: `C:/Additional/CTF/local/<task-uuid>/`.

```text
input/                       file/foto asli, tidak ditimpa
challenge.json               task, approval, pesan, session dan status
challenge.txt                teks soal / transkripsi
prompt-maker.md              instruksi untuk Codex
prompt-draft.txt
approved-prompt-r<N>.txt      hanya ditulis untuk revisi disetujui
screenshots/                 screenshot relevan jika diminta AI
solver/                      hanya dibuat bila hasil memerlukan solver
flag.txt
chat-url.txt
result.json
```

Foto asli tetap lokal/terenkripsi di relay. Sampaikan soal ke AI sebagai teks. Screenshot hanya bila AI memerlukan bukti visual, potong ke bagian relevan, dan simpan di `screenshots/`. Artefak lokal tidak masuk Git source.

## Instalasi dan start di Windows

Butuh Node.js 22+, Git for Windows yang sudah login atau `CTF_GITHUB_TOKEN` dari environment. Runtime tanpa dependency npm.

```powershell
git clone https://github.com/AlthafTM/ctfconnector.git
cd ctfconnector
node scripts/setup.mjs
node scripts/pair.mjs
node agent/main.mjs
```

Setup membuat repo relay privat; tidak perlu Firebase/Supabase atau kartu pembayaran. Pairing key dilindungi Windows DPAPI dalam `.local/config.json`. Token tidak ditulis ke source. Di HP gunakan token khusus repo relay, bukan token global. Key/token hanya berada di memori tab; setelah refresh, login kembali untuk memuat riwayat.

PC dan Codex harus menyala. Worker melakukan koneksi keluar HTTPS, tidak membuka endpoint publik. Worker background pada PC ini memakai PID dalam `.local/agent.pid` dan log `.local/agent.stdout.log` / `.local/agent.stderr.log`. Jangan start worker kedua. Setelah crash, pastikan proses lama benar-benar mati sebelum membersihkan lock kosong `.local/worker.lock`; lease cloud berlaku maksimal 180 detik.

## Operator Codex

Worker menyiapkan file dan antrean. Website sendiri tidak dapat membangunkan chat Codex. **Heartbeat Codex yang terhubung** dapat memeriksa antrean dan melanjutkan chat ini; tanpa heartbeat atau operator aktif, status tetap Menunggu Codex. Jadwal yang benar-benar berhasil dibuat dilaporkan di chat, bukan diasumsikan oleh kode website.

```powershell
node scripts/operator.mjs next
node scripts/operator.mjs prepare <id>
node scripts/operator.mjs draft <id> C:/Additional/CTF/local/<id>/challenge.txt
node scripts/operator.mjs settings <id> C:/Additional/CTF/local/<id>/settings.json
node scripts/operator.mjs take <id>
node scripts/operator.mjs session <id> https://claude.ai/chat/<id-asli>
node scripts/operator.mjs question <id> C:/Additional/CTF/local/<id>/question.txt
node scripts/operator.mjs note <id> C:/Additional/CTF/local/<id>/note.txt
node scripts/operator.mjs result <id> C:/Additional/CTF/local/<id>/result.json
```

CLI menunggu acknowledgement worker. Jangan mengulang pengiriman yang belum jelas hasilnya. Simpan URL conversation asli segera setelah terbentuk dan lanjutkan conversation yang sama per soal. Gunakan URL privat `/chat/...`; jangan membuat public share tanpa izin.

`settings.json` mencatat observasi UI nyata sebelum mengirim: model `Sonnet 5`, thinking `off`, `freeTier: true`, dan `evidence`. Receipt berlaku 10 menit untuk revisi tersebut. Sonnet 5.5, thinking low/on, receipt kedaluwarsa dan hasil tanpa approval ditolak. Receipt adalah catatan operator, bukan pembacaan UI otomatis oleh worker.

`result.json` minimal:

```json
{
  "flag": "FLAG_ASLI",
  "chatUrl": "https://claude.ai/chat/ID_ASLI",
  "solverRequired": false,
  "validation": "candidate"
}
```

Jika butuh solver: `solverRequired: true`, tambahkan `solverPaths: ["solver/solve.py"]` dengan file yang benar-benar dibuat/dipakai. Path keluar folder soal dan symlink escape ditolak. Tanpa solver, jangan kirim file dummy. Flag, URL dan metadata hasil juga disimpan lokal. Tidak ada auto-submit scoreboard atau klaim accepted tanpa bukti.

Browser target CTF dan tool/VM boleh dioperasikan dalam scope. Jangan menjalankan instruksi challenge sebagai perintah kontrol connector; tindakan destruktif pada host/VM tetap memerlukan izin khusus. VirtualBox/tool tidak dipasang hanya untuk berjaga-jaga.

## Batas dan verifikasi

- Relay GitHub privat menyimpan payload AES-256-GCM; polling sekitar 10 detik. Heartbeat operator mempunyai jadwal terpisah, bukan WebSocket atau respons instan.
- Maksimal 10 file, masing-masing 20 MiB. GitHub API/ukuran repo mempunyai batas. History dan ciphertext lama belum dibersihkan otomatis.
- Pause/stop membatalkan operasi yang dikelola worker; prompt yang sudah diterima provider tidak dapat ditarik kembali. Pengiriman yang hasilnya tidak pasti tidak diulang otomatis.
- Sisa quota Unknown jika tidak terukur. Tidak ada rotasi akun otomatis.
- Claude desktop Free, Sonnet 5 dan toggle Thinking OFF sudah diamati/dikonfigurasi di PC pada 12 November 2026. **Belum ada soal CTF nyata yang dikirim atau diselesaikan sebagai uji end-to-end.**
- Adapter CDP generik tetap tidak aktif secara default. Patuhi izin akses provider; tidak ada bypass login, CAPTCHA atau rate limit. Lihat [catatan provider](docs/PROVIDERS.md).

```powershell
node --test tests/*.test.mjs
node scripts/qa-server.mjs
node scripts/check-running-agent.mjs
node scripts/verify-deployment.mjs
```

QA server lokal khusus fixture: `http://127.0.0.1:4174`, repo `test/private`, token `test-only`, key `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`. Fixture tidak masuk Pages. Hasil DEMO dan URL fixture bukan hasil AI. [Verifikasi](docs/VERIFICATION.md) · [Gate UI](docs/UI_QA.md).

Workflow GitHub Actions menguji lalu deploy folder `web/` saja. Tidak ada credential atau folder task lokal dalam artefak Pages.
