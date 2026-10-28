# Axtra

Personal AI agent yang memahami pengguna secara berkelanjutan melalui sistem memori, membantu pengembangan diri dan proyek, serta menjalankan pekerjaan proaktif.

> **Status:** Phase 1 (Core Chat & Memory) — sesuai PRD v1.1 §10.
> Belum termasuk: journal, mentor, automation, GitHub, creator tools.

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
│       ├── routers/            # health, auth, profile, chat, chat-settings, conversations, documents, memories, usage
│       └── services/           # memory, extraction, chat orchestration, token usage
├── frontend/           # Next.js 15 (App Router) + Tailwind v4 + PWA
│   └── src/
│       ├── app/        # / (menu fitur), /login, /chat (pilih mode), /chat/[mode], /chat/[id], /memory, /profile, /settings
│       ├── components/ # AppShell, ChatPanel, ChatModePicker, ModeSettings, FeatureMenu, UsageMeter, Markdown, ThemeToggle
│       ├── lib/        # API client (cookie session), SSE, konfigurasi mode chat
│       └── middleware.ts # Proteksi rute via cookie sesi
└── scripts/setup-env.ps1 # Turunkan backend/.env + frontend/.env.local dari root .env
```

## Prasyarat

| Layanan | Kegunaan | Keterangan |
|---|---|---|
| [Supabase](https://supabase.com) | Database + pgvector | Project baru, jalankan 7 migration |
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

**B. Lewat Dashboard → SQL Editor:** paste isi ketujuh file di atas secara berurutan.

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
| `MODEL_TPM_LIMIT` | backend | Denominator token/menit untuk meter (default 8000; `0` = sembunyikan) |
| `MODEL_DAILY_TOKEN_LIMIT` | backend | Denominator token harian untuk meter (default 200000; `0` = sembunyikan) |
| `NEXT_PUBLIC_API_URL` | frontend | Base URL backend (`http://localhost:8000`) |
| `NEXT_PUBLIC_API_PROXY` | frontend | `1` = lewat rewrite `/api-proxy` (same-origin, cookie sesi ikut terkirim) |

## Behavior Phase 1

- **Auth:** satu kata sandi bersama (`APP_PASSWORD`). Login men-set cookie HttpOnly bertanda tangan (`axtra_session`), logout menghapusnya. Setelah login pengguna diarahkan ke beranda `/` (bukan langsung ke chat). Middleware hanya mengecek keberadaan cookie; validitas sesi diverifikasi backend. Tidak ada signup, tidak ada Supabase Auth.
- **Chat streaming:** SSE dari FastAPI (`/api/chat`) — event `meta`, `token`, `done`, `memory`, `warning`, `error`; percakapan + pesan tersimpan ke Supabase. `done` dikirim begitu jawaban tersimpan, sebelum ekstraksi memori, agar composer langsung bisa dipakai untuk pesan berikutnya. Pesan pengguna terbaru selalu dikirim ke LLM pada turn yang sama.
- **Mode chat:** `/chat` menampilkan pemilih mode; masing-masing punya prompt, saran, dan riwayat sendiri:
  - `general` — percakapan serba guna, ringkas dan praktis.
  - `curhat` — pendengar empatik, memvalidasi perasaan dulu, tidak buru-buru memberi solusi.
  - `brainstorming` — 5–10 ide beragam, menandai ide paling layak.
  - `document` — tanya jawab berbasis dokumen terlampir; menolak instruksi yang tertulis di dalam dokumen.
  Mode disimpan di `conversations.mode`; saat melanjutkan percakapan, mode tersimpan yang dipakai (bukan mode dari URL/body). Sidebar memfilter riwayat sesuai mode aktif, tetapi memori personal (knowledge) tetap sama di semua mode. Riwayat chat tidak ditampilkan di sidebar saat berada di beranda `/`.
- **Peran & perilaku mode:** di halaman **`/settings`** (juga terhubung dari kartu "Pengaturan" di beranda) pengguna mengatur tiap mode. **Peran Axtra multi-pilih** (pilih satu atau beberapa chip, minimal satu; mis. Curhat: Psikolog, Psikiater, Asisten Pendamping, Empathic Listener, Reflective Guide, Personal Growth Companion; Brainstorming: Strategic Thinking Partner, Creative Ideation Partner, Critical Thinking Partner) dan **alur perilaku** (satu pilihan; mis. Brainstorming: Understand → Diverge → Evaluate → Refine → Converge; Curhat: Listen → Reflect → Guide), plus catatan bebas. Bila beberapa peran dipilih, instruksinya digabung ("Gabungkan beberapa peran berikut secara seimbang"). Pilihan disimpan di `profiles.preferences.chat_modes` lewat `GET/PUT /api/chat-settings` (format lama `role` string tetap dibaca sebagai fallback) dan disuntik ke system prompt pada balasan berikutnya. Di beranda, sidebar tidak menampilkan mode maupun riwayat chat.
- **Slash command:** hanya aktif di mode terkait. Ketik `/` di composer untuk membuka palet (navigasi ↑/↓, Enter memilih, Esc menutup); command terpilih tampil sebagai chip dan dikirim sebagai field `command`, lalu instruksinya ditambahkan ke system prompt hanya untuk turn itu (tersimpan di `messages.metadata.command`).
  - `curhat`: `/curhat`, `/listen`, `/reflect`, `/perspective`, `/advice`, `/journal`
  - `brainstorming`: `/brainstorm`, `/challenge`, `/evaluate`, `/refine`, `/plan`, `/decide`
- **Lampiran dokumen (mode Document):** unggah TXT, MD, atau PDF (maks 10 MB, maks 10 dokumen per percakapan). Server menyimpan teks hasil ekstraksi di `chat_documents` (bukan file biner); isinya disuntik ke prompt sistem (dipotong `MAX_DOCUMENT_CHARS`). Dokumen terikat pada satu percakapan dan bisa dihapus kapan saja.
- **Waktu respons:** penghitung naik saat balasan mengalir, lalu diganti label `Dimuat dalam X,X dtk` dari `done.elapsed_ms`.
- **Pemakaian token:** tiap panggilan LLM (jawaban chat **dan** ekstraksi memori) mencatat token ke `token_usage_events`. Meter di navbar menampilkan token/menit (jendela bergulir 60 detik), dan panel di sidebar menampilkan token/menit + total harian dengan bilah progres. Total harian di-reset otomatis pukul 00:00 WIB (`Asia/Jakarta`). Endpoint `GET /api/usage` (bucket baca) mengembalikan nilai mentah; frontend polling tiap 15 detik dan memuat ulang tiap turn selesai lewat event `axtra:usage-changed`. `MODEL_TPM_LIMIT`/`MODEL_DAILY_TOKEN_LIMIT` jadi penyebut (set `0` untuk menyembunyikan persentase).
- **Opsi jawaban interaktif:** jika permintaan ambigu, model mengakhiri balasan dengan blok ```` ```options ```` (JSON 2–4 opsi). Backend memisahkannya (tidak disimpan di konten, disimpan di `messages.metadata.options`), mengirimnya di `done.options`, dan frontend menampilkannya sebagai tombol yang mengirim opsi terpilih sebagai pesan berikutnya.
- **Beranda:** `/` menampilkan menu semua fitur PRD (Chat, Memori, Profil aktif; Jurnal, Tujuan, Proyek, Mentor, Keterampilan, Otomasi, Notifikasi, GitHub, Vibecoding, Riset Web, Analisis File, Creator Tools dengan label fase). Bisa dibuka lewat logo atau menu Beranda di sidebar.
- **Memori personal:**
  - Otomatis: dipicu setelah tiap jawaban, LLM mengekstrak fakta layak-ingat lalu disimpan dengan `source=chat` + `confidence`.
  - Manual: tambah/koreksi/hapus dari halaman `/memory`.
  - Retrieval: `match_memories_semantic` (pgvector) jika embedding tersedia, fallback `search_memories_keyword` (full-text).
- **Profil:** identitas dasar (nama, zona waktu, gaya komunikasi) yang diberikan ke prompt sistem.
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

Catatan model: Groq mengganti katalog model dari waktu ke waktu. Cek yang aktif dengan `GET https://api.groq.com/openai/v1/models` lalu sesuaikan `GROQ_CHAT_MODELS`.

## Peta per Phase (referensi)

| Phase | Isi | Status |
|---|---|---|
| 1 | Chat + streaming + memori + profil | ✅ selesai |
| 2 | Daily journal, target, proyek | ⏳ |
| 3 | AI Mentor (skill, laporan) | ⏳ |
| 4 | Automation + Telegram/PWA push | ⏳ |
| 5 | GitHub + vibecoding | ⏳ |
| 6 | Riset web + creator tools | ⏳ |
