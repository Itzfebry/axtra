# AXTRA — Product Requirements Document (PRD) v1.2

**Product:** Axtra — Personal AI Agent  
**Version:** 1.2  
**Status:** Sebagian besar Phase 1, 2, 5, dan 6 sudah diimplementasikan; automation/notifikasi belum  
**Tanggal:** 31 Oktober 2026  
**Platform:** Web Application + Progressive Web App (PWA)  
**AI Provider:** Multi-provider OpenAI-compatible (Groq, OpenRouter, OpenAI, Google Gemini, Cloudflare Workers AI, provider custom)  
**Primary Goal:** Membangun agen AI personal yang memahami pengguna secara berkelanjutan, membantu pengambilan keputusan, serta menjalankan tugas berdasarkan konteks kehidupan pengguna.

> Dokumen ini sudah diselaraskan dengan kondisi implementasi per 31 Oktober 2026. Bagian yang belum dibangun ditandai eksplisit agar tidak dibaca sebagai janji fitur.

---

## 1. Product Overview

Axtra adalah platform personal AI agent yang dirancang menjadi asisten digital jangka panjang. Axtra tidak hanya menjawab pertanyaan, tetapi juga mengelola pengetahuan personal, memahami preferensi, memantau perkembangan, membantu proses belajar, mendukung pengembangan perangkat lunak, dan memberikan rekomendasi proaktif.

Axtra membangun pemahaman pengguna dari percakapan, profil, memori, proyek, dokumen, sumber riset web, dan indeks repository GitHub yang diizinkan pengguna.

Saat ini Axtra adalah aplikasi **single-owner**: satu kata sandi aplikasi, satu `OWNER_USER_ID`, tanpa Supabase Auth di browser. Model multi-tenant belum menjadi target.

Prinsip utama produk:

- **Personal:** Memahami konteks, preferensi, tujuan, dan cara komunikasi pengguna.
- **Persistent:** Menyimpan memori jangka panjang, bukan hanya konteks percakapan aktif.
- **Adaptive:** Memperbarui pemahaman berdasarkan informasi dan koreksi terbaru.
- **Proactive:** Memberi digest dan rekomendasi dari riwayat interaksi.
- **Action-oriented:** Mengubah rekomendasi menjadi task, dokumen, dan artefak yang dapat dieksekusi.
- **Privacy-conscious:** Pengguna dapat memeriksa, mengoreksi, dan menghapus informasi personal.
- **Provider-agnostic:** Chat dan gambar memakai bentuk OpenAI-compatible; provider dapat diganti tanpa mengubah pemanggil.

## 2. Status Implementasi

Matriks status per 31 Oktober 2026:

| Area | Status | Catatan |
|---|---|---|
| Chat multi-mode | ✅ | General, Curhat, Brainstorming, Document, Riset Web; SSE, opsi jawaban, stop, tab, slash command, `@mention` |
| Memori personal | ✅ | Ekstraksi otomatis, CRUD, retrieval semantik/keyword, cluster + merge topik |
| Multi-provider LLM | ✅ | Groq, OpenRouter, OpenAI, Gemini, Cloudflare, provider custom |
| Pengaturan model | ✅ | Tab **Model teks** dan **Model gambar** terpisah |
| Skills terstruktur | ✅ | Markdown + metadata, relasi per fitur, import `SKILL.md`, preview |
| Peran & perilaku | ✅ | Persona per mode/fitur, instruksi bebas, provider crawl per user |
| Riset Web | ✅ | Crawl URL, pencarian web Firecrawl, sumber per percakapan, simpan ke memori |
| Proyek | ✅ | Metadata, label, data non-repo, indeks repo GitHub, RAG kode, tasks, kesehatan AI |
| Vibe Coding | ✅ MVP | Discovery, 7 artefak berversi, keputusan, task planning, prompt handoff, verifikasi |
| Cari Kerja | ✅ | Tracker lamaran, CV, LinkedIn/portfolio, crawl lowongan, match score, cover letter |
| Generated Image | ✅ | Model gambar terpisah, katalog, referensi, style, rasio/resolusi, streaming, kuota |
| Beranda orchestrator | ✅ | Perintah bahasa alami untuk navigasi, menu, tema, simpan memori |
| Pemakaian token | ✅ | Meter token/menit + harian WIB, rincian per model |
| PWA | 🟡 | Manifest + service worker shell; push notification belum |
| Daily Journal | ⏳ | Belum ada |
| Goal/target | ⏳ | Belum ada |
| AI Mentor | ⏳ | Belum ada |
| Automation / scheduler persisten | ⏳ | Belum ada |
| Telegram / web push | ⏳ | Env disiapkan, worker belum |
| GitHub OAuth read/write | ⏳ | Saat ini hanya indexing repo lewat token env |

## 3. Target Platform dan Teknologi

### Frontend (aktual)
- Next.js 15 (App Router) + React 19
- TypeScript
- Tailwind CSS v4 dengan design token terpusat di `globals.css`
- Lucide untuk ikon
- PWA: Web App Manifest + service worker shell
- `middleware.ts` memproteksi rute via cookie sesi

### Backend (aktual)
- Python ≥ 3.11 + FastAPI
- REST API dengan cookie sesi HttpOnly, `SameSite=Lax`, `Secure` saat production
- Server-Sent Events (SSE) untuk streaming chat dan gambar
- Gzip selektif; endpoint SSE dikecualikan
- Rate limit baca/tulis; owner scoping lewat service role

### AI (aktual)
- Adapter tunggal `OpenAICompatibleProvider` untuk semua chat model
- Katalog provider bawaan: Groq, OpenRouter, OpenAI, Google Gemini, Cloudflare Workers AI
- Provider custom OpenAI-compatible dapat ditambah dari UI
- API key user disimpan terenkripsi (`APP_ENCRYPTION_KEY`); fallback ke satu kunci Groq env
- Model teks (`preferences.llm`) dan model gambar (`preferences.llm_image`) disimpan terpisah
- Rantai fallback: provider terpilih → kunci Groq env → error jelas

### Database dan Storage (aktual)
- Supabase PostgreSQL
- `pgvector` (extensi `vector`) untuk retrieval memori semantik dan chunk kode
- RLS aktif tanpa policy per-user; hanya service role backend yang membaca/menulis
- 28 migration berurutan di `supabase/migrations/`

### Integrasi eksternal (aktual)
- GitHub API + `raw.githubusercontent.com` untuk indeks repo
- Firecrawl (`/v2/search`, `/v2/scrape`) atau parser `httpx` bawaan untuk crawl
- Hugging Face untuk embedding opsional
- Image API (OpenRouter-style `/images`, Cloudflare Workers AI) untuk Generated Image

### Deployment
- Vercel untuk frontend jika sesuai batas layanan
- Supabase untuk database
- Hosting backend Python yang mendukung proses API persisten
- GitHub untuk version control

Semua layanan harus diverifikasi berdasarkan kuota gratis, batas eksekusi, dan dukungan background process sebelum diandalkan.

## 4. Core Features

### 4.1 AI Chat

Satu antarmuka percakapan dengan lima mode: `general`, `curhat`, `brainstorming`, `document`, `research`.

Persyaratan yang sudah berjalan:
- Streaming respons via SSE; event `meta`, `token`, `memory`, `warning`, `done`, `error`.
- Riwayat percakapan multi-tab dengan indikator streaming dan tombol stop.
- Retrieval memori personal lintas mode; memori dibagi di semua mode.
- Slash command per mode, lampiran dokumen (TXT/MD/PDF), `@mention` proyek/lamaran.
- Opsi jawaban interaktif disimpan di `messages.metadata.options`.
- Persona per mode dari `profiles.preferences.chat_modes`.
- Pemisahan instruksi sistem, konteks memori, dan konten eksternal (web/dokumen dianggap data tidak tepercaya).
- Penanganan error, batas kuota, dan kegagalan provider dengan pesan jelas.

### 4.2 Personal Memory System

Fondasi utama Axtra.

Jenis memori yang disimpan: **Identity**, **Episodic**, **Semantic**, **Project**, **Skill**, serta fakta umum dari percakapan. (Goal memory belum.)

Alur pengelolaan memori:
1. Mengumpulkan informasi dari percakapan, dokumen, dan sumber riset.
2. Mengekstraksi kandidat fakta setelah jawaban (`MEMORY_EXTRACTION_ENABLED`).
3. Mengklasifikasikan tipe dan menyimpan dengan sumber, timestamp, dan confidence.
4. Membuat embedding untuk pencarian semantik bila embedding aktif.
5. Mengambil memori relevan ketika menjawab (`MEMORY_RETRIEVAL_COUNT`, `MEMORY_MIN_SIMILARITY`).
6. Mengelompokkan topik serupa (`MEMORY_CLUSTER_SIMILARITY`) dan menyediakan merge.
7. Memberi kontrol penuh untuk koreksi dan hapus di `/memory`.

Inferensi AI tidak diperlakukan sebagai fakta terkonfirmasi. Sumber web/dokumen tercatat sebagai asal fakta.

### 4.3 Daily Journal

**Belum diimplementasikan.** Rencana: mencatat aktivitas, pencapaian, kendala, waktu fokus, progres proyek, dan refleksi; Axtra menyusun ringkasan dan mendeteksi pola; pengguna dapat mengoreksi kesimpulan.

### 4.4 AI Mentor

**Belum diimplementasikan.** Rencana: evaluasi progres berbasis bukti, identifikasi kesenjangan keterampilan, rekomendasi belajar, target mingguan, laporan harian/mingguan. Evaluasi harus membedakan fakta, indikasi, dan asumsi; commit GitHub bukan indikator tunggal.

### 4.5 Vibe Coding Assistant

Sudah berjalan sebagai **MVP** (Phase 5). Mendukung proses dari ide menjadi spesifikasi dan rencana implementasi. Axtra tidak mengeksekusi kode.

Alur:

```
IDE MENTAH -> DISCOVERY -> SPESIFIKASI -> RENCANA IMPLEMENTASI
-> CODING AGENT EKSTERNAL -> VERIFIKASI -> ITERASI
```

Yang sudah berjalan:
1. **Discovery terpandu** — percakapan persisten; setiap turn menyimpan ringkasan, pertanyaan berdampak, dan keputusan/asumsi.
2. **Status eksplisit** — `CONFIRMED`, `ASSUMED`, `RESEARCH`, `NEEDS_DECISION`, `VALIDATION_REQUIRED`. Asumsi tidak otomatis menjadi keputusan.
3. **Tujuh artefak** — `PRD`, `ARCHITECTURE`, `ACCEPTANCE_TEST_PLAN`, `UI_UX_SPEC`, `AGENT_INSTRUCTIONS`, `IMPLEMENTATION_PLAN`, `DEFINITION_OF_DONE`, dengan versi immutable dan status review (`DRAFT`, `NEEDS_REVIEW`, `APPROVED`, `STALE`).
4. **Perencanaan implementasi** — task dengan goal, scope, modul, dependencies, acceptance criteria, testing; masuk ke `project_tasks` dengan `source='vibe'`.
5. **Prompt handoff** — disusun deterministik dari task + artefak approved (fallback draft), memuat requirement, acceptance criteria, batasan keamanan, dan format laporan.
6. **Verifikasi** — status (`TODO`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_REVIEW`, `DONE`); `DONE` mensyaratkan bukti. Perubahan keputusan menandai artefak `STALE`.

Batas MVP: tidak ada eksekusi terminal, pengeditan kode otonom, commit/push otomatis, deployment otomatis, atau GitHub write. Axtra hanya menghasilkan spesifikasi, rencana, prompt, dan mencatat bukti dari agen eksternal.

### 4.6 GitHub Integration

Saat ini **read-only untuk indexing**: mengambil file dari GitHub API/raw, memecah chunk, opsional embedding, dan menyimpan progres indeks untuk fitur Tanya repo.

Belum ada: OAuth, sinkronisasi aktivitas commit/PR/issue, GitHub write (commit, issue, PR). Token disimpan di env server, tidak pernah di memori percakapan.

### 4.7 Research and File Analysis

Sudah berjalan:
- Mode Riset dengan crawl URL dan pencarian web.
- Crawl via parser `httpx` bawaan (default, gratis) atau Firecrawl `/v2/scrape`.
- Pencarian web via Firecrawl `/v2/search`.
- Sumber disimpan per percakapan (`research_sources`), dibatasi `RESEARCH_MAX_SOURCES`, disuntik ke prompt.
- Fallback Firecrawl ke parser bawaan saat kredit habis, rate limit, timeout, atau error jaringan; kunci tidak valid tidak di-fallback.
- Kredit Firecrawl dicatat di `crawl_usage_events`.
- Mode Document menerima TXT, MD, PDF (teks, bukan biner).
- Sumber web dapat disimpan menjadi memori.

Konten dari web dan file diperlakukan sebagai data tidak tepercaya, bukan instruksi yang mengambil alih kontrol agen.

### 4.8 Automation Engine

**Belum diimplementasikan.** Rencana: jadwal persisten, background worker, retry terbatas, notifikasi hasil, riwayat eksekusi, jeda/batal. Contoh: laporan harian 21.00 WIB, review mingguan Minggu 20.00 WIB, pengingat target. Background jobs harus persisten; tidak boleh bergantung pada timer frontend atau tab browser.

### 4.9 Notifications

**Belum diimplementasikan.** Rencana kanal: Telegram Bot dan Web Push PWA. Jenis: laporan, pengingat, status pekerjaan, kegagalan penting, rekomendasi, permintaan persetujuan. Harus menghormati preferensi, jam tenang, dan batas frekuensi.

### 4.10 Generated Image

Sudah berjalan (Phase 6, sebagian). Halaman `/images` membuat gambar dari prompt teks.

Kemampuan:
- Prompt teks + gambar referensi (image-to-image).
- Style preset (append fragmen prompt), rasio, resolusi, kualitas, format output, background, seed, steps, jumlah gambar.
- Katalog model live dari Image API; parameter yang tidak didukung model disembunyikan.
- Streaming pratinjau bila model mendukung.
- Routing provider gambar terpisah dari provider teks (`preferences.llm_image`).
- Batas harian `IMAGE_DAILY_LIMIT`; telemetri di `image_usage_events`.
- Provider bawaan: OpenRouter-style Image API dan Cloudflare Workers AI (termasuk model fallback terkurasi).

Belum ada: riwayat gambar persisten penuh (kini disimpan di state sesi browser), editor gambar lanjutan, dan garansi model gratis.

### 4.11 Creator Tools

Sebagian sudah berjalan lewat Generated Image. Belum ada: ide konten terstruktur, hook/outline, naskah video, caption, dan kalender konten. Pembuatan video belum.

## 5. Proactive Agent Behavior

Yang sudah berjalan:
- `AssistantDigest` di beranda menampilkan sapaan dan 3–4 rekomendasi dari riwayat, memori, dan profil; di-cache di browser dan dapat dimuat ulang.
- Orchestrator beranda menafsirkan perintah bahasa alami dan menjalankan aksi terbatas.

Belum ada: penemuan konflik jadwal, pengingat progres, dan analisis pola otomatis.

Batas otonomi:
- Analisis dan rekomendasi boleh otomatis.
- Tugas terjadwal (nanti) berjalan setelah dikonfigurasi.
- Perubahan komitmen, pengiriman eksternal, atau penghapusan data selalu memerlukan aksi eksplisit pengguna.

## 6. Database Design (aktual)

Entitas yang sudah ada di `supabase/migrations/`:

- `profiles` — identitas, preferensi (termasuk `preferences.llm`, `preferences.llm_image`, `preferences.chat_modes`)
- `conversations`, `messages` — percakapan multi-mode + metadata
- `memories`, `memory_embeddings` — memori + vektor
- `chat_documents` — dokumen teks dalam chat
- `token_usage_events` — pemakaian token per model
- `projects`, `project_code_chunks`, `project_documents`, `project_tasks`, `project_asks`, `project_conversations` — workspace proyek, indeks kode, data non-repo, papan tugas
- `research_sources` — sumber riset per percakapan
- `job_applications`, `job_cv` — Cari Kerja
- `crawl_usage_events` — kredit crawl
- `vibe_sessions`, `vibe_messages`, `vibe_decisions`, `vibe_artifacts`, `vibe_artifact_versions` — Vibe Coding
- `skills`, `feature_skills` — pustaka skill + relasi
- `provider_keys` — API key user terenkripsi
- `image_usage_events` — telemetri gambar

Belum ada: `daily_logs`, `goals`, `skill_evidence`, `github_repositories`, `github_activities`, `scheduled_jobs`, `job_runs`, `notifications`, `user_integrations`.

## 7. API Structure (aktual)

Semua endpoint berprefix `/api` dan memakai cookie sesi kecuali health/login.

- `/api/health` — status
- `/api/auth` — `status`, `login`, `logout`
- `/api/profile` — profil + preferensi
- `/api/chat` — SSE satu turn
- `/api/conversations` — riwayat, pesan, rename, hapus
- `/api/documents` — unggah/daftar/hapus dokumen teks
- `/api/memories` — CRUD, `search`, `clusters`, `merge`
- `/api/chat-settings` — persona mode + provider crawl
- `/api/feature-settings` — persona per fitur + skill
- `/api/skills` — CRUD skill + `parse`
- `/api/providers` — CRUD provider, selection, image-selection, key, models, ping, recommendations, quota
- `/api/research` — `crawl`, `search`, `sources`, simpan sumber ke memori
- `/api/projects` — CRUD, indeks repo, Tanya repo, health, tasks, dokumen, file explorer, chat terkait
- `/api/projects/{id}/vibe` — sessions, messages, decisions, artifacts, versions, tasks, prompt, verification
- `/api/jobs` — CRUD lamaran, CV, links, crawl portfolio/lowongan, analyze, cover-letter
- `/api/images` — `config`, `models`, `endpoints`, `credits`, `usage`, `style`, `generate`, `generate/stream`
- `/api/usage` — meter token
- `/api/orchestrator` — aksi beranda
- `/api/recommendations` — digest beranda

## 8. Security and Privacy

Sudah diterapkan:
- Autentikasi satu kata sandi (`APP_PASSWORD`) dengan cookie sesi bertanda tangan (`SESSION_SECRET`).
- Cookie HttpOnly, `SameSite=Lax`, `Secure` saat production.
- Semua akses data lewat backend memakai service role; browser tidak pernah memegang service key.
- API key provider user disimpan terenkripsi (`APP_ENCRYPTION_KEY`).
- Validasi input backend, batas ukuran file (`MAX_UPLOAD_BYTES`), batas panjang konten (`MAX_DOCUMENT_CHARS`, `RESEARCH_MAX_CHARS`, `SKILL_MAX_CHARS`).
- Rate limit baca/tulis.
- Guard SSRF sebelum crawl; normalisasi URL.
- Konten eksternal diperlakukan sebagai data tidak tepercaya.
- Firecrawl self-host harus diisolasi dari jaringan internal.

Batasan: siapa pun yang mengetahui `APP_PASSWORD` dapat mengakses seluruh data. Gunakan kata sandi kuat. Belum ada ekspor/penghapusan data satu klik (data dapat dihapus per item).

## 9. Free-Tier Strategy

- Memakai provider gratis bila tersedia (Groq, OpenRouter free, Cloudflare Workers AI).
- Memanfaatkan database dan hosting paket gratis.
- Memprioritaskan PWA.
- Menghemat token via retrieval memori dan batas konteks (`MAX_CONTEXT_MESSAGES`).
- Crawl default memakai parser `httpx` bawaan (gratis).
- Batas kredit Firecrawl dan batas harian gambar ditegakkan server.

**Batasan:** layanan gratis punya rate limit, sleep, batas eksekusi, dan perubahan kebijakan. Operasional 24/7 tidak dijamin hanya dengan paket gratis.

## 10. Development Roadmap

### Phase 1 — Core Chat and Memory ✅
Autentikasi, UI chat responsif, streaming, penyimpanan percakapan, profil, memori, retrieval, koreksi memori.

### Phase 2 — Journal and Projects 🟡
Proyek, dokumen, indeks repo, task, kesehatan AI, chat terkait **selesai**. Daily journal dan goal **belum**.

### Phase 3 — AI Mentor ⏳
Belum.

### Phase 4 — Automation and Notifications ⏳
Persistent job queue, scheduler, background worker, Telegram, PWA push, riwayat/retry **belum**.

### Phase 5 — GitHub and Vibecoding 🟡
Vibe Coding MVP (discovery, tujuh artefak berversi, task planning, prompt handoff, verifikasi) **selesai**. GitHub read-only indexing repo **selesai**. GitHub OAuth/write dan eksekusi otonom **belum**.

### Phase 6 — Research and Creator Tools 🟡
Riset Web (crawl + pencarian) dan Generated Image **selesai**. Creator content tools (ide, hook, naskah, caption, kalender) **belum**.

### Lintas fase ✅
Multi-provider LLM, settings model teks/gambar terpisah, orchestrator beranda, meter token.

## 11. MVP Acceptance Criteria

Snapshot kondisi saat ini:

1. ✅ Pengguna dapat masuk dan mengakses aplikasi dari desktop dan mobile.
2. ✅ Pengguna dapat mengirim pesan dan menerima respons streaming dari provider terpilih.
3. ✅ Percakapan dapat disimpan dan dibuka kembali; mendukung beberapa tab.
4. ✅ Informasi personal disimpan sebagai memori dengan sumber dan waktu.
5. ✅ Axtra mengambil memori relevan untuk menjawab.
6. ✅ Pengguna dapat memeriksa, mengoreksi, dan menghapus memori.
7. ⏳ Pengguna dapat mencatat aktivitas dan target harian (belum).
8. ⏳ Menjalankan scheduled job persisten tanpa browser (belum).
9. ⏳ Telegram menerima notifikasi hasil pekerjaan (belum).
10. ✅ Error provider, rate limit, dan kegagalan tugas ditangani tanpa kehilangan data penting.
11. ✅ Akses data personal dilindungi autentikasi.
12. ✅ Batasan paket gratis dan status pekerjaan dapat diketahui pengguna (meter token, peringatan kredit).

## 12. Product Success Metrics

Metrik yang relevan saat ini:
- Keberhasilan retrieval memori pada skenario pengujian.
- Ketepatan fakta personal berdasarkan data tersimpan.
- Latensi respons chat dan waktu penyelesaian turn.
- Frekuensi kegagalan dan rate limit.
- Jumlah koreksi memori yang diperlukan.
- Tingkat keberhasilan streaming (chat dan gambar).
- Konsistensi laporan progres proyek dengan bukti.

Metrik yang menunggu fitur: tingkat keberhasilan background jobs dan pengiriman notifikasi.

## 13. Implementation Principles

- Bangun inkremental; jangan mengklaim fitur yang belum ada.
- Prioritaskan keandalan memori sebelum otonomi kompleks.
- Gunakan lapisan abstraksi provider.
- Simpan keputusan penting dan status pekerjaan secara persisten.
- Pisahkan logika AI dari aturan bisnis dan izin tindakan.
- Uji retrieval, autentikasi, isolasi data, dan integrasi eksternal.
- Dokumentasikan setup, environment variables, migration, dan deployment.
- Perlakukan konten eksternal sebagai data tidak tepercaya.

## 14. Definition of Product

**Axtra adalah personal AI agent yang terus membangun pemahaman tentang pengguna melalui memori yang terkelola, membantu pengembangan diri, proyek, pencarian kerja, dan produksi visual, serta menjalankan pekerjaan proaktif yang terukur dan dapat dikendalikan pengguna.**

Prioritas pertama sudah terpenuhi: fondasi chat, memori jangka panjang, kontrol data, dan deployment. Fokus berikutnya adalah journal/target, automation engine persisten, notifikasi, dan integrasi GitHub lanjutan.
