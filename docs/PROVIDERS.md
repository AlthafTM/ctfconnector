# Verifikasi provider

Tanggal pemeriksaan: 12 November 2026. Gambar user meminta nama spesifik di bawah. Akses historis tidak membuktikan akses akun gratis saat ini. Tidak ada akun provider yang dilogin atau request CTF yang dikirim selama implementasi.

| Provider | Model pada gambar | Bukti resmi yang ditemukan | Keputusan default |
| --- | --- | --- | --- |
| ChatGPT | GPT-5.5 Instant | [Pengumuman GPT-5.5 Instant](https://openai.com/index/gpt-5-5-instant/) menyatakan rollout semua pengguna. [Pricing](https://chatgpt.com/pricing/) mencantumkan akses Free, tetapi [Free Tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) yang dibaca menyebut default lain. | Sumber saat ini tidak konsisten; verifikasi ulang model pada akun. Manual, sisa Unknown. |
| Claude | Claude Sonnet 5 | [Pengumuman Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5) menyebut semua plan saat rilis. [Pricing](https://claude.com/pricing) menyebut Sonnet di Free tanpa versi pasti; [halaman Sonnet](https://www.anthropic.com/claude/sonnet) kini menyebut versi lain. | Akses historis Free terkonfirmasi, versi tepat saat ini belum terverifikasi. Manual. |
| Gemini | Gemini 3.6 | [Help Gemini limits](https://support.google.com/gemini/answer/16275805?hl=en) tidak memberikan konfirmasi eksplisit akses gratis versi 3.6 dalam halaman yang diperiksa. | Tidak terverifikasi; jangan mengaktifkan atau mengganti model diam-diam. Manual. |

[Claude Consumer Terms, bagian 3.7](https://www.anthropic.com/legal/consumer-terms) membatasi akses automated/non-human kecuali API atau izin eksplisit. Otomasi bukan cara default untuk akun consumer Claude. Untuk provider lain, project tidak mengklaim izin hanya karena suatu browser automation secara teknis mungkin; adapter tetap terkunci sampai evidence izin dan free tier dikonfigurasi lokal.

Label CONNECTED hanya ditulis setelah adapter benar-benar menyelesaikan pengiriman/observasi response. Membuka situs, adanya cookie atau token relay tidak membuktikan bahwa provider login, model sesuai, atau quota tersedia. Sisa Unknown bukan persentase estimasi. Pesan limit asli dapat memuat waktu reset dan akan diteruskan tanpa membuat jadwal reset sendiri.
