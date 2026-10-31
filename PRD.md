# AXTRA — Product Requirements Document (PRD) v1.1

**Product:** Axtra — Personal AI Agent  
**Version:** 1.1  
**Status:** Ready for implementation planning  
**Platform:** Web Application + Progressive Web App (PWA)  
**AI Provider:** Groq API  
**Primary Goal:** Membangun agen AI personal yang memahami pengguna secara berkelanjutan, membantu pengambilan keputusan, serta menjalankan tugas dan otomatisasi berdasarkan konteks kehidupan pengguna.

---

## 1. Product Overview

Axtra adalah platform personal AI agent yang dirancang untuk menjadi asisten digital jangka panjang. Axtra tidak hanya menjawab pertanyaan, tetapi juga mengelola pengetahuan personal, memahami preferensi, memantau perkembangan, membantu proses belajar, mendukung pengembangan perangkat lunak, dan memberikan rekomendasi proaktif.

Axtra harus mampu membangun pemahaman pengguna dari percakapan, profil, jurnal aktivitas, proyek, dokumen, dan aktivitas GitHub yang diizinkan pengguna.

Prinsip utama produk:

- **Personal:** Memahami konteks, preferensi, tujuan, dan cara komunikasi pengguna.
- **Persistent:** Menyimpan memori jangka panjang, bukan hanya konteks percakapan aktif.
- **Adaptive:** Memperbarui pemahaman berdasarkan informasi dan koreksi terbaru.
- **Proactive:** Mengidentifikasi prioritas dan menyarankan tindakan yang relevan.
- **Action-oriented:** Mengubah rekomendasi menjadi tugas, jadwal, dan tindakan yang dapat dieksekusi.
- **Privacy-conscious:** Pengguna dapat memeriksa, mengoreksi, dan menghapus informasi personal.

## 2. Product Objectives

1. Menyediakan percakapan AI yang memahami konteks personal pengguna.
2. Membangun sistem memori personal yang dapat diperbarui dan dicari.
3. Membantu pengguna mengevaluasi perkembangan kemampuan dan pencapaian.
4. Mendukung eksplorasi ide, penyusunan spesifikasi, dan pengembangan aplikasi.
5. Menjalankan pekerjaan terjadwal melalui background worker.
6. Mengirim laporan dan notifikasi meskipun PWA tidak sedang terbuka.
7. Menyediakan riset web, analisis dokumen, dan integrasi layanan eksternal.
8. Memaksimalkan penggunaan layanan gratis tanpa mengasumsikan kuota tanpa batas.

## 3. Target Platform dan Teknologi

### Frontend
- Next.js
- TypeScript
- Responsive UI
- Progressive Web App (PWA)
- Service Worker untuk dukungan instalasi dan push notification

### Backend
- Python
- FastAPI
- REST API
- Server-Sent Events (SSE) untuk streaming respons AI
- Background workers untuk tugas asinkron

### AI
- Groq API sebagai penyedia inferensi utama
- Model router berdasarkan jenis tugas dan ketersediaan model
- Tool calling jika didukung model yang dipilih
- Konfigurasi model dan batas pemakaian melalui environment variables

### Database dan Storage
- Supabase PostgreSQL
- pgvector untuk pencarian memori semantik
- Supabase Storage untuk file dan dokumen jika sesuai kuota
- Row Level Security (RLS) untuk isolasi data pengguna

### Deployment
- Vercel untuk frontend jika sesuai batas layanan
- Supabase untuk database dan layanan terkait
- Hosting backend Python yang mendukung proses API
- Scheduler dan worker pada lingkungan yang mendukung eksekusi persisten
- GitHub untuk version control dan CI/CD

Semua layanan harus diverifikasi berdasarkan kuota gratis, batas waktu eksekusi, kebijakan penggunaan, dan dukungan background process saat implementasi.

## 4. Core Features

### 4.1 AI Chat

Satu antarmuka percakapan untuk berbagai kebutuhan:

- Diskusi umum dan tanya jawab.
- Curhat dan refleksi personal.
- Brainstorming dan analisis masalah.
- Riset web dengan sumber yang dapat diperiksa.
- Analisis dokumen dan file yang diunggah.
- Analisis proyek dan kode.
- Pemanggilan tools berdasarkan kebutuhan.

Persyaratan:
- Streaming respons.
- Riwayat percakapan.
- Konteks percakapan yang relevan.
- Retrieval memori personal.
- Penanganan error, batas kuota, dan kegagalan provider.
- Pemisahan instruksi sistem, konteks memori, dan konten eksternal.

### 4.2 Personal Memory System

Sistem memori merupakan fondasi utama Axtra.

Jenis memori:

1. **Identity Memory:** Profil, latar belakang, preferensi, dan gaya komunikasi.
2. **Episodic Memory:** Peristiwa, pengalaman, keputusan, dan aktivitas yang dicatat.
3. **Semantic Memory:** Fakta dan pengetahuan yang relevan bagi pengguna.
4. **Project Memory:** Spesifikasi, keputusan teknis, progres, dan masalah proyek.
5. **Goal Memory:** Tujuan, target, tenggat, dan prioritas.
6. **Skill Memory:** Kemampuan, bukti pengalaman, kelemahan yang teridentifikasi, dan progres belajar.
7. **Conversation Memory:** Ringkasan percakapan dan konteks yang perlu dipertahankan.

Alur pengelolaan memori:

1. Mengumpulkan informasi dari sumber yang diizinkan.
2. Mengidentifikasi kandidat memori yang relevan.
3. Mengklasifikasikan informasi dan sumbernya.
4. Menyimpan fakta terstruktur beserta timestamp dan metadata.
5. Membuat embedding untuk pencarian semantik jika diperlukan.
6. Mengambil memori relevan ketika menjawab.
7. Memperbarui atau menandai konflik informasi.
8. Memberikan kontrol kepada pengguna untuk mengoreksi atau menghapus memori.

Setiap memori perlu menyimpan sumber, waktu pencatatan, dan tingkat keyakinan bila relevan. Inferensi AI tidak boleh diperlakukan sebagai fakta yang sudah dikonfirmasi.

### 4.3 Daily Journal

Fitur untuk mencatat aktivitas dan perkembangan pengguna.

Data yang dapat dicatat:
- Aktivitas harian.
- Pencapaian dan kendala.
- Hal yang dipelajari.
- Waktu dan fokus kerja jika dilaporkan.
- Progres proyek.
- Refleksi dan rencana berikutnya.

Axtra dapat menyusun ringkasan harian, mendeteksi pola, dan mengusulkan prioritas berdasarkan data yang tersedia. Pengguna harus dapat memperbaiki kesimpulan yang keliru.

### 4.4 AI Mentor

Mentor personal yang membantu pengembangan diri dan kemampuan profesional.

Fungsi:
- Mengevaluasi progres berdasarkan bukti.
- Mengidentifikasi kesenjangan keterampilan.
- Menyusun rekomendasi belajar.
- Membuat target mingguan.
- Membandingkan progres aktual dengan target.
- Menyarankan langkah berikutnya.
- Membuat laporan perkembangan harian dan mingguan.

Evaluasi harus membedakan antara fakta, indikasi, dan asumsi. Aktivitas seperti jumlah commit GitHub tidak boleh dijadikan satu-satunya indikator kemampuan.

### 4.5 Vibecoding Assistant

Mendukung proses pengembangan ide menjadi proyek perangkat lunak.

Alur utama:

```
IDE MENTAH -> DISCOVERY -> SPESIFIKASI -> RENCANA IMPLEMENTASI
-> EXTERNAL CODING AGENT -> VERIFIKASI -> ITERASI
```

Tahapan:
1. **Ide mentah** — pengguna menulis apa yang ingin dibangun, masalah, target pengguna, serta preferensi/kendala. Kolom non-esensial boleh kosong.
2. **Discovery terpandu AI** — percakapan persisten. Setiap turn: ringkasan pemahaman, maksimal tiga pertanyaan paling berdampak dengan pilihan/rekomendasi, dan pencatatan keputusan atau asumsi. Kategori yang dievaluasi dipilih dinamis (produk, pengguna, fitur, data, arsitektur, keamanan, UI/UX, testing, performa, deployment, biaya, aturan bisnis); kategori yang tidak relevan tidak dipaksakan.
3. **Status informasi eksplisit** — `CONFIRMED`, `ASSUMED`, `RESEARCH`, `NEEDS_DECISION`, `VALIDATION_REQUIRED`. Asumsi tidak pernah otomatis diubah menjadi keputusan pengguna.
4. **Dokumentasi progresif** — tujuh jenis artefak: `PRD`, `ARCHITECTURE`, `ACCEPTANCE_TEST_PLAN`, `UI_UX_SPEC`, `AGENT_INSTRUCTIONS`, `IMPLEMENTATION_PLAN`, `DEFINITION_OF_DONE`. Dokumen memakai Markdown, dapat diedit dan diregenerasi, memiliki versi, status review (`DRAFT`, `NEEDS_REVIEW`, `APPROVED`, `STALE`), dan riwayat yang tidak menimpa versi approved secara diam-diam.
5. **Perencanaan implementasi** — spesifikasi yang cukup matang diubah menjadi task dengan ID, goal, scope, modul terdampak, dependencies, acceptance criteria, testing, dan operasi berisiko. Task masuk ke papan tugas proyek yang sudah ada sehingga mendukung eksekusi inkremental/prototype lebih dulu.
6. **Handoff ke coding agent eksternal** — Axtra menyusun prompt yang dapat disalin berisi konteks task/proyek, requirement, acceptance criteria, testing, batasan keamanan, dan format laporan penyelesaian. Prompt memakai artefak approved yang relevan, bukan seluruh dokumentasi.
7. **Verifikasi dan iterasi** — setiap task punya status verifikasi (`TODO`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_REVIEW`, `DONE`) dan bukti (output test/log/ringkasan). Status `DONE` mensyaratkan bukti; Axtra tidak menandai lulus hanya karena model menyatakannya. Perubahan keputusan menandai dokumen terkait `STALE`, dan riwayat tetap disimpan.

Batas MVP: tidak ada eksekusi terminal, pengeditan kode otonom, commit/push otomatis, deployment otomatis, atau integrasi GitHub write. Axtra hanya menghasilkan spesifikasi, rencana, prompt, dan mencatat bukti dari agen eksternal.

Axtra harus menyimpan keputusan penting, spesifikasi, teknologi yang dipilih, kendala, dan progres setiap proyek secara terpisah. Vibe Coding adalah alur kerja di dalam Proyek, bukan pengganti manajemen proyek yang ada.

### 4.6 GitHub Integration

Integrasi GitHub pada tahap pengembangan lanjutan.

Kemampuan:
- Menghubungkan akun dengan izin yang sesuai.
- Menampilkan repository yang dipilih.
- Mengambil metadata repository.
- Membaca aktivitas commit, pull request, dan issue yang diizinkan.
- Menghubungkan aktivitas dengan proyek dan skill.
- Menyusun ringkasan progres.

Gunakan izin read-only pada tahap awal. Jangan menyimpan token akses di memori percakapan. Aksi yang menulis kode, membuat issue, atau mengubah repository memerlukan izin terpisah.

### 4.7 Research and File Analysis

Kemampuan riset dan analisis dokumen meliputi:
- Pencarian web.
- Ringkasan sumber.
- Perbandingan informasi.
- Analisis PDF, TXT, Markdown, dan format lain yang didukung.
- Ekstraksi informasi relevan untuk memori.
- Penyusunan laporan dengan referensi sumber.

Konten dari web dan file harus diperlakukan sebagai data yang tidak tepercaya, bukan sebagai instruksi yang dapat mengambil alih kontrol agen.

### 4.8 Automation Engine

Sistem untuk menjalankan pekerjaan secara terjadwal tanpa bergantung pada browser yang sedang terbuka.

Kemampuan:
- Menyimpan jadwal.
- Menjalankan background jobs.
- Mencatat status dan hasil eksekusi.
- Menangani kegagalan dan retry secara terbatas.
- Mengirim notifikasi hasil.
- Menampilkan riwayat eksekusi.
- Memungkinkan pengguna menjeda atau membatalkan pekerjaan.

Contoh automasi awal:
- Laporan harian pada pukul 21.00 WIB.
- Review mingguan pada hari Minggu pukul 20.00 WIB.
- Pengingat target.
- Ringkasan aktivitas dan proyek.

Jadwal di atas merupakan default awal yang dapat diubah pengguna.

Background jobs harus disimpan secara persisten. Jangan mengandalkan timer di frontend, tab browser, atau proses serverless yang dapat berhenti kapan saja.

### 4.9 Notifications

Kanal notifikasi:
- Telegram Bot.
- Web Push pada PWA.

Jenis notifikasi:
- Laporan harian dan mingguan.
- Pengingat jadwal.
- Status pekerjaan otomatis.
- Kegagalan tugas penting.
- Rekomendasi prioritas.
- Permintaan persetujuan sebelum tindakan tertentu.

Pengiriman notifikasi harus menghormati preferensi, jam tenang, dan batas frekuensi pengguna.

### 4.10 Creator Tools

Tahap awal berfokus pada:
- Ide konten.
- Riset topik.
- Hook dan outline.
- Naskah video.
- Caption dan kalender konten.
- Analisis materi yang diunggah.

Pembuatan gambar dan video akan menggunakan integrasi provider eksternal jika tersedia. Groq berfungsi sebagai penyedia inferensi model bahasa, bukan sebagai generator gambar atau video bawaan. Ketersediaan gratis untuk fitur generatif perlu diverifikasi secara terpisah.

## 5. Proactive Agent Behavior

Axtra dapat:
- Mengidentifikasi tugas yang tertunda.
- Menemukan konflik jadwal.
- Menyarankan prioritas berdasarkan tujuan.
- Mengusulkan jadwal belajar.
- Mengingatkan progres yang tidak bergerak.
- Menyarankan tindakan berdasarkan pola yang teramati.

Batas otonomi:
- Analisis dan rekomendasi dapat berjalan otomatis.
- Tugas terjadwal dapat berjalan setelah dikonfigurasi.
- Perubahan komitmen, pengiriman eksternal, penghapusan data, atau tindakan berdampak besar memerlukan persetujuan, kecuali pengguna telah memberikan otorisasi yang jelas dan terbatas.
- Pengguna dapat menghentikan automasi dan mencabut integrasi.

## 6. Database Design

Entitas awal yang disarankan:

- `profiles`
- `conversations`
- `messages`
- `memories`
- `memory_embeddings`
- `daily_logs`
- `goals`
- `skills`
- `skill_evidence`
- `projects`
- `project_documents`
- `github_repositories`
- `github_activities`
- `scheduled_jobs`
- `job_runs`
- `notifications`
- `user_integrations`

Setiap tabel harus memiliki skema yang sesuai, timestamp, relasi, dan kebijakan akses. Tidak semua entitas harus dibuat sekaligus; skema berkembang berdasarkan kebutuhan tiap fase.

## 7. API Structure

Kelompok endpoint awal:

- `/api/chat` — percakapan dan streaming.
- `/api/conversations` — riwayat percakapan.
- `/api/memories` — pencarian, koreksi, dan pengelolaan memori.
- `/api/journal` — aktivitas harian.
- `/api/goals` — target dan prioritas.
- `/api/skills` — keterampilan dan bukti progres.
- `/api/projects` — proyek dan dokumen.
- `/api/integrations/github` — koneksi dan sinkronisasi GitHub.
- `/api/automation/jobs` — jadwal dan pekerjaan otomatis.
- `/api/notifications` — preferensi dan riwayat notifikasi.

Endpoint merupakan rancangan awal; kontrak request/response dan autentikasi ditentukan sebelum implementasi tiap modul.

## 8. Security and Privacy

Persyaratan minimum:
- Autentikasi yang aman.
- Proteksi sesi dan cookie yang sesuai.
- Validasi input pada backend.
- Secrets hanya di environment variables atau secret manager.
- Kebijakan RLS untuk data personal.
- Pemisahan data antar pengguna.
- Izin integrasi minimum yang diperlukan.
- Pembatasan ukuran file dan jenis file.
- Rate limiting dan penanganan error.
- Log aktivitas tanpa membocorkan secrets.
- Mekanisme ekspor, koreksi, dan penghapusan data.
- Konfirmasi sebelum tindakan eksternal yang berdampak besar.

## 9. Free-Tier Strategy

Tujuan proyek adalah meminimalkan biaya operasional.

Strategi:
- Memakai Groq API selama model dan kuotanya tersedia.
- Memanfaatkan layanan database dan hosting dengan paket gratis.
- Memprioritaskan PWA daripada aplikasi native pada tahap awal.
- Menggunakan Telegram Bot untuk notifikasi dengan biaya rendah.
- Menghemat token melalui ringkasan percakapan dan retrieval memori.
- Membatasi sinkronisasi dan tugas berat berdasarkan kuota.
- Menyediakan penanganan rate limit dan kegagalan provider.

**Batasan:** Layanan gratis dapat memiliki rate limit, sleep, batas eksekusi, dan perubahan kebijakan. Operasional 24/7 tidak dapat dijamin hanya dengan mengandalkan paket gratis. Kebutuhan scheduler dan worker harus diuji pada provider yang dipilih.

## 10. Development Roadmap

### Phase 1 — Core Chat and Memory
- Setup repository dan environment.
- Autentikasi dasar.
- UI chat responsif.
- Integrasi Groq.
- Streaming respons.
- Penyimpanan percakapan.
- Profil dan memori personal.
- Pencarian memori.
- Pengelolaan dan koreksi memori.

### Phase 2 — Journal and Projects
- Daily journal.
- Tujuan dan prioritas.
- Manajemen proyek.
- Dokumen proyek.
- Ringkasan progres.

### Phase 3 — AI Mentor
- Pemetaan keterampilan.
- Penyimpanan bukti kemampuan.
- Rekomendasi belajar.
- Laporan harian dan mingguan.

### Phase 4 — Automation and Notifications
- Persistent job queue.
- Scheduler.
- Background worker.
- Integrasi Telegram Bot.
- PWA Push.
- Riwayat dan retry pekerjaan.

### Phase 5 — GitHub and Vibecoding
- Integrasi GitHub read-only.
- Sinkronisasi aktivitas.
- Hubungan aktivitas dengan proyek.
- Alur ide menjadi PRD dan task breakdown. ✅ MVP Vibe Coding workspace (discovery, tujuh artefak berversi, task planning, prompt handoff, verifikasi) selesai. Integrasi GitHub write dan eksekusi otonom tetap di luar cakupan.

### Phase 6 — Research and Creator Tools
- Web research.
- Analisis file yang lebih luas.
- Ide konten dan naskah.
- Integrasi provider gambar/video jika layak.

## 11. MVP Acceptance Criteria

MVP dianggap memenuhi kebutuhan awal apabila:

1. Pengguna dapat masuk dan mengakses aplikasi melalui browser desktop maupun mobile.
2. Pengguna dapat mengirim pesan dan menerima respons streaming dari Groq.
3. Percakapan dapat disimpan dan dibuka kembali.
4. Informasi personal yang relevan dapat disimpan sebagai memori dengan sumber dan waktu pencatatan.
5. Axtra dapat mengambil memori yang relevan untuk menjawab pertanyaan.
6. Pengguna dapat memeriksa, mengoreksi, dan menghapus memori.
7. Pengguna dapat mencatat aktivitas dan target.
8. Aplikasi dapat menjalankan setidaknya satu scheduled job secara persisten tanpa browser terbuka.
9. Telegram dapat menerima notifikasi hasil pekerjaan.
10. Error provider, rate limit, dan kegagalan tugas ditangani tanpa kehilangan data penting.
11. Akses data personal dilindungi autentikasi dan kebijakan akses.
12. Batasan paket gratis dan status pekerjaan dapat diketahui pengguna.

## 12. Product Success Metrics

Metrik awal:
- Keberhasilan retrieval memori pada skenario pengujian.
- Ketepatan fakta personal berdasarkan data yang tersimpan.
- Tingkat keberhasilan background jobs.
- Keberhasilan pengiriman notifikasi.
- Latensi respons chat.
- Frekuensi kegagalan dan rate limit.
- Jumlah koreksi memori yang diperlukan.
- Konsistensi laporan progres dengan bukti yang tersedia.

Target numerik ditetapkan setelah baseline MVP dan pengujian awal tersedia.

## 13. Implementation Principles

- Bangun MVP terlebih dahulu; hindari mengimplementasikan semua modul sekaligus.
- Prioritaskan keandalan memori sebelum otonomi kompleks.
- Gunakan model dan provider melalui lapisan abstraksi.
- Simpan keputusan penting dan status pekerjaan secara persisten.
- Pisahkan logika AI dari aturan bisnis dan izin tindakan.
- Uji retrieval, autentikasi, isolasi data, dan background jobs.
- Dokumentasikan setup, environment variables, database migrations, dan deployment.
- Hindari menjanjikan kemampuan yang belum tersedia atau belum diuji.

## 14. Definition of Product

**Axtra adalah personal AI agent yang terus membangun pemahaman tentang pengguna melalui memori yang terkelola, membantu pengembangan diri dan proyek, serta menjalankan pekerjaan proaktif yang terukur dan dapat dikendalikan pengguna.**

Prioritas pertama adalah membangun fondasi yang dapat dipercaya: chat, memori jangka panjang, kontrol data, dan deployment. Kemampuan mentor, integrasi, serta automasi diperluas setelah fondasi tersebut stabil.