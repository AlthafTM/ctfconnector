# CTF Connector

Dashboard HP untuk mengoordinasikan challenge CTF dengan worker Windows. Orchestrator berbasis aturan menyiapkan prompt Indonesia, meminta approval, menyimpan context setiap challenge, dan meneruskan hasil provider. Orchestrator **tidak memecahkan challenge atau menjalankan perintah solver**.

- Dashboard: https://althaftm.github.io/ctfconnector/
- Source: https://github.com/AlthafTM/ctfconnector
- Relay: repo GitHub **privat** terpisah, dibuat oleh setup. Tidak membutuhkan akun Firebase/Supabase atau kartu pembayaran.

## Arsitektur yang dipakai

```text
HP / GitHub Pages -- HTTPS GitHub REST --> private encrypted relay
                                                ^
                                                | outbound HTTPS
                                           Windows worker
                                                |
                                    visible browser / manual handoff
                                                |
                                       external free-tier AI
```

Repo publik hanya berisi kode dashboard/worker. Relay menyimpan command, snapshot task, lease worker, serta chunk file dalam envelope AES-256-GCM. AAD mengikat ciphertext pada repo dan path; key 256-bit acak hanya dibagikan ke perangkat sendiri. GitHub masih melihat metadata path, ukuran dan waktu aktivitas. Payload terenkripsi juga tetap berada di riwayat Git.

Dashboard polling setiap 10 detik (30 detik jika tab di background). Worker polling setiap 10 detik dan heartbeat setiap 60 detik. Ini **near-real-time polling, bukan WebSocket**. Jeda aktual tergantung GitHub, internet, antrean dan batas API. Emergency stop jarak jauh juga memerlukan koneksi, bukan tombol pemutus PC yang offline.

## Instalasi dan start di Windows

Butuh Node.js 22+ dari situs resmi, Git for Windows, serta Edge/Chrome untuk profile browser opsional. Tidak ada dependency npm untuk runtime.

```powershell
git clone https://github.com/AlthafTM/ctfconnector.git
cd ctfconnector
node scripts/setup.mjs
node scripts/pair.mjs
node agent/main.mjs
```

Setup memakai `CTF_GITHUB_TOKEN` dari environment jika tersedia; jika tidak, Git Credential Manager yang sudah login. Token harus bisa membuat repo privat saat setup. Jika belum ada login Git, login Git Credential Manager terlebih dahulu. Untuk worker harian, gunakan fine-grained token khusus relay dengan repository Contents read/write; simpan dalam environment lokal atau credential manager, jangan dalam source. Setup tidak menulis token ke file.

Pairing key disimpan di `.local/config.json` menggunakan Windows DPAPI untuk akun Windows saat ini. `scripts/pair.mjs` menampilkan key di terminal lokal. **Jangan tempel output key/token ke issue, chat publik atau laporan.** Backup `.local/config.json` bersama profil Windows/DPAPI secara aman: kehilangan key berarti payload relay tidak dapat didekripsi. Rotasi key belum otomatis.

Di HP, buat [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) yang hanya memilih repo relay, Contents read/write. Buka dashboard, masukkan `owner/ctfconnector-relay`, token, dan pairing key. Token dan key ada di memori tab; refresh/menutup tab meminta login ulang. Riwayat challenge diambil kembali setelah login. Keluar membersihkan tampilan dan key dari referensi aplikasi. GitHub token bukan model/API AI berbayar.

PC harus tetap menyala, tidak sleep, dan worker tetap berjalan di terminal. `Ctrl+C` menghentikan worker. Setelah crash, pastikan proses worker lama sudah mati sebelum menghapus `.local/worker.lock`; lease cloud bisa membutuhkan sampai 180 detik untuk habis. Jangan jalankan dua worker pada relay yang sama. Installer service/startup otomatis belum dipasang.

## Alur kerja

1. Tambah challenge, kategori, deskripsi, scope, format flag dan file. Maksimal 10 file per challenge, 20 MiB per file; format binary, source, ZIP, PCAP dan gambar ditransfer sebagai bytes, tidak dieksekusi.
2. Worker menyusun enam bagian prompt Indonesia. Reference [PROMPT MASTER asli](docs/PROMPT_MASTER_ORIGINAL.md) disimpan tanpa perubahan; generator menerapkan struktur dengan template kategori, bukan panggilan LLM berbayar.
3. Edit/simpan prompt jika perlu. Setiap edit membuat revisi baru; approval hanya berlaku untuk revisi yang sedang ditampilkan. Prompt belum pernah dikirim sebelum approval.
4. Default profile menggunakan **handoff manual**. Setelah approval, dashboard meminta user membuka situs resmi provider, memastikan akun/model free tier, menyalin prompt, mengunggah file, lalu mengimpor respons dan URL conversation resmi. Ini dapat dilakukan dari HP. Tidak perlu kembali mengetik instruksi di terminal.
5. Respons, ringkasan progres, kandidat `FLAG:` dan conversation URL disimpan per challenge. Follow-up memakai session yang sama; user harus mencentang bahwa follow-up masih dalam scope yang disetujui.
6. Jika tujuan/target/scope berubah, buat challenge baru atau simpan revisi prompt lalu approval lagi. Pindah provider/profile membuat context handoff untuk approval; tidak ada rotasi akun otomatis.
7. Jeda/lanjut/hentikan/retry/emergency mengubah state worker yang sesungguhnya. Menjeda/menghentikan tidak menarik kembali prompt yang sudah diterima provider. Browser monitoring dibatalkan; provider bisa tetap menyelesaikan respons.
8. Respons provider adalah data. Tidak diperlakukan sebagai perintah shell, permintaan token, atau izin memperluas scope. Kandidat flag tidak disubmit ke scoreboard.

## Browser automation opsional, dibatasi izin provider

Otomasi tidak aktif secara default. Reference image meminta GPT-5.5 Instant, Claude Sonnet 5 dan Gemini 3.6. Nama-nama itu tetap dicatat; **tidak ada substitusi model diam-diam dan tidak ada klaim model benar-benar terpilih tanpa verifikasi**. Lihat [bukti dan batasan provider](docs/PROVIDERS.md).

Claude consumer terms melarang automated/non-human access kecuali lewat API atau izin eksplisit. Karena itu default Claude tetap manual. Mengubah flag config tidak menciptakan izin provider. Untuk provider mana pun, hanya aktifkan adapter setelah mendapat izin yang berlaku untuk akun/akses tersebut. Tidak ada bypass login, CAPTCHA atau limit.

Untuk membuka profile terpisah yang tetap lokal:

```powershell
node scripts/open-profile.mjs chatgpt:default
```

Login dilakukan user di browser yang terlihat. Cookies/profile disimpan di `.local/profiles/`, tidak dikirim ke relay. Setiap profile/account mempunyai direktori terpisah. Untuk account tambahan, tambahkan key misalnya `claude:account2` dalam `.local/config.json`, dengan `provider: "claude"` dan `profile: "account2"`. Pilih profile secara eksplisit dari dashboard; patuhi aturan provider terkait account switch.

Adapter visible-browser menggunakan CDP loopback. Setelah verifikasi, konfigurasi profile lokal harus berisi:

```json
{
  "provider": "chatgpt",
  "profile": "default",
  "mode": "automated",
  "freeTierVerified": true,
  "model": "NAMA MODEL YANG BENAR-BENAR TERVERIFIKASI",
  "verificationEvidence": "sumber resmi + tanggal dan hasil cek akun free",
  "automationPermissionEvidence": "izin provider yang berlaku untuk akses ini",
  "editor": "CSS selector editor",
  "submit": "CSS selector tombol submit",
  "response": "CSS selector pesan assistant",
  "busy": "CSS selector indikator generation aktif",
  "limit": "CSS selector notifikasi limit",
  "login": "CSS selector form login",
  "modelSelector": "CSS selector nama model aktif",
  "fileInput": "input[type=file]",
  "uploadBusy": "CSS selector upload yang masih berjalan"
}
```

Jangan gunakan placeholder di atas sebagai selector aktual. Selector perlu diuji pada UI provider saat itu; markup pihak ketiga bisa berubah. Model yang terlihat harus sesuai config. File di-download dengan checksum ke `.local/downloads/<task>/`; tidak di-unpack atau dijalankan. Satu profile diproses serial; profile independen dapat berjalan bersamaan. Saat limit terlihat, status RATE_LIMITED dan notifikasi asli disimpan; tidak ada retry otomatis melalui akun lain. Persentase/reset quota tidak dikarang: sisa tampil Unknown dan pesan limit asli ditampilkan bila tersedia. Monitoring terhenti jika task dijeda, dihentikan atau koneksi hilang.

**Adapter terhadap situs AI nyata belum diverifikasi end-to-end.** Mode manual adalah fallback fungsional yang tersedia sekarang. Unattended solving via free consumer websites belum terpenuhi tanpa izin, akun login dan adapter yang tervalidasi. Web chat juga tidak otomatis mempunyai akses shell/tool PC; prompt menyatakan batasan itu.

## Artefak dari PC

```powershell
node scripts/artifact.mjs <task-uuid> C:\path\hasil.txt C:\path\screenshot.png
```

File dienkripsi, command diantrekan, lalu tombol unduh muncul setelah worker mengakui. Ini hanya upload file yang user/operator pilih; output AI tidak dapat memicu arbitrary local file reads. Gambar raster PNG/JPEG/WebP/GIF dapat dipreview; file lain diunduh sebagai binary, termasuk HTML/SVG.

## Reliability dan batas operasional

- UUID command dan journal processed mencegah command yang sama dieksekusi ulang saat reconnect. State lokal ditulis atomik dan terenkripsi sebelum snapshot/ack cloud.
- Lease compare-and-swap menolak worker kedua. Konflik write, hilang koneksi dan error API memicu backoff maksimal 60 detik, tanpa membuang state. Operasi browser dihentikan saat relay gagal atau lease tidak segar.
- Sebelum click submit, worker menyimpan batas `sending`. Setelah crash di batas ini, worker meminta pemeriksaan conversation; **tidak menjanjikan exactly-once untuk UI pihak ketiga** dan tidak mengirim ulang secara otomatis.
- History, file dan processed journal belum punya retensi/garbage collection otomatis. Git bukan object store tak terbatas. Repo relay dapat membesar; arsipkan ke relay baru dan simpan key lama bila perlu. Tree terpotong menimbulkan error, bukan diam-diam melewatkan command.
- GitHub API mempunyai primary/secondary limits. Chunk besar memerlukan banyak request/commit. Tahan upload massal, jangan polling lebih agresif tanpa menghitung limit. Tidak cocok untuk trafik banyak user atau file besar.
- Isolasi user memakai private repository ACL + pairing key terpisah per deployment. Ini deployment satu pemilik, bukan multi-tenant RBAC. Orang yang diberi token write dan key mempunyai kontrol atas relay tersebut.
- Jangan ubah relay menjadi public. Aplikasi memeriksa visibility saat koneksi/poll dan menolak public repo; enkripsi tetap membatasi pembacaan riwayat jika visibility tak sengaja berubah. Cabut token jika HP/key hilang.
- Remote UI merender challenge/AI sebagai teks, tidak HTML. CSP hanya mengizinkan script lokal dan koneksi GitHub API; token tidak dimasukkan ke URL, source atau log aplikasi.
- Tidak ada arbitrary shell command endpoint. Windows local admin/software lain tetap berada di luar trust boundary. CDP port terikat loopback dan hanya dipakai profile khusus.

## Test dan deployment

```powershell
node --test tests/core.test.mjs tests/relay.test.mjs tests/worker.test.mjs
node scripts/preview.mjs
```

Preview lokal: http://127.0.0.1:4173. Fixture UI **khusus pengujian**, tanpa GitHub/provider nyata:

```powershell
node scripts/qa-server.mjs
```

Fixture: http://127.0.0.1:4174, repo `test/private`, token `test-only`, key `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`. Fixture server **tidak** masuk artefak GitHub Pages. Untuk uji relay privat nyata, hentikan worker terlebih dahulu lalu jalankan `node scripts/live-check.mjs`; script menambah satu task yang jelas ditandai TEST, tanpa mengontak AI.

Workflow `.github/workflows/pages.yml` menjalankan test Node.js, mengunggah folder `web/` saja, lalu deploy GitHub Pages menggunakan OIDC. Repository Settings > Pages harus Source: GitHub Actions. Tidak ada secret build. Lihat [hasil verifikasi](docs/VERIFICATION.md) untuk pengujian yang benar-benar dijalankan dan yang belum.
