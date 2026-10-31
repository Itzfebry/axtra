# Axtra

Personal AI agent yang memahami pengguna secara berkelanjutan melalui memori, membantu pengembangan diri, proyek, pencarian kerja, dan produksi visual dalam satu ruang kerja.

> **Status dokumen:** kondisi implementasi per 31 Oktober 2026.
> **Fase aktif:** Phase 1 selesai; Phase 2 dan Phase 5 sebagian besar selesai; Riset Web dan Generated Image sudah berjalan; automation, Telegram/push, journal, target, dan AI Mentor belum.

## Ringkasan fitur saat ini

| Area | Status | Ringkasan |
|---|---|---|
| Chat multi-mode | ✅ | General, Curhat, Brainstorming, Document, Riset Web; SSE, opsi jawaban, stop, tab chat, slash command, `@mention` |
| Memori personal | ✅ | Ekstraksi otomatis, CRUD manual, pencarian semantik/keyword, cluster + merge topik |
| Multi-provider LLM | ✅ | Groq, OpenRouter, OpenAI, Google Gemini, Cloudflare Workers AI, provider custom OpenAI-compatible |
| Pengaturan model | ✅ | Tab **Model teks** dan **Model gambar** terpisah; key user terenkripsi di server |
| Skills terstruktur | ✅ | Skill Markdown + metadata, relasi many-to-many per fitur, import `SKILL.md`, preview |
| Peran & perilaku | ✅ | Persona per mode/fitur, instruksi bebas, provider crawl per user |
| Riset Web | ✅ | Crawl URL, pencarian web Firecrawl, sumber per percakapan, simpan sumber ke memori |
| Proyek | ✅ | Metadata, label, data non-repo, indeks repo GitHub, RAG kode, papan tugas, kesehatan AI, riwayat analisa |
| Vibe Coding | ✅ | Discovery, 7 artefak berversi, keputusan, rencana task, prompt handoff, verifikasi |
| Cari Kerja | ✅ | Tracker lamaran, CV, profil LinkedIn/portfolio, crawl lowongan, match score, cover letter |
| Generated Image | ✅ | Model gambar terpisah, katalog model, referensi gambar, style, rasio/resolusi, streaming, riwayat sesi, kuota harian |
| Beranda orchestrator | ✅ | Perintah bahasa alami untuk membuka tool, mengatur menu, tema, atau menyimpan memori |
| PWA | 🟡 | Manifest + service worker shell; push notification belum |
| Automation / Telegram | ⏳ | Variabel env disiapkan, worker/scheduler belum ada |
| GitHub OAuth read/write | ⏳ | Saat ini hanya indexing repo publik/privat lewat token env |

## Arsitektur

```text
Browser / PWA (Next.js 15)
        │  cookie sesi HttpOnly
        ▼
FastAPI (Python) ── SSE streaming
        │
        ├── Supabase Postgres + pgvector (service role)
        ├── LLM provider OpenAI-compatible (pilihan user)
        ├── Firecrawl / parser httpx
        ├── GitHub API + raw.githubusercontent.com
        └── Image API provider (OpenRouter-style / Cloudflare Workers AI)
```

Prinsip utama:

- **Single-owner:** satu kata sandi aplikasi, satu `OWNER_USER_ID`, tanpa Supabase Auth di browser.
- **Service role hanya di backend:** browser tidak pernah memegang service key.
- **Provider-agnostic:** chat memakai bentuk OpenAI-compatible; model teks dan model gambar disimpan sebagai preferensi terpisah.
- **Prompt terstruktur:** urutan `GLOBAL → ROLE → SKILL AKTIF → INSTRUCTION → KONTEKS`.
- **Konten eksternal adalah data:** isi web, dokumen, repo, dan skill tidak pernah dieksekusi sebagai instruksi sistem.

## Struktur repository

```text
axtra/
├── README.md
├── PRD.md
├── Design.md
├── .env.example
├── scripts/
│   ├── setup-env.ps1          # turunkan backend/.env + frontend/.env.local dari root .env
│   ├── migrate.ps1            # migrasi via psql / Supabase DB URL
│   └── migrate_api.py         # migrasi via Supabase Management API
├── supabase/migrations/       # 28 migration berurutan
├── backend/
│   ├── requirements.txt
│   ├── tests/                 # 13 file test
│   └── app/
│       ├── main.py            # FastAPI, CORS, gzip selektif, error handler
│       ├── config.py          # environment variables
│       ├── deps.py            # cookie auth, rate limit, owner scoping
│       ├── chat_modes.py      # preset persona + slash command
│       ├── provider_catalog.py# katalog provider bawaan
│       ├── llm.py             # adapter OpenAI-compatible + SSE
│       ├── prompts.py         # system prompt + ekstraksi memori
│       ├── routers/           # auth, chat, profile, memories, skills, projects, jobs, research, images, dll.
│       └── services/          # memory, projects, vibe, jobs, image, crawl, usage, provider, skill
└── frontend/
    ├── src/app/               # /, /login, /chat, /memory, /profile, /settings, /projects, /jobs, /images, /vibe
    ├── src/components/        # shell, chat, jobs, proyek, settings, skill, UI
    ├── src/lib/               # API client, SSE, chat modes, menu config, metadata
    ├── public/                # manifest, service worker, ikon
    └── src/middleware.ts      # proteksi rute via cookie sesi
```

## Prasyarat

| Layanan | Wajib | Kegunaan |
|---|---|---|
| Supabase | Ya | Postgres + pgvector + RPC |
| LLM provider | Ya, salah satu | Groq, OpenRouter, OpenAI, Gemini, Cloudflare, atau endpoint custom |
| Node.js ≥ 20 | Ya | Frontend Next.js |
| Python ≥ 3.11 | Ya | Backend FastAPI |
| Firecrawl | Opsional | Pencarian web dan crawl halaman berat JavaScript |
| Hugging Face | Opsional | Embedding semantik; tanpa ini memori memakai keyword search |
| GitHub token | Opsional | Repo privat dan rate limit lebih tinggi |
| Image provider | Opsional | OpenRouter/Cloudflare untuk halaman Generated Image |

## Setup

### 1. Environment

```bash
cp .env.example .env
```

Isi minimal:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `APP_PASSWORD`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`
- salah satu kunci provider, mis. `GROQ_API_KEY`
- `NEXT_PUBLIC_API_URL=http://localhost:8000`

Di Windows, `scripts/setup-env.ps1` dapat membuat `APP_PASSWORD`, `SESSION_SECRET`, dan `APP_ENCRYPTION_KEY` yang kosong lalu menurunkan nilai ke `backend/.env` dan `frontend/.env.local`.

### 2. Database

Jalankan seluruh file di `supabase/migrations/` sesuai urutan nama.

**A. Supabase CLI / psql**

```bash
npx supabase db push --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" --include-all
```

atau:

```powershell
powershell -File scripts/migrate.ps1
```

**B. Management API**

```bash
python scripts/migrate_api.py
```

**C. Dashboard → SQL Editor**

Paste setiap file migration sesuai urutan.

Catatan:

- Nama extension di Supabase adalah `vector`, bukan `pgvector`.
- Fungsi retrieval memakai `search_path = public, extensions`.
- RLS aktif tanpa policy per-user; hanya service role backend yang dapat membaca/menulis.
- Migration bersifat forward-only. Beberapa migration mengubah constraint dan melakukan backfill data.

### 3. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Linux/macOS:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Verifikasi:

```bash
curl http://localhost:8000/api/health
```

Dokumentasi OpenAPI tersedia di `/docs` saat `APP_ENV` bukan `production`.

### 4. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Buka `http://localhost:3000`.

Jika `NEXT_PUBLIC_API_PROXY=1`, browser memanggil backend lewat rewrite `/api-proxy` pada origin yang sama sehingga cookie sesi `SameSite=Lax` ikut terkirim.

## Environment variables

### Aplikasi dan auth

| Variable | Default | Fungsi |
|---|---|---|
| `APP_ENV` | `development` | `production` mematikan `/docs` dan mengaktifkan cookie `Secure` |
| `APP_NAME` | `Axtra API` | Judul OpenAPI |
| `CORS_ORIGINS` | `http://localhost:3000` | Origin frontend yang diizinkan |
| `APP_PASSWORD` | — | Satu kata sandi login |
| `SESSION_SECRET` | — | Menandatangani cookie sesi |
| `OWNER_USER_ID` | `00000000-0000-0000-0000-000000000001` | UUID owner tunggal |
| `SESSION_TTL_HOURS` | `720` | Umur cookie sesi |

### Supabase dan migrasi

| Variable | Fungsi |
|---|---|
| `SUPABASE_URL` | URL project |
| `SUPABASE_ANON_KEY` | Kunci anon; tidak dipakai browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Akses data backend; jangan pernah ke browser |
| `SUPABASE_PROJECT_REF` | Project ref untuk Management API |
| `SUPABASE_DB_URL` | Connection string untuk `migrate.ps1` |
| `SUPABASE_ACCESS_TOKEN` | Token untuk `migrate_api.py` |

### LLM multi-provider

| Variable | Default | Fungsi |
|---|---|---|
| `LLM_PROVIDER` | `groq` | Provider default bila preferensi user kosong |
| `LLM_MODEL` | kosong | Model default opsional |
| `GROQ_API_KEY` | — | Kunci Groq |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Base URL Groq |
| `GROQ_CHAT_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b` | Daftar fallback model Groq |
| `APP_ENCRYPTION_KEY` | fallback `SESSION_SECRET` | Enkripsi API key user di database |
| `OPENAI_API_KEY` | — | Kunci OpenAI |
| `OPENROUTER_API_KEY` | — | Kunci OpenRouter |
| `GEMINI_API_KEY` | — | Kunci Google Gemini |
| `CLOUDFLARE_API_KEY` | — | Kunci Cloudflare Workers AI |
| `CLOUDFLARE_ACCOUNT_ID` | — | Account ID untuk base URL Workers AI |
| `CLOUDFLARE_BASE_URL` | — | Override penuh base URL Workers AI |
| `PROVIDER_MODELS_CACHE_SECONDS` | `120` | Cache katalog model live |
| `PROVIDER_PING_TIMEOUT` | `12` | Timeout cek koneksi provider |

Env contoh juga memuat slot `TOGETHER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, dan `CEREBRAS_API_KEY`. Katalog bawaan saat ini berisi Groq, OpenRouter, OpenAI, Google Gemini, dan Cloudflare Workers AI; endpoint lain dapat ditambahkan sebagai **provider custom** dari UI.

### Image generation

| Variable | Default | Fungsi |
|---|---|---|
| `IMAGE_PROVIDER` | `openrouter` | Provider gambar default |
| `IMAGE_MODEL` | `google/gemini-3-pro-image` | Model gambar default |
| `IMAGE_TIMEOUT` | `120` | Timeout request gambar |
| `IMAGE_MAX_RETRIES` | `2` | Retry untuk 429/5xx |
| `IMAGE_DAILY_LIMIT` | `100` | Batas gambar per hari; `0` tanpa batas |

### Embedding dan memori

| Variable | Default | Fungsi |
|---|---|---|
| `EMBEDDING_PROVIDER` | `none` | `none` atau `huggingface` |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Model embedding |
| `EMBEDDING_DIM` | `384` | Harus sama dengan dimensi kolom |
| `HUGGINGFACE_API_KEY` | — | Kunci Hugging Face |
| `MEMORY_RETRIEVAL_COUNT` | `6` | Jumlah memori per jawaban |
| `MEMORY_MIN_SIMILARITY` | `0.25` | Ambang kemiripan semantik |
| `MEMORY_CLUSTER_SIMILARITY` | `0.82` | Ambang cluster topik |
| `MEMORY_EXTRACTION_ENABLED` | `true` | Ekstraksi memori otomatis |
| `MEMORY_SCOPE_BY_MODE` | `false` | Batasi retrieval ke mode chat yang sama |

### Guardrail

| Variable | Default | Fungsi |
|---|---|---|
| `MAX_CONTEXT_MESSAGES` | `20` | Pesan terakhir yang dikirim ke LLM |
| `RATE_LIMIT_PER_MINUTE` | `30` | Batas aksi tulis/LLM |
| `READ_RATE_LIMIT_PER_MINUTE` | `300` | Batas baca |
| `MAX_UPLOAD_BYTES` | `10485760` | Maks ukuran unggahan |
| `MAX_DOCUMENT_CHARS` | `12000` | Maks karakter dokumen dalam prompt |

### Riset, crawl, dan skill

| Variable | Default | Fungsi |
|---|---|---|
| `RESEARCH_MAX_CHARS` | `12000` | Maks karakter sumber web dalam prompt |
| `RESEARCH_MAX_SOURCES` | `5` | Maks sumber per percakapan |
| `RESEARCH_FETCH_TIMEOUT` | `15` | Timeout crawl parser bawaan |
| `RESEARCH_MAX_BYTES` | `2097152` | Maks byte HTML |
| `RESEARCH_SEARCH_LIMIT` | `5` | Hasil per pencarian Firecrawl |
| `SKILL_MAX_CHARS` | `6000` | Maks konten satu skill |
| `SKILLS_MAX_TOTAL_CHARS` | `12000` | Maks total skill per prompt |
| `SKILLS_MAX_PER_FEATURE` | `6` | Maks skill per fitur |
| `CRAWL_PROVIDER` | `httpx` | `httpx` atau `firecrawl` |
| `FIRECRAWL_API_KEY` | — | Kunci Firecrawl, hanya server |
| `FIRECRAWL_BASE_URL` | `https://api.firecrawl.dev` | Base URL Firecrawl/self-host |
| `FIRECRAWL_ALLOW_EMPTY_KEY` | `false` | Hanya untuk self-host tanpa auth |
| `FIRECRAWL_TIMEOUT_MS` | `60000` | Timeout scrape |
| `FIRECRAWL_DAILY_CREDITS` | `30` | Batas kredit harian |
| `FIRECRAWL_MONTHLY_CREDITS` | `1000` | Batas kredit bulanan |
| `FIRECRAWL_CHECK_PROMPT_INJECTION` | `false` | Scan prompt-injection bawaan Firecrawl |

### Repo, proyek, dan usage

| Variable | Default | Fungsi |
|---|---|---|
| `GITHUB_TOKEN` | — | Repo privat + rate limit lebih tinggi |
| `GITHUB_API_BASE` | `https://api.github.com` | API GitHub |
| `GITHUB_RAW_BASE` | `https://raw.githubusercontent.com` | Pembacaan file mentah |
| `REPO_INDEX_MAX_FILES` | `300` | Maks file repo |
| `REPO_INDEX_MAX_FILE_BYTES` | `200000` | Maks byte per file |
| `REPO_INDEX_MAX_CHUNKS` | `4000` | Maks chunk |
| `REPO_INDEX_CHUNK_CHARS` | `1200` | Ukuran chunk |
| `REPO_INDEX_CHUNK_OVERLAP` | `200` | Overlap chunk |
| `REPO_QA_CONTEXT_CHUNKS` | `8` | Chunk konteks untuk Tanya repo |
| `PROJECT_HEALTH_AUTO_REFRESH` | `true` | Regenerasi ringkasan AI otomatis |
| `PROJECT_HEALTH_DEBOUNCE_SECONDS` | `12` | Jeda debounce regenerasi |
| `MODEL_TPM_LIMIT` | `8000` | Denominator meter token/menit; `0` sembunyikan |
| `MODEL_DAILY_TOKEN_LIMIT` | `200000` | Denominator meter token/hari; `0` sembunyikan |
| `TELEGRAM_BOT_TOKEN` | — | Disiapkan untuk Phase 4; belum dipakai |

### Frontend

| Variable | Default | Fungsi |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL backend |
| `NEXT_PUBLIC_API_PROXY` | — | `1` untuk memakai rewrite `/api-proxy` |

## Perilaku fitur

### Auth dan shell

- Login memakai satu kata sandi. Cookie `axtra_session` bersifat HttpOnly, `SameSite=Lax`, dan `Secure` saat production.
- Middleware hanya memeriksa keberadaan cookie; validitas sesi diverifikasi backend.
- Shell desktop memakai sidebar 224px yang dapat diciutkan ke 56px, drawer di mobile, topbar ringkas, meter penggunaan, toggle tema, dan footer.
- Sidebar berisi pencarian menu, daftar fitur yang dapat diurutkan/disembunyikan/di-rename, folder mode Chat, meter token, dan menu akun.

### Beranda orchestrator

- `/` bukan dashboard statis. Composer menerima tujuan bahasa alami lalu memanggil `POST /api/orchestrator`.
- Aksi yang diizinkan: `navigate`, `new_conversation`, `focus_menu`, `menu_order`, `menu_visibility`, `menu_rename`, `reset_menu`, `set_theme`, dan `save_memory`.
- Route divalidasi di backend; model tidak boleh mengarang halaman atau ID menu.
- Konfigurasi menu disimpan di `localStorage`; orchestrator dapat mengubah urutan, visibilitas, dan label.
- `AssistantDigest` menampilkan sapaan dan 3–4 rekomendasi dari riwayat, memori, dan profil. Hasil di-cache di browser dan bisa diperbarui manual.
- Jika LLM gagal, orchestrator dan digest memakai fallback yang aman.

### Chat

- Route: `/chat` menampilkan pemilih mode; `/chat/[mode]` membuka chat baru; `/chat/[id]` membuka percakapan tersimpan.
- Lima mode: `general`, `curhat`, `brainstorming`, `document`, `research`. Setiap mode punya prompt, saran, riwayat, dan slash command sendiri; memori personal dibagi lintas mode.
- Multi-tab chat horizontal dengan indikator streaming dan tombol buka/tutup tab.
- Streaming SSE: event `meta`, `token`, `memory`, `warning`, `done`, `error`; `done` dikirim setelah jawaban tersimpan dan membawa `elapsed_ms` serta opsi jawaban.
- Tombol stop membatalkan generasi yang sedang berjalan.
- Opsi jawaban interaktif disimpan di `messages.metadata.options` dan ditampilkan sebagai tombol.
- Composer mendukung lampiran dokumen, slash command, `@mention` proyek/lamaran, crawl URL, dan pencarian web pada mode Riset.
- Persona per mode menyimpan multi-role, perilaku, dan catatan bebas di `profiles.preferences.chat_modes`.
- Slash command disimpan per turn di `messages.metadata.command`.

### Memori

- Ekstraksi otomatis setelah jawaban; fakta disimpan dengan tipe, sumber, timestamp, dan confidence.
- CRUD manual di `/memory`, filter tipe, pencarian, cluster topik serupa, dan merge.
- Retrieval memakai pgvector jika embedding tersedia; fallback full-text keyword.
- Sumber web dapat disimpan menjadi memori lewat `POST /api/research/sources/{id}/memory`.
- Memori dapat dipakai orchestrator untuk memahami intent.

### Skills dan pengaturan

- Skill adalah entitas Markdown terpisah dengan `slug`, `name`, `description`, `category`, `version`, `source`, `license`, dan `status`.
- Assignment many-to-many ke fitur melalui `feature_skills`.
- Import manual atau tempel `SKILL.md` (frontmatter YAML subset + body Markdown).
- Hanya skill `active` dan ter-assign yang dimuat ke prompt; `draft` tidak bisa di-assign dan `disabled` tidak dimuat.
- Blok prompt: GLOBAL → ROLE → SKILL AKTIF → INSTRUCTION → KONTEKS. Konten skill tidak dieksekusi.
- Halaman `/settings` memakai rail vertikal dan lebar penuh dengan tab:
  - **Model teks** — provider, API key, koneksi, kuota, rekomendasi, katalog model teks.
  - **Model gambar** — provider gambar, katalog model gambar, style default, info Image API.
  - **Chat & fitur** — persona per fitur, provider crawl, katalog command, dan pengelolaan skill.
  - **Skills** — pustaka skill.
  - **Slash command** — daftar command per mode.
- Model teks dan model gambar disimpan terpisah (`preferences.llm` dan `preferences.llm_image`).

### Riset Web dan dokumen

- Mode Riset punya input crawl URL dan pencarian web.
- Pencarian memakai Firecrawl `/v2/search`; crawl memakai parser `httpx` atau Firecrawl `/v2/scrape`.
- Sumber disimpan sebagai teks per percakapan, dibatasi `RESEARCH_MAX_SOURCES`, dan disuntik ke prompt.
- Firecrawl fallback ke parser bawaan saat kredit habis, rate limit, timeout, atau error jaringan; kunci tidak valid tidak di-fallback.
- Kredit Firecrawl dicatat di `crawl_usage_events`.
- Mode Document menerima TXT, MD, dan PDF; teks disimpan di `chat_documents`, bukan file biner.
- Konten web/dokumen diperlakukan sebagai data tidak tepercaya.

### Proyek

- `/projects` menampilkan statistik dan grid kartu proyek: status, deskripsi, tech stack, label, repo, progres indeks, dan kesehatan.
- Proyek dapat dibuat manual; memori bertipe project hanya menempelkan catatan ke proyek yang cocok atau di-`@mention`.
- Index repo mengambil file dari GitHub API/raw, memecah chunk, opsional embedding, dan menyimpan progres.
- Detail proyek memakai dua kolom: ringkasan, metadata, kesehatan AI + riwayat, papan tugas Kanban, chat terkait, file explorer, data non-repo, dan sidebar Tanya repo + riwayat pertanyaan.
- Perubahan data proyek menandai `health_stale`; scheduler background melakukan regenerasi setelah debounce.
- Tanya repo memakai retrieval semantik atau keyword dengan fallback substring.
- Prompt `@mention` membawa konteks proyek dan lamaran; tautan chat disimpan di `project_conversations` dan `messages.metadata`.

### Vibe Coding

- `/vibe` dan `/projects/[id]/vibe` mengelola workspace ide per proyek.
- Empat tab: Discovery, Dokumen, Rencana, Verifikasi.
- Discovery menyimpan pesan terstruktur dan keputusan dengan status `CONFIRMED`, `ASSUMED`, `RESEARCH`, `NEEDS_DECISION`, `VALIDATION_REQUIRED`.
- Tujuh artefak: `PRD`, `ARCHITECTURE`, `ACCEPTANCE_TEST_PLAN`, `UI_UX_SPEC`, `AGENT_INSTRUCTIONS`, `IMPLEMENTATION_PLAN`, `DEFINITION_OF_DONE`.
- Setiap simpan/generate membuat versi immutable. Edit artefak `APPROVED` menghasilkan `NEEDS_REVIEW`; keputusan berubah menandai `STALE`.
- Task masuk ke `project_tasks` yang sama dengan `source='vibe'`.
- Prompt handoff disusun deterministik dari task + artefak approved (fallback draft).
- Verifikasi `DONE` mensyaratkan bukti. Axtra tidak menjalankan terminal, commit, push, deploy, atau GitHub write.

### Cari Kerja

- `/jobs` adalah tracker lamaran dengan status `draf`, `dilamar`, `screening`, `interview`, `offer`, `ditolak`, `ditarik`.
- Satu CV aktif per owner (`job_cv`) dari TXT, MD, atau PDF.
- Profil kandidat menyimpan LinkedIn dan portfolio; portfolio dapat dicrawl, LinkedIn diisi manual.
- Analisa memilih sumber `cv`, `portfolio`, `linkedin`; minimal satu tersedia.
- Detail lamaran: skor match, peluang berhasil, deskripsi lowongan, prediksi jobdesk, analisa, editor cover letter, dan aksi crawl/analisa ulang.
- `@mention` lamaran menyuntikkan konteks ke chat.

### Generated Image

- `/images` membuat gambar dari prompt teks, gambar referensi, style, rasio, resolusi, kualitas, format, background, seed, steps, jumlah gambar, dan routing provider.
- Model gambar aktif dan style default disimpan di preferensi terpisah dari model teks.
- Katalog model diambil live dari Image API; parameter yang tidak didukung model disembunyikan.
- Streaming pratinjau dipakai bila model mendukung.
- Riwayat sesi menyimpan hasil di state browser; telemetri biaya/jumlah gambar tersimpan di `image_usage_events`.
- Batas harian `IMAGE_DAILY_LIMIT` ditegakkan server. OpenRouter dengan saldo rendah menampilkan peringatan.
- Provider gambar bawaan: OpenRouter-style Image API dan Cloudflare Workers AI (termasuk model fallback terkurasi).
- Image-to-image gratis di Workers AI memakai FLUX.2 (`flux-2-klein-4b`, `flux-2-klein-9b`, `flux-2-dev`). Model ini memakai multipart dengan `input_image_0..3` (maksimal 4 referensi, masing-masing disarankan <512x512); klein berjalan dengan 4 langkah tetap sehingga kontrol `steps` disembunyikan.

### Pemakaian token

- Setiap panggilan LLM mencatat token ke `token_usage_events` dengan model dan sumber (`chat` atau `memory`).
- Meter menampilkan token/menit, total harian WIB, dan rincian per model.
- Frontend polling tiap 15 detik dan memuat ulang setelah turn selesai.
- `MODEL_TPM_LIMIT` dan `MODEL_DAILY_TOKEN_LIMIT` hanya denominator tampilan; `0` menyembunyikan persentase.

## API utama

Semua endpoint memakai prefix `/api` dan cookie sesi kecuali health/login.

| Kelompok | Endpoint |
|---|---|
| Health/auth | `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/logout` |
| Profil | `GET/PATCH /profile` |
| Chat | `POST /chat` (SSE) |
| Percakapan | `GET /conversations`, `GET /conversations/{id}`, `GET /conversations/{id}/messages`, `PATCH/DELETE /conversations/{id}` |
| Dokumen | `POST/GET /documents`, `DELETE /documents/{id}` |
| Memori | `GET/POST /memories`, `GET /memories/search`, `GET/PATCH/DELETE /memories/{id}`, `GET /memories/clusters`, `POST /memories/merge` |
| Chat settings | `GET/PUT /chat-settings`, `PUT /chat-settings/crawl` |
| Feature settings | `GET /feature-settings`, `PUT /feature-settings/{feature}` |
| Skills | `GET/POST /skills`, `GET/PATCH/DELETE /skills/{id}`, `POST /skills/parse` |
| Provider | `GET/POST /providers`, `PUT /providers/selection`, `PUT /providers/image-selection`, `PUT/DELETE /providers/{id}/key`, `GET /providers/{id}/models`, `POST /providers/{id}/ping`, `GET /providers/{id}/recommendations`, `GET /providers/{id}/quota` |
| Research | `POST /research/crawl`, `POST /research/search`, `GET /research/sources`, `DELETE /research/sources/{id}`, `POST /research/sources/{id}/memory` |
| Proyek | CRUD `/projects`, index/hapus repo, tanya repo + stream, riwayat ask, health, tasks + reorder, dokumen, file explorer, chat terkait |
| Vibe | `/projects/{project_id}/vibe/sessions`, messages, decisions, artifacts, versions, tasks generate/prompt, verification |
| Jobs | CRUD `/jobs`, CV, links, crawl portfolio, crawl lowongan, analyze, cover-letter |
| Images | `GET /images/config`, `/images/models`, `/images/endpoints`, `/images/credits`, `/images/usage`; `PUT /images/style`; `POST /images/generate`, `/images/generate/stream` |
| Usage | `GET /usage` |
| Orchestrator | `POST /orchestrator` |
| Rekomendasi | `GET /recommendations` |

## Database dan migration

Migration saat ini:

| File | Isi |
|---|---|
| `0001_init` | profiles, conversations, messages, memories, memory_embeddings |
| `0002_rls` | RLS awal |
| `0003_functions` | retrieval semantik + keyword |
| `0004_single_user` | owner tunggal, lepas FK auth |
| `0005_retrieval_single_user` | retrieval untuk service role |
| `0006_chat_modes_documents` | mode chat + chat_documents |
| `0007_token_usage` | token_usage_events + agregat |
| `0008_projects` | projects |
| `0009_project_code` | chunk kode + RPC |
| `0010_repo_index_progress` | progres indeks |
| `0011_project_tasks_asks` | tasks, asks, health |
| `0012_code_keyword_or` | keyword retrieval OR |
| `0013_project_chat_links` | health stale + project_conversations |
| `0014_project_documents` | data non-repo |
| `0015_research_sources` | research_sources |
| `0016_job_applications` | job_applications + job_cv |
| `0017_code_files_rpc` | daftar file repo |
| `0018_crawl_usage` | crawl_usage_events |
| `0019_vibe_workspace` | vibe_sessions, messages, decisions, artifacts, versions |
| `0020_project_labels` | labels JSONB |
| `0021_project_health_history` | health_history JSONB |
| `0022_feature_skills` | tabel skills awal |
| `0023_skill_system` | metadata skill + feature_skills |
| `0024_job_profile_links` | LinkedIn/portfolio |
| `0025_job_profile_seed` | seed profil kandidat |
| `0026_provider_settings` | provider_keys terenkripsi |
| `0027_token_usage_by_model` | rincian token per model |
| `0028_image_usage` | image_usage_events |

## Testing dan verifikasi

Backend:

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

E2E manual/otomatis:

```bash
cd backend
.venv\Scripts\python scripts\e2e_test.py
```

Cakupan test backend mencakup provider Cloudflare, provider registry, code indexer, crawl provider, Firecrawl search, feature persona, image router/service, job service, skill parser/service, vibe service, dan web crawler.

## Deploy ke Vercel

Frontend dan backend di-deploy sebagai **dua project Vercel** dari repo yang sama:
frontend memakai preset Next.js, backend memakai preset FastAPI (Python runtime,
Fluid compute). Streaming SSE didukung runtime Python Vercel.

### 1. Project backend (FastAPI)

- Import repo yang sama, set **Root Directory = `backend`**.
- Vercel mendeteksi `app/main.py` (instance `app`) secara zero-config.
- `backend/vercel.json` mengatur `maxDuration: 300` dan mengecualikan `tests/`,
  `scripts/`, `__pycache__`, `.venv` dari bundle.
- `backend/.python-version` = `3.12`.
- Environment variables wajib:

  | Variable | Nilai |
  |---|---|
  | `APP_ENV` | `production` |
  | `APP_PASSWORD` | kata sandi login (kuat) |
  | `SESSION_SECRET` | string acak panjang |
  | `APP_ENCRYPTION_KEY` | string acak panjang (stabil; jangan diubah setelah ada key tersimpan) |
  | `SUPABASE_URL` | URL project |
  | `SUPABASE_SERVICE_ROLE_KEY` | service role key |
  | `CORS_ORIGINS` | `https://<frontend-domain>` |
  | `GROQ_API_KEY` atau kunci provider lain | opsional tapi disarankan |

- Catat URL hasil deploy, mis. `https://axtra-backend.vercel.app`.

### 2. Project frontend (Next.js)

- Import repo yang sama, set **Root Directory = `frontend`**.
- Environment variables (diisi sebelum build):

  | Variable | Nilai |
  |---|---|
  | `NEXT_PUBLIC_API_URL` | URL project backend, mis. `https://axtra-backend.vercel.app` |
  | `NEXT_PUBLIC_API_PROXY` | `1` |

`NEXT_PUBLIC_API_PROXY=1` membuat browser memanggil backend lewat rewrite
same-origin `/api-proxy`, sehingga cookie sesi `SameSite=Lax` terkirim otomatis
dan tidak ada masalah CORS. `NEXT_PUBLIC_API_URL` dibaca saat build untuk
menentukan tujuan rewrite, jadi harus diisi di Vercel (bukan hanya lokal).

### Batasan saat per-request (Vercel)

- Rate limiter dan `health_scheduler` berjalan **in-process**; pada Fluid compute
  beberapa instance dapat hidup bersamaan, sehingga batas rate bersifat
  per-instance dan auto-refresh kesehatan proyek bersifat best-effort (tugas
  setelah respons tidak dijamin selesai). Untuk jadwal yang andal, gunakan
  Vercel Cron memanggil route API.
- Endpoint `/docs` dimatikan saat `APP_ENV=production`.

## Batasan saat ini

- Aplikasi masih **single-owner**, bukan multi-tenant.
- Belum ada daily journal, goal tracking, AI mentor, laporan harian/mingguan.
- Belum ada automation engine, scheduler persisten, retry queue, Telegram, atau web push.
- GitHub integration masih read-only untuk indexing repo; belum ada OAuth, commit, issue, atau PR write.
- Vibe Coding tidak mengeksekusi kode dan tidak mengubah repo.
- Generated Image bergantung pada kredit/provider eksternal; tidak ada model gambar gratis yang dijamin.
- Riwayat gambar disimpan di state sesi browser, bukan tabel riwayat gambar penuh.
- Firecrawl self-host harus diisolasi dari jaringan internal agar tidak bisa mengakses Supabase/backend.
- Siapa pun yang mengetahui `APP_PASSWORD` dapat mengakses seluruh data. Gunakan kata sandi kuat.

## Peta phase

| Phase | Isi | Status |
|---|---|---|
| 1 | Chat, streaming, memori, profil, auth | ✅ selesai |
| 2 | Journal, target, proyek | 🟡 proyek, task, dokumen, repo, health selesai; journal/target belum |
| 3 | AI Mentor, skill evidence, laporan | ⏳ belum |
| 4 | Automation, Telegram, PWA push | ⏳ belum |
| 5 | GitHub + Vibe Coding | 🟡 Vibe Coding MVP selesai; GitHub write/OAuth belum |
| 6 | Riset web, creator tools, image | 🟡 Riset Web + Generated Image selesai; creator content tools belum |
| Lintas fase | Multi-provider, settings model teks/gambar, orchestrator beranda | ✅ selesai |