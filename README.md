# Axtra

Personal AI agent yang memahami pengguna secara berkelanjutan melalui sistem memori, membantu pengembangan diri dan proyek, serta menjalankan pekerjaan proaktif.

> **Status:** Phase 1 (Core Chat & Memory) + Project workspace, Cari Kerja, dan **Vibe Coding MVP** (PRD §4.5).
> Belum termasuk: journal, mentor otomatis, automation, GitHub read/write, creator tools.

## Struktur

```
axtra/
├── PRD.md              # Product Requirements Document
├── Design.md           # Design System & UI Guidelines
├── supabase/migrations # Skema + RLS + RPC (dijalankan berurutan)
├── backend/            # FastAPI (Python) — API + SSE streaming
│   └── app/
│       ├── main.py             # Entrypoint + CORS + error handler
│       ├── config.py           # Settings dari environment variables
│       ├── deps.py             # Session cookie auth, rate limit, owner scoping
│       ├── security.py         # Password check + signed session token
│       ├── llm.py              # LLMProvider abstraction + Groq (SSE)
│       ├── embeddings.py       # EmbeddingProvider abstraction
│       ├── prompts.py          # System prompt + ekstraksi memori
│       ├── supabase_client.py  # Service-role client untuk owner tunggal
│       ├── memory_service_provider.py # Factory wiring
│       ├── chat_modes.py       # Preset role/perilaku + slash command tiap mode
│       ├── routers/            # health, auth, profile, chat, projects, vibe, jobs, research, memories, usage
│       └── services/           # memory, project, vibe, job, research, token usage
├── frontend/           # Next.js 15 (App Router) + Tailwind v4 + PWA
│   └── src/
│       ├── app/        # /, /login, /chat, /memory, /profile, /settings, /projects, /projects/[id]/vibe/[sessionId]
│       ├── components/ # AppShell, ChatPanel, ChatModePicker, ModeSettings, FeatureMenu, UsageMeter, Markdown, ThemeToggle
│       ├── lib/        # API client (cookie session), SSE, konfigurasi mode chat
│       └── middleware.ts # Proteksi rute via cookie sesi
└── scripts/setup-env.ps1 # Turunkan backend/.env + frontend/.env.local dari root .env
```

## Prasyarat

| Layanan | Kegunaan | Keterangan |
|---|---|---|
| [Supabase](https://supabase.com) | Database + pgvector | Project baru, jalankan semua migration berurutan |
| [Groq](https://console.groq.com) | LLM inference (chat + ekstraksi) | API key |
| Hugging Face (opsional) | Embedding untuk pencarian semantik | Tanpa ini → keyword search |
| Node.js ≥ 20 + Python ≥ 3.11 | Runtime | — |

## Setup

### 1. Database (Supabase)

Migration sudah dalam format Supabase CLI. Dua cara:

**A. Lewat CLI (butuh database password):**

```bash
npx supabase db push --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" --include-all
```

Atau urut pakai file di `supabase/migrations/`:

1. `20260101000001_init.sql` — tabel `profiles`, `conversations`, `messages`, `memories`, `memory_embeddings` (extension `vector`).
2. `20260101000002_rls.sql` — Row Level Security per user.
3. `20260101000003_functions.sql` — RPC `match_memories_semantic` & `search_memories_keyword`.
4. `20260101000004_single_user.sql` — lepas FK ke `auth.users`, owner tunggal `00000000-0000-0000-0000-000000000001`, hapus policy per-user (anon ditolak, service role diizinkan).
5. `20260101000005_retrieval_single_user.sql` — RPC retrieval tanpa filter `auth.uid()` (service role tidak punya klaim user), grant ke `service_role`.
6. `20260101000006_chat_modes_documents.sql` — kolom `conversations.mode` (`general`/`curhat`/`brainstorming`/`document`) + tabel `chat_documents` untuk teks lampiran.
7. `20260101000007_token_usage.sql` — tabel `token_usage_events` (satu baris per panggilan LLM) + RPC `get_token_usage` untuk agregat TPM & harian.
8. `20260101000008`–`20260101000018` — proyek, index kode repo, task/ask, dokumen proyek, riset, lamaran kerja, crawl usage.
9. `20260101000019_vibe_workspace.sql` — **Vibe Coding**: `vibe_sessions`, `vibe_messages`, `vibe_decisions`, `vibe_artifacts`, `vibe_artifact_versions`, plus kolom rencana/verifikasi pada `project_tasks` (forward-only, nullable/defaulted sehingga papan tugas lama tetap berjalan).
10. `20260101000022_feature_skills.sql` — tabel `skills` awal (per-fitur).
11. `20260101000023_skill_system.sql` — **Sistem Skills terstruktur**: rename `instruction`→`content`, tambah metadata (`slug`, `category`, `version`, `source`, `license`, `status`), tabel relasi `feature_skills` (many-to-many), backfill slug + pindahkan assignment lama, index/constraint/RLS/grant.
12. `20260101000024_job_profile_links.sql` — **Cari Kerja**: kolom `linkedin_url`, `portfolio_url`, `portfolio_content`, `linkedin_content`, `links_updated_at` pada `job_cv`.

**B. Lewat Dashboard → SQL Editor:** paste seluruh file di `supabase/migrations/` sesuai urutan nama.

> Penting: nama extension di Supabase adalah `vector` (bukan `pgvector`), dan fungsi similarity memakai `search_path = public, extensions`.

### 2. Backend

```bash
cd backend
cp .env.example .env      # isi SUPABASE_*, GROQ_API_KEY
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # (Windows)
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Verifikasi: `curl http://localhost:8000/api/health`

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # isi NEXT_PUBLIC_*
npm install
npm run dev                  # http://localhost:3000
```

### 4. Environment variables lengkap

| Variable | Di mana | Fungsi |
|---|---|---|
| `SUPABASE_URL` | backend | Supabase project URL |
| `SUPABASE_ANON_KEY` | backend | Kunci anon (tidak dipakai browser lagi) |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Akses penuh; satu-satunya jalur data (jangan pernah ke browser) |
| `APP_PASSWORD` | backend | Satu kata sandi login (dibuat otomatis oleh `scripts/setup-env.ps1` bila kosong) |
| `SESSION_SECRET` | backend | Menandatangani cookie sesi (dibuat otomatis bila kosong) |
| `OWNER_USER_ID` | backend | UUID owner tetap (default `00000000-0000-0000-0000-000000000001`) |
| `SESSION_TTL_HOURS` | backend | Umur sesi cookie (default 720 = 30 hari) |
| `GROQ_API_KEY` | backend | Inference |
| `GROQ_CHAT_MODELS` | backend | Daftar model fallback (koma). Default: `openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `EMBEDDING_PROVIDER` | backend | `none` \| `huggingface` |
| `EMBEDDING_DIM` | backend | Harus = dimensi kolom (default 384) |
| `MEMORY_RETRIEVAL_COUNT` | backend | Jumlah memori yang diambil per jawaban |
| `RATE_LIMIT_PER_MINUTE` | backend | Guardrail tulis/LLM per user (default 30) |
| `READ_RATE_LIMIT_PER_MINUTE` | backend | Guardrail baca (sidebar/riwayat/dokumen) per user (default 300) |
| `MAX_UPLOAD_BYTES` | backend | Batas ukuran file lampiran (default 10485760 = 10 MB) |
| `MAX_DOCUMENT_CHARS` | backend | Batas total karakter dokumen yang disuntik ke prompt (default 12000) |
| `RESEARCH_MAX_CHARS` | backend | Batas total karakter sumber web yang disuntik ke prompt (default 12000) |
| `RESEARCH_MAX_SOURCES` | backend | Maks sumber web per percakapan (default 5) |
| `RESEARCH_SEARCH_LIMIT` | backend | Jumlah hasil per pencarian web Firecrawl (default 5, maks 10) |
| `RESEARCH_FETCH_TIMEOUT` | backend | Timeout crawl per halaman, detik (default 15) |
| `RESEARCH_MAX_BYTES` | backend | Batas byte HTML yang dibaca per halaman (default 2097152 = 2 MB) |
| `SKILL_MAX_CHARS` | backend | Batas karakter konten satu skill yang disuntik ke prompt (default 6000) |
| `SKILLS_MAX_TOTAL_CHARS` | backend | Batas total karakter seluruh skill aktif per prompt (default 12000) |
| `SKILLS_MAX_PER_FEATURE` | backend | Maksimum skill aktif yang dimuat per fitur (default 6) |
| `CRAWL_PROVIDER` | backend | Provider crawl default: `httpx` (bawaan) atau `firecrawl` (default `httpx`) |
| `FIRECRAWL_API_KEY` | backend | Kunci Firecrawl (hanya di server; kosong = Firecrawl nonaktif untuk cloud) |
| `FIRECRAWL_BASE_URL` | backend | Base URL Firecrawl (default `https://api.firecrawl.dev`; isi URL self-host bila perlu) |
| `FIRECRAWL_ALLOW_EMPTY_KEY` | backend | `true` hanya untuk self-host tanpa auth; cloud wajib berisi key (default `false`) |
| `FIRECRAWL_TIMEOUT_MS` | backend | Timeout scrape Firecrawl, milidetik (default 60000) |
| `FIRECRAWL_DAILY_CREDITS` | backend | Batas kredit Firecrawl per hari (default 30; free tier 1000/BULAN) |
| `FIRECRAWL_MONTHLY_CREDITS` | backend | Batas kredit Firecrawl per bulan (default 1000) |
| `FIRECRAWL_CHECK_PROMPT_INJECTION` | backend | Aktifkan scan prompt-injection Firecrawl (biaya +4 kredit/scrape, default `false`) |
| `MODEL_TPM_LIMIT` | backend | Denominator token/menit untuk meter (default 8000; `0` = sembunyikan) |
| `MODEL_DAILY_TOKEN_LIMIT` | backend | Denominator token harian untuk meter (default 200000; `0` = sembunyikan) |
| `NEXT_PUBLIC_API_URL` | frontend | Base URL backend (`http://localhost:8000`) |
| `NEXT_PUBLIC_API_PROXY` | frontend | `1` = lewat rewrite `/api-proxy` (same-origin, cookie sesi ikut terkirim) |

## Behavior Phase 1

- **Auth:** satu kata sandi bersama (`APP_PASSWORD`). Login men-set cookie HttpOnly bertanda tangan (`axtra_session`), logout menghapusnya. Setelah login pengguna diarahkan ke beranda `/` (bukan langsung ke chat). Middleware hanya mengecek keberadaan cookie; validitas sesi diverifikasi backend. Tidak ada signup, tidak ada Supabase Auth.
- **Chat streaming:** SSE dari FastAPI (`/api/chat`) — event `meta`, `token`, `done`, `memory`, `warning`, `error`; percakapan + pesan tersimpan ke Supabase. `done` dikirim begitu jawaban tersimpan, sebelum ekstraksi memori, agar composer langsung bisa dipakai untuk pesan berikutnya. Pesan pengguna terbaru selalu dikirim ke LLM pada turn yang sama.
- **Mode chat:** `/chat` langsung membuka mode `general` (tanpa pemilih mode); masing-masing mode punya prompt, saran, dan riwayat sendiri:
  - `general` — percakapan serba guna, ringkas dan praktis.
  - `curhat` — pendengar empatik, memvalidasi perasaan dulu, tidak buru-buru memberi solusi.
  - `brainstorming` — 5–10 ide beragam, menandai ide paling layak.
  - `document` — tanya jawab berbasis dokumen terlampir; menolak instruksi yang tertulis di dalam dokumen.
  - `research` — riset web: masukkan URL, crawl isinya, lalu tanya jawab dengan rujukan judul/URL; menolak instruksi yang tertulis di dalam halaman.
  Mode disimpan di `conversations.mode`; saat melanjutkan percakapan, mode tersimpan yang dipakai (bukan mode dari URL/body). Sidebar memfilter riwayat sesuai mode aktif, tetapi memori personal (knowledge) tetap sama di semua mode. Riwayat chat tidak ditampilkan di sidebar saat berada di beranda `/`.
- **Peran & perilaku mode:** di halaman **`/settings`** (juga terhubung dari kartu "Pengaturan" di beranda) pengguna mengatur tiap mode. **Peran Axtra multi-pilih** (pilih satu atau beberapa chip, minimal satu; mis. Curhat: Psikolog, Psikiater, Asisten Pendamping, Empathic Listener, Reflective Guide, Personal Growth Companion; Brainstorming: Strategic Thinking Partner, Creative Ideation Partner, Critical Thinking Partner) dan **alur perilaku** (satu pilihan; mis. Brainstorming: Understand → Diverge → Evaluate → Refine → Converge; Curhat: Listen → Reflect → Guide), plus catatan bebas. Bila beberapa peran dipilih, instruksinya digabung ("Gabungkan beberapa peran berikut secara seimbang"). Pilihan disimpan di `profiles.preferences.chat_modes` lewat `GET/PUT /api/chat-settings` (format lama `role` string tetap dibaca sebagai fallback) dan disuntik ke system prompt pada balasan berikutnya. Di halaman yang sama ada **Provider crawl** (parser bawaan vs Firecrawl) yang disimpan di `profiles.preferences.crawl`. Di beranda, sidebar tidak menampilkan mode maupun riwayat chat.
- **Skills terstruktur (halaman `/settings`):** Skill adalah entitas terpisah berisi konten Markdown (instruksi praktis) + metadata (`slug`, `name`, `description`, `category`, `version`, `source`, `license`, `status`) di tabel `skills`, dan dipakai lewat relasi many-to-many `feature_skills`. Satu skill bisa di-assign ke banyak fitur; satu fitur bisa punya banyak skill. Dua cara input: **manual** atau **tempel `SKILL.md`** (frontmatter YAML subset + body Markdown; parser tanpa dependency baru, error menyebut nomor baris). Hanya skill berstatus `active` **dan** ter-assign yang dimuat ke prompt; `draft` tidak bisa di-assign, `disabled` tidak dimuat. Runtime memuat skill aktif lewat satu jalur `feature_persona.load_feature_persona`, dedupe per `id`, urut `position`, dengan cap `SKILL_MAX_CHARS` per-skill, `SKILLS_MAX_TOTAL_CHARS` total, dan `SKILLS_MAX_PER_FEATURE` jumlah. Blok skill disisipkan satu system message dengan urutan GLOBAL → ROLE → SKILL AKTIF → INSTRUCTION → KONTEKS. Konten skill hanya teks dan **tidak pernah dieksekusi**. Field teks `skills` lama tetap dibaca sebagai fallback bila sebuah fitur belum punya assignment DB. Endpoint: `GET/POST /api/skills`, `GET/PATCH/DELETE /api/skills/{id}`, `POST /api/skills/parse`; assignment lewat `PUT /api/feature-settings/{feature}` (`skill_ids`) dan `GET /api/feature-settings` (mengembalikan `skills`, `assignments`, `skill_counts`).
- **Slash command:** hanya aktif di mode terkait. Ketik `/` di composer untuk membuka palet (navigasi ↑/↓, Enter memilih, Esc menutup); command terpilih tampil sebagai chip dan dikirim sebagai field `command`, lalu instruksinya ditambahkan ke system prompt hanya untuk turn itu (tersimpan di `messages.metadata.command`).
  - `curhat`: `/curhat`, `/listen`, `/reflect`, `/perspective`, `/advice`, `/journal`
  - `brainstorming`: `/brainstorm`, `/challenge`, `/evaluate`, `/refine`, `/plan`, `/decide`
  - `research`: `/crawl`, `/summarize`, `/compare`, `/keypoints`, `/cite`, `/extract`
- **Riset Web (mode Research):** composer punya dua input — **Cari di web** (Firecrawl `/v2/search`) dan **Crawl URL**. Pencarian web mengembalikan beberapa hasil sekaligus (judul, URL, markdown/snippet) dan menyimpannya sebagai `research_sources`; crawl mengambil satu halaman lewat provider crawl. Keduanya menyimpan teks (bukan HTML mentah) terikat pada satu percakapan. Isinya disuntik ke prompt (dipotong `RESEARCH_MAX_CHARS`). Jika URL yang sama sudah ada di percakapan itu, sumber tidak diduplikasi (cache per percakapan, tidak lintas user). Endpoint: `POST /api/research/search` (body `{query, limit?, conversation_id?}`, hanya aktif bila `firecrawl_ready`), `POST /api/research/crawl`, `GET /api/research/sources?conversation_id=`, `DELETE /api/research/sources/{id}`. Batas: `RESEARCH_MAX_SOURCES` (default 5, berlaku untuk gabungan search + crawl), `RESEARCH_SEARCH_LIMIT` (default 5 hasil per query, maks 10), `RESEARCH_FETCH_TIMEOUT` (default 15 dtk, untuk parser bawaan), `RESEARCH_MAX_BYTES` (default 2 MB, parser bawaan).
- **Pencarian web (Riset Web):** memakai Firecrawl `/v2/search` dengan `sources:["web"]` dan `scrapeOptions` markdown, jadi tiap hasil langsung membawa isi halaman. Search **tidak punya fallback** ke parser bawaan (httpx hanya bisa fetch URL yang sudah diketahui). Kredit search + scrape dicatat di `crawl_usage_events` dengan `url` berawalan `search:` dan tetap dibatasi `FIRECRAWL_DAILY_CREDITS`/`FIRECRAWL_MONTHLY_CREDITS`. `limit` otomatis dipotong oleh sisa `RESEARCH_MAX_SOURCES`.
- **Provider crawl (Riset Web + crawl lowongan):** dua opsi yang bisa diganti per user di `/settings`:
  - **Parser bawaan (`httpx`)** — default; gratis, privat, mengekstrak teks dengan parser standard library, tanpa dependensi eksternal.
  - **Firecrawl (`firecrawl`)** — opt-in; `POST /v2/scrape` dengan `formats:["markdown"]`, `onlyMainContent:true`, `storeInCache:false`. Output berupa **markdown**, lebih baik untuk halaman berat JavaScript. Kunci API hanya disimpan di env server (`FIRECRAWL_API_KEY`); preferensi user hanya menyimpan **nama** provider di `profiles.preferences.crawl`. `PUT /api/chat-settings/crawl`; status efektif ada di `GET /api/chat-settings` (`crawl`).
  - **Fallback otomatis:** bila Firecrawl kena kredit habis (`402`), rate limit (`429`), timeout, atau error jaringan, crawl dialihkan ke parser bawaan dengan catatan singkat di hasil. Kunci tidak valid (`401/403`) ditampilkan sebagai pesan jelas tanpa fallback. Kredit Firecrawl dicatat di `crawl_usage_events` (sukses **dan** gagal) dan dibatasi `FIRECRAWL_DAILY_CREDITS`/`FIRECRAWL_MONTHLY_CREDITS`.
  - **Self-host Firecrawl:** isi `FIRECRAWL_BASE_URL` ke instance lokal dan, hanya bila instance benar-benar tanpa auth, set `FIRECRAWL_ALLOW_EMPTY_KEY=true`. **Penting:** jalankan container Firecrawl tanpa akses ke jaringan internal Axtra (Supabase, backend). Firecrawl harus bisa keluar ke internet publik tetapi tidak boleh menjangkau `SUPABASE_URL`, backend, atau alamat privat/lokal — batasi lewat network policy/firewall agar URL yang di-crawl tidak bisa memaksa Firecrawl mengakses layanan internal.
- **Lampiran dokumen (mode Document):** unggah TXT, MD, atau PDF (maks 10 MB, maks 10 dokumen per percakapan). Server menyimpan teks hasil ekstraksi di `chat_documents` (bukan file biner); isinya disuntik ke prompt sistem (dipotong `MAX_DOCUMENT_CHARS`). Dokumen terikat pada satu percakapan dan bisa dihapus kapan saja.
- **Waktu respons:** penghitung naik saat balasan mengalir, lalu diganti label `Dimuat dalam X,X dtk` dari `done.elapsed_ms`.
- **Pemakaian token:** tiap panggilan LLM (jawaban chat **dan** ekstraksi memori) mencatat token ke `token_usage_events`. Meter di navbar menampilkan token/menit (jendela bergulir 60 detik), dan panel di sidebar menampilkan token/menit + total harian dengan bilah progres. Total harian di-reset otomatis pukul 00:00 WIB (`Asia/Jakarta`). Endpoint `GET /api/usage` (bucket baca) mengembalikan nilai mentah; frontend polling tiap 15 detik dan memuat ulang tiap turn selesai lewat event `axtra:usage-changed`. `MODEL_TPM_LIMIT`/`MODEL_DAILY_TOKEN_LIMIT` jadi penyebut (set `0` untuk menyembunyikan persentase).
- **Opsi jawaban interaktif:** jika permintaan ambigu, model mengakhiri balasan dengan blok ```` ```options ```` (JSON 2–4 opsi). Backend memisahkannya (tidak disimpan di konten, disimpan di `messages.metadata.options`), mengirimnya di `done.options`, dan frontend menampilkannya sebagai tombol yang mengirim opsi terpilih sebagai pesan berikutnya.
- **Beranda:** `/` menampilkan menu semua fitur PRD (Chat — dengan sub-mode General, Curhat, Brainstorming, Document, Riset Web —, Memori, Profil, **Proyek**, **Cari Kerja** aktif; PRD dan Generated Image dengan label fase). Bisa dibuka lewat logo atau menu Beranda di sidebar.
- **Memori personal:**
  - Otomatis: dipicu setelah tiap jawaban, LLM mengekstrak fakta layak-ingat lalu disimpan dengan `source=chat` + `confidence`.
  - Manual: tambah/koreksi/hapus dari halaman `/memory`.
  - Retrieval: `match_memories_semantic` (pgvector) jika embedding tersedia, fallback `search_memories_keyword` (full-text).
  - Rangkum topik serupa: di `/memory`, `GET /api/memories/clusters` mengelompokkan memori aktif bertopik sama (cluster kemiripan pgvector jika embedding tersedia, fallback pengelompokan LLM). `POST /api/memories/merge` merangkum memori terpilih jadi satu via LLM lalu **hard-delete** memori asal. Bisa otomatis per grup atau pilih manual (multi-checkbox).
- **Profil:** identitas dasar (nama, zona waktu, gaya komunikasi) yang diberikan ke prompt sistem.
- **Proyek (`/projects`):** daftar proyek dengan status (ide/aktif/jeda/selesai), deskripsi, tech stack, URL repo, dan catatan/keputusan teknis. Bisa ditambah **manual saja**; memori bertipe `project` dari percakapan tidak lagi membuat proyek baru, hanya menempelkan catatan ke proyek yang sudah ada (dicocokkan berdasarkan nama, atau ke proyek yang di-@mention di chat). Tata letak memakai lebar penuh: strip statistik (total/aktif/siap dianalisa/perlu perhatian) + grid kartu dua kolom. Untuk analisa repo GitHub: tombol **Index repo** menarik seluruh file repo publik via GitHub API (dipotong per-chunk, opsional di-embed). Progres indeks tampil sebagai progress bar + persentase (status `pending`/`indexing`, kolom `repo_index_progress`/`repo_index_stage`); daftar proyek di-polling senyap sehingga tidak reload/suspend saat indeks berjalan.
- **Detail proyek (`/projects/[id]`):** halaman analisa per proyek dengan layout dua kolom (konten utama + sidebar kanan). Sidebar kanan berisi **Tanya repo** (RAG dengan sumber file yang bisa diklik) dan **riwayat pertanyaan tersimpan** di tabel `project_asks` — bertahan setelah reload, bisa dihapus per item atau dibersihkan. Panel tanya punya tombol **Perbesar/Kecilkan** yang menyembunyikan kolom detail sehingga chat memakai lebar penuh. Tiap bagian di kolom utama (Kesehatan, Tugas, Analisa repo, File ter-index) bisa dilipat (collapse) lewat judulnya. Kolom utama: overview & edit metadata, **Kesehatan proyek** (analisa AI: ringkasan, kekuatan, risiko, langkah berikutnya; disimpan di `projects.health_summary`/`health_generated_at`, bisa diperbarui), **Tugas** (papan Kanban per proyek di tabel `project_tasks`: kolom Todo/Doing/Selesai, kartu bisa ditarik antar kolom dan diurutkan ulang — status + `position` disimpan lewat endpoint reorder; prioritas low/medium/high), **Chat terkait** (daftar thread chat yang merujuk proyek ini), ringkasan analisa repo (Markdown + progress), dan **File explorer** (daftar file ter-index + isi chunk). Endpoint pendukung: `GET/PATCH/DELETE /api/projects/{id}`, `POST /api/projects/{id}/repo/index`, `POST /api/projects/{id}/repo/ask`, `GET/DELETE /api/projects/{id}/asks`, `POST /api/projects/{id}/health`, `GET/POST /api/projects/{id}/tasks`, `PATCH/DELETE /api/projects/{id}/tasks/{task_id}`, `POST /api/projects/{id}/tasks/reorder`, `GET /api/projects/{id}/conversations`, `GET /api/projects/{id}/files`, `GET /api/projects/{id}/files/content?path=`, `DELETE /api/projects/{id}/repo`.

- **Vibe Coding (`/projects/[id]/vibe`):** alur kerja ide → discovery → spesifikasi → rencana → handoff → verifikasi, terhubung ke proyek yang sudah ada. Satu proyek bisa punya banyak workspace/ide. Halaman daftar membuat workspace dari ide mentah (ide, masalah, target pengguna, kendala — semua opsional kecuali minimal satu). Halaman workspace punya empat tab:
  - **Discovery** — percakapan persisten. Tiap balasan model divalidasi sebagai JSON (`reply`, maks. 3 pertanyaan dengan opsi/rekomendasi, keputusan/asumsi). Keputusan disimpan terpisah dengan status `CONFIRMED`/`ASSUMED`/`RESEARCH`/`NEEDS_DECISION`/`VALIDATION_REQUIRED`; pengguna bisa menambah, mengubah status, atau menghapus. Mengubah status keputusan menandai dokumen approved/review menjadi `STALE`.
  - **Dokumen** — tujuh artefak: `PRD`, `ARCHITECTURE`, `ACCEPTANCE_TEST_PLAN`, `UI_UX_SPEC`, `AGENT_INSTRUCTIONS`, `IMPLEMENTATION_PLAN`, `DEFINITION_OF_DONE`. Generate dari konteks proyek + discovery + keputusan; pratinjau Markdown atau edit; simpan selalu membuat versi baru. Regenerate/edit dokumen `APPROVED` tidak menimpa diam-diam: versi baru berstatus `NEEDS_REVIEW`, versi approved tetap di riwayat. Aksi Approve dan tandai Stale tersedia.
  - **Rencana** — generate task dari spesifikasi yang tersedia (tidak wajib lengkap) dan masukkan ke `project_tasks` yang sama (`source='vibe'`) dengan key, goal, scope, modul, dependencies, acceptance criteria, testing, prioritas, dan metadata verifikasi. Tombol **Buat prompt** menyusun prompt salin-untuk coding agent dari task + artefak approved (fallback draft), berisi konteks proyek, requirement, security boundaries, dan format laporan penyelesaian. Axtra tidak menjalankan kode atau mengubah repo.
  - **Verifikasi** — status `TODO`/`IN_PROGRESS`/`BLOCKED`/`NEEDS_REVIEW`/`DONE` + bukti (output test/log) + catatan kendala. `DONE` ditolak tanpa bukti. Status task board mengikuti (doing/done) agar tetap terlihat di halaman proyek.
  Data disimpan di `vibe_sessions`, `vibe_messages`, `vibe_decisions`, `vibe_artifacts`, `vibe_artifact_versions`, plus kolom tambahan `project_tasks`. Semua endpoint berada di bawah `/api/projects/{project_id}/vibe` dan memakai session cookie + pemeriksaan kepemilikan proyek yang sama. Endpoint utama: `GET/POST /sessions`, `GET/PATCH/DELETE /sessions/{id}`, `GET/POST /sessions/{id}/messages`, `GET/POST/PATCH/DELETE /sessions/{id}/decisions`, `GET /sessions/{id}/artifacts`, `POST /sessions/{id}/artifacts/{kind}/generate`, `PUT /sessions/{id}/artifacts/{kind}`, `POST .../approve`, `POST .../stale`, `GET .../versions`, `GET /sessions/{id}/tasks`, `POST /sessions/{id}/tasks/generate`, `POST /sessions/{id}/tasks/{task_id}/prompt`, `PATCH /sessions/{id}/tasks/{task_id}/verification`.
- **Cari Kerja (`/jobs`):** tracker lamaran kerja. Tanggal dibuat bisa diisi manual (default hari ini) dan deadline opsional (boleh dikosongkan). Daftar kartu + statistik (total, sedang diproses, interview, offer) dengan pencarian dan filter status (`draf`, `dilamar`, `screening`, `interview`, `offer`, `ditolak`, `ditarik`). Satu CV aktif per owner (`job_cv`) diunggah dari panel CV (TXT, MD, atau PDF; teks diekstrak, bukan file biner) dan dipakai untuk semua analisa. **Profil kandidat** menyimpan link LinkedIn + portfolio (owner-level, satu baris `job_cv`): portfolio bisa ditarik otomatis isinya (provider crawl, disimpan di `portfolio_content`), sedangkan LinkedIn tidak bisa di-crawl sehingga ringkasan teksnya bisa ditempel manual. **Analisa** punya pilihan sumber multiple-choice — CV, Portfolio, LinkedIn — dikirim sebagai `sources: ["cv","portfolio","linkedin"]`; hanya sumber terpilih yang masuk prompt, dan minimal satu harus tersedia. Detail lamaran (`/jobs/[id]`) memakai layout dua kolom: skor **match** dan **peluang berhasil** (0–100, estimasi AI), **deskripsi lowongan** (crawl URL rekrutmen via `web_crawler` atau isi manual), **prediksi jobdesk** + analisa kecocokan/peluang dalam Markdown, editor **cover letter** (generate AI, bisa diedit, salin, simpan; memakai CV), dan editor detail lamaran. Sidebar berisi CV, Profil kandidat (LinkedIn/portfolio), aksi cepat (crawl ulang, analisa, generate cover letter), dan info. Tabel `job_applications` + `job_cv` (migration `20260101000016_job_applications.sql`, `20260101000024_job_profile_links.sql`). Endpoint: `GET/POST /api/jobs`, `GET/PATCH/DELETE /api/jobs/{id}`, `POST /api/jobs/{id}/crawl`, `POST /api/jobs/{id}/analyze` (body `sources`), `POST /api/jobs/{id}/cover-letter`, `GET/POST/DELETE /api/jobs/cv`, `PUT /api/jobs/cv/links`, `POST /api/jobs/cv/portfolio/crawl`.
- **Chat ↔ Proyek & Lamaran (@mention):** di kotak chat, ketik `@` untuk memilih proyek atau lamaran kerja (Cari Kerja). Konteks proyek terpilih (deskripsi, catatan, ringkasan repo, ringkasan AI, tugas terbuka) disuntikkan ke prompt sebagai data, sehingga jawaban bisa merujuk langsung ke proyek; rujukan tersimpan di `messages.metadata.project_refs`, dan thread ditautkan ke proyek lewat tabel `project_conversations` sehingga muncul di bagian **Chat terkait** pada halaman detail proyek. Lamaran yang dirujuk juga membawa konteksnya (posisi, perusahaan, status, skor match/peluang, prediksi jobdesk, analisa, deskripsi lowongan, cover letter) dan disimpan di `messages.metadata.job_refs`.

- **Data proyek (non-repo):** selain repo, tiap proyek bisa punya data bebas di luar kode lewat tabel `project_documents` — catatan/teks yang ditempel (spesifikasi, notulen, keputusan) atau unggahan `.txt`/`.md`, serta tautan penting (`kind` `note`/`link`). Kelola di bagian **Data proyek (non-repo)** pada halaman detail (tambah/edit/hapus). Data ini diikutkan ke ringkasan AI dan ke konteks `@mention` di chat, jadi AI tahu hal-hal di luar repo. Endpoint: `GET/POST /api/projects/{id}/documents`, `PATCH/DELETE /api/projects/{id}/documents/{doc_id}`.

- **Ringkasan AI otomatis:** setiap perubahan data proyek (edit metadata, tambah/ubah/hapus tugas, tambah/ubah/hapus data non-repo, selesai index repo, hapus repo) menandai `projects.health_stale = true` lalu menjadwalkan regenerasi ringkasan di background setelah jeda singkat (`PROJECT_HEALTH_DEBOUNCE_SECONDS`, default 12 dtk) sehingga rentetan perubahan hanya memicu satu panggilan LLM. Halaman detail menampilkan badge "memperbarui ringkasan..." dan polling sampai ringkasan baru tersimpan. Tombol **Analisa/Perbarui** tetap tersedia untuk regenerasi manual. Setel `PROJECT_HEALTH_AUTO_REFRESH=false` untuk mematikan refresh otomatis. Retrieval memakai `match_code_chunks_semantic` (bila embedding aktif) atau `search_code_chunks_keyword` yang mencocokkan token pertanyaan dengan OR + fallback substring, sehingga pertanyaan bahasa alami tetap menemukan chunk walaupun kode repo berbahasa Inggris. Batas file/ukuran/chunk via `REPO_INDEX_*`; `GITHUB_TOKEN` opsional untuk repo privat atau rate limit lebih tinggi.
- **Design system:** mengikuti `Design.md` — black-first (light mode opsional), palet netral tanpa aksen/glow/shadow dekoratif, token CSS terpusat, system font, ikon Lucide, sidebar 224px collapsible + drawer mobile, markdown + copy kode, tombol stop streaming, empty state 4 prompt, reduced-motion, focus-visible, dan label ARIA.
- **Keamanan:** semua query lewat service-role client backend; RLS aktif tanpa policy (anon ditolak); cookie HttpOnly + SameSite=Lax, `Secure` saat production; rate limit chat/tulis per owner dan rate limit login per IP; error tidak leaking detail internal.
  - Rate limit baca (sidebar, riwayat, daftar dokumen, profil, memori) punya kuota terpisah dan jauh lebih besar, jadi menjelajah riwayat tidak memakan kuota chat.
  - Catatan: siapa pun yang tahu `APP_PASSWORD` bisa mengakses seluruh data. Gunakan kata sandi kuat dan jangan bagikan.
- **PWA:** manifest + service worker shell; siap untuk push notification Phase 4.
- **Free-tier:** model fallback Groq; embedding provider opsional; rate limit diaktifkan.

## Verifikasi End-to-End

Setelah backend berjalan di port 8000 dan `.env` terisi:

```bash
cd backend
.venv\Scripts\python scripts\e2e_test.py
```

Script ini: login dengan `APP_PASSWORD` → cek `/api/auth/status` & `/api/profile` → kirim chat (SSE) → verifikasi pesan tersimpan, memori terekstraksi, dan retrieval bekerja → hapus data uji → logout. Semua asersi harus `ALL E2E CHECKS PASSED`.

## Testing dan Pemeriksaan

Backend (unit test memakai Supabase in-memory dan LLM palsu, tanpa jaringan):

```bash
cd backend
.venv\Scripts\python -m pytest -q
```

Frontend:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

Test Vibe Coding ada di `backend/tests/test_vibe_service.py` dan mencakup: pembuatan/persistensi session, riwayat discovery + keputusan, penolakan output model malformed, versi artefak + approval + stale, generasi task tanpa duplikasi key, penyusunan prompt, verifikasi berbasis bukti, kegagalan provider LLM, serta penolakan akses lintas proyek/session.

## MVP limitations Vibe Coding

- Prompt implementasi **disusun deterministik** dari task + artefak (tanpa panggilan LLM tambahan), supaya handoff tidak gagal karena provider.
- Tidak ada eksekusi terminal, pengeditan kode otonom, commit/push, deployment, atau GitHub write. Bukti verifikasi diisi manual oleh pengguna dari coding agent eksternal.
- Discovery dan generate artefak/task memakai provider/model LLM yang sudah dikonfigurasi (`GROQ_*`); tidak ada model, key, atau endpoint baru.
- Tidak ada tabel/UI review kolaboratif multi-user (aplikasi tetap single-owner sesuai model auth saat ini).

Catatan model: Groq mengganti katalog model dari waktu ke waktu. Cek yang aktif dengan `GET https://api.groq.com/openai/v1/models` lalu sesuaikan `GROQ_CHAT_MODELS`.

## Peta per Phase (referensi)

| Phase | Isi | Status |
|---|---|---|
| 1 | Chat + streaming + memori + profil | ✅ selesai |
| 2 | Daily journal, target, proyek | 🟡 proyek + analisa repo selesai; journal/target belum |
| 3 | AI Mentor (skill, laporan) | ⏳ |
| 4 | Automation + Telegram/PWA push | ⏳ |
| 5 | GitHub + PRD | 🟡 Vibe Coding MVP selesai; GitHub read-only belum |
| 6 | Generated Image | ⏳ |
