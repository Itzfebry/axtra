# Rencana Teknis — Vibe Coding: Intake Mode, Template, dan Dokumen Selektif

Status: draft rencana, belum dieksekusi
Tanggal: 2026-11-02
Cakupan: memperluas alur Vibe Coding yang sudah ada dengan dua mode masuk (proyek lama / proyek baru), katalog template untuk proyek baru, klasifikasi fitur kecil/besar, dan generasi dokumen selektif. Bukan membangun ulang arsitektur.

---

## 1. Ringkasan eksekutif

Vibe Coding saat ini berasumsi satu bentuk masuk: user menulis "ide" (`raw_idea`) lalu discovery, lalu menghasilkan tujuh dokumen tetap. Ini tidak cocok untuk dua kasus nyata:

- **Proyek sudah ada (brownfield)** — user ingin mengubah/menambah fitur pada proyek nyata, bukan memulai dari nol. Axtra perlu membaca kondisi proyek dulu.
- **Proyek belum ada (greenfield)** — user butuh titik mulai cepat. Template (landing page, CRUD, dashboard, absensi, chatbot RAG) memberi struktur awal dan set dokumen bawaan.

Rencana ini menambahkan:

- `entry_mode` sebagai atribut sesi (`brownfield` / `greenfield`), **satu alur** state machine, bukan dua jalur kode.
- Tahap **intake**: grounding (analisa proyek lama atau pilih template + tech stack), lalu **AI mengusulkan** klasifikasi `feature_scope` dan daftar dokumen wajib; user mengonfirmasi atau override.
- **Matriks deterministik** template × scope → dokumen, agar generasi dokumen tidak over/under.
- **Kind dokumen baru** (`DATA_MODEL`, `API_SPEC`) di samping tujuh kind lama.
- Output tetap **spesifikasi + prompt handoff saja** (tidak menghasilkan kode, tidak eksekusi repo).

Hasil akhir: satu alur Vibe Coding yang melayani proyek lama dan proyek baru, hemat token karena hanya dokumen yang relevan yang dibuat, dan tetap menjaga gate "jangan mengubah asumsi menjadi fakta".

---

## 2. Temuan arsitektur saat ini (fakta dari kode)

| Area | Fakta | Lokasi |
| --- | --- | --- |
| Bentuk sesi | `vibe_sessions.raw_idea` jsonb berisi `idea`, `problem`, `target_users`, `constraints`; `stage` default `discovery` | `backend/app/services/vibe_service.py` (`create_session`, `_idea_context`), `supabase/migrations/20260101000019_vibe_workspace.sql` |
| Stage | `VibeStage = discovery \| specification \| planning \| verification` | `frontend/src/lib/api.ts` |
| Stage tak lengkap | Service hanya pernah set `discovery`, `specification`, `planning`; `verification` tak pernah diset | `vibe_service.py` baris 766, 895, 1143 |
| Kind dokumen | Tujuh kind hardcode `ARTIFACT_KINDS` + CHECK constraint di DB | `vibe_service.py:45`, migration `...0019` baris 104 |
| Unique dokumen | `unique (session_id, kind)` — satu dokumen aktif per kind per sesi | migration `...0019` baris 122 |
| Versi | `vibe_artifact_versions` immutable; read-then-write `version + 1` (rawan race) | `vibe_service.py` (`_save_new_version`) |
| Staleness | Semua artefak di-STALE saat status keputusan berubah; edit statement tak menandai | `vibe_service.py` (`update_decision`, `_mark_session_artifacts_stale`) |
| Konteks proyek | `projects.repo_summary`, `repo_index_status`, `repo_indexed_at`, retrieval `answer`/`answer_stream` | `backend/app/services/code_indexer.py`, `schemas.py` (`ProjectOut`), `routers/projects.py` |
| Analisa proyek | `build_project_analyzer` tersedia | `backend/app/memory_service_provider.py` |
| Katalog per fitur | Pola katalog statis: role + skill per fitur | `backend/app/feature_catalog.py` (entri `vibe` baris 165) |
| Persona | Dimuat `load_feature_persona`, diinjeksi ke prompt Vibe | `backend/app/services/feature_persona.py`, `routers/vibe.py:62` |
| Metering biaya | `vibe_service` **tidak** memanggil `record_usage`; hanya chat/jobs/memories/research yang mencatat | `backend/app/services/usage_service.py`, bandingkan `chat_service.py:32` |
| Rate limit | Hanya per-menit request, bukan token | `backend/app/deps.py` (`rate_limit`, `read_rate_limit`) |
| Endpoint | Prefix `/api/projects/{project_id}/vibe` | `backend/app/routers/vibe.py:46` |
| Frontend | `/vibe`, `/projects/[id]/vibe`, `/projects/[id]/vibe/[sessionId]` | `frontend/src/app/...` |

---

## 3. Keputusan yang sudah dikunci

1. **Klasifikasi fitur kecil/besar**: AI mengusulkan lebih dulu, user mengonfirmasi; sediakan opsi override.
2. **Dokumen baru**: perlu kind baru di luar tujuh yang ada (mis. `DATA_MODEL`, `API_SPEC`).
3. **Greenfield**: output berupa **prompt saja**, tidak menghasilkan kode/repo.
4. **Alur**: satu alur, `entry_mode` sebagai atribut (bukan dua jalur UI/kode terpisah).

---

## 4. Model data

### 4.1 `vibe_sessions` — tambah kolom

```
entry_mode          text not null default 'greenfield'
                      check (entry_mode in ('brownfield','greenfield'))
template_key        text                              -- null untuk brownfield
feature_scope       text                              -- null sampai user konfirmasi
                      check (feature_scope in ('small','medium','large') or feature_scope is null)
required_artifacts  text[] not null default '{}'      -- hasil matriks setelah konfirmasi
baseline_commit     text                              -- brownfield: sha saat sesi dibuat
baseline_indexed_at timestamptz
```

Catatan:

- **Change request brownfield** tidak dibuat kolom baru; perluas `raw_idea` (jsonb) dengan key `request` (prompt perubahan user) dan `target_area`. Alasan: `raw_idea` sudah ada, hindari migrasi kolom tiap iterasi.
- `required_artifacts` menyimpan set final hasil konfirmasi. Sumber kebenaran matriks tetap di kode; kolom ini snapshot untuk UI dan prompt.

### 4.2 `vibe_artifacts.kind` — perluas

Kind kanonik menjadi sembilan:

```
PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, ACCEPTANCE_TEST_PLAN,
UI_UX_SPEC, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE
```

`kind` tetap `text` dengan CHECK constraint yang diperbarui. `unique (session_id, kind)` tetap dipertahankan.

### 4.3 Katalog template — statis (kode), bukan tabel DB

Ikut pola `feature_catalog.py`. Setiap template:

```
key, label, artifact_kinds[], tech_stack_options[], file_conventions, seed_docs{}
```

- `seed_docs` = markdown bawaan template, disimpan bundled di repo (bukan DB) agar tidak menambah migrasi konten.
- Jika nanti template perlu diedit saat runtime, baru pindah ke tabel `vibe_template_documents` (di luar cakupan draft ini).

---

## 5. State machine — satu alur

```
intake -> discovery -> specification -> planning -> verification
```

`entry_mode` hanya atribut. Perbedaan hanya di tahap `intake`:

| Tahap | Brownfield | Greenfield |
| --- | --- | --- |
| intake (grounding) | Gate `repo_index_status='ready'`; refresh `repo_summary` via `build_project_analyzer`; simpan `baseline_commit` + `baseline_indexed_at` | Muat katalog template + `tech_stack_options`; user pilih template + tech stack |
| intake (input) | User menulis prompt perubahan (`raw_idea.request`) | User menulis ide (`raw_idea.idea`) |
| intake (klasifikasi) | AI usul `feature_scope` + `required_artifacts`; user konfirmasi/override | Idem |
| discovery | Konteks = project analysis + affected modules hasil index | Konteks = konvensi template + tech stack |
| specification | Generate hanya `required_artifacts` | Generate mengikuti `artifact_kinds` template, disaring `feature_scope` |
| planning | Jumlah task mengikuti `feature_scope` | Idem |
| verification | Bandingkan baseline (sha) dengan kondisi saat verifikasi | Tanpa baseline |

Perubahan yang menyertai: set `stage='intake'` saat sesi dibuat, dan set `stage='verification'` saat verifikasi dimulai (memperbaiki dead-end `verification`).

---

## 6. Matriks deterministik (bukan AI)

AI **mengusulkan**; matriks **memutuskan**; user **mengonfirmasi**. AI boleh menyarankan override dengan alasan, tetapi set final = matriks + keputusan user.

### 6.1 Basis per template

| Template | Kind |
| --- | --- |
| Landing page | PRD, UI_UX_SPEC, ACCEPTANCE_TEST_PLAN, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE |
| CRUD | PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, ACCEPTANCE_TEST_PLAN, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE |
| Landing + CRUD | Semua |
| Dashboard & Analytics | PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, UI_UX_SPEC, ACCEPTANCE_TEST_PLAN, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE |
| Sistem absensi | PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, UI_UX_SPEC, ACCEPTANCE_TEST_PLAN, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE |
| Chatbot RAG | PRD, ARCHITECTURE, DATA_MODEL, API_SPEC, ACCEPTANCE_TEST_PLAN, AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE |

### 6.2 Modifier `feature_scope`

| Scope | Efek |
| --- | --- |
| small | PRD (ringkas), AGENT_INSTRUCTIONS, IMPLEMENTATION_PLAN, DEFINITION_OF_DONE (+ ACCEPTANCE_TEST_PLAN opsional) |
| medium | + ARCHITECTURE, ACCEPTANCE_TEST_PLAN |
| large | Semua kind dari basis template |

### 6.3 Brownfield

- Basis tidak memakai template. `required_artifacts` diturunkan dari scope, lalu:
- Tambahkan `DATA_MODEL` dan/atau `API_SPEC` **hanya bila** AI mendeteksi perubahan menyentuh data/API → user konfirmasi.
- `baseline_commit` disimpan; verifikasi membandingkan.

---

## 7. Endpoint

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/vibe/templates` | Katalog statis + `tech_stack_options` |
| `POST /api/projects/{id}/vibe/sessions` | Body diperluas: `entry_mode`, `template_key?`, `tech_stack?`, `request?` |
| `POST /sessions/{sid}/intake/analyze` | Brownfield: gate index + refresh summary, simpan baseline, kembalikan analysis |
| `POST /sessions/{sid}/intake/classify` | AI usul `feature_scope` + `required_artifacts` (tidak persist) |
| `PATCH /sessions/{sid}` | Terima `feature_scope`, `required_artifacts`, `template_key`, `stage` |
| `GET /sessions/{sid}/plan` | Kembalikan `required_artifacts` + status tiap dokumen untuk UI |

Aturan: generasi artefak di luar `required_artifacts` tetap diizinkan (jangan hard-block), tetapi UI menyembunyikannya. Tujuan: hindari jalan buntu.

---

## 8. Prompt handoff (greenfield, prompt-only)

- `build_prompt` untuk greenfield memakai `file_conventions` + tech stack + dokumen template.
- Label section jelas "proyek baru, belum ada repo".
- Tidak ada generasi kode/repo/commit. Konsisten keputusan #3 dan batas MVP saat ini.

---

## 9. Perbaikan yang menyertai (wajib)

Perbaikan ini berasal dari analisa fitur sebelumnya dan harus masuk bersama, bukan setelahnya:

1. **Metering** — panggil `record_usage` di `VibeService._complete`. Tanpa ini fitur yang makin sering memanggil LLM (intake + analisa + rekomendasi) tidak terukur dan tidak bisa dibatasi.
2. **Staleness** — buat map `kategori keputusan -> kind terdampak`; tandai STALE berdasarkan kategori, bukan semua artefak; tandai juga saat `statement`/`rationale` berubah (bukan hanya `status`).
3. **Race versi** — amankan `_save_new_version` (constraint + increment atomik, atau retry) agar dua simpan paralel tidak melanggar `unique(session_id, kind)`.

---

## 10. Migrasi

`supabase/migrations/20260101000023_vibe_intake_templates.sql`:

- `alter table vibe_sessions add column ...` (lihat §4.1).
- `alter table vibe_artifacts drop constraint if exists vibe_artifacts_kind_check` lalu `add constraint ... check (kind in (...9 kind...))`.
- Index pendukung: `vibe_sessions (entry_mode)`, `(template_key)` bila perlu.

---

## 11. Test

- Katalog template: `GET /templates` mengembalikan enam template + tech stack options.
- Matriks: scope × template menghasilkan `required_artifacts` yang benar.
- `intake/classify`: AI usul scope; override user tersimpan; `required_artifacts` snapshot benar.
- Gate brownfield: `repo_index_status != ready` menolak `intake/analyze` dengan saran index dulu.
- Kind baru: generate + approve + versi `DATA_MODEL`/`API_SPEC` berjalan.
- Stage: `intake` diset saat dibuat, `verification` diset saat verifikasi mulai.
- Metering: satu panggilan generate mencatat `token_usage_events`.

---

## 12. Di luar cakupan draft

- Generasi kode / eksekusi repo / commit / push / deploy.
- GitHub OAuth + write.
- Marketplace template atau editor template runtime.
- Multi-user/RBAC.

---

## 13. Urutan implementasi yang disarankan

1. Migrasi `0023` + katalog template statis + `GET /templates`.
2. Perluas `create_session` + endpoint `intake/analyze` + `intake/classify` + `PATCH session`.
3. Matriks + `GET /plan` + penyesuaian `generate_artifact`/`generate_tasks` mengikuti `required_artifacts`/`feature_scope`.
4. Frontend: pemilih mode, template, tech stack; UI dokumen mengikuti `required_artifacts`.
5. Perbaikan wajib §9 (metering, staleness, race).
6. Test §11.
