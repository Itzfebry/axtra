# Axtra — Design System & UI Guidelines

**Product:** Axtra Personal AI Agent  
**Document:** `Design.md`  
**Version:** 1.2  
**Tanggal:** 31 Oktober 2026  
**Design Direction:** Minimalist · Dark-first · Chat-centric · Performance-first  
**Platform:** Web Application + Progressive Web App (PWA)

> Dokumen ini diselaraskan dengan token dan komponen aktual di `frontend/src/app/globals.css` dan `frontend/src/components`. Nilai warna/font di bawah adalah nilai nyata yang dipakai aplikasi.

---

## 1. Design Philosophy

Axtra menggunakan desain minimalis dengan latar gelap sebagai tema utama. Antarmuka harus tenang, profesional, intuitif, dan ringan untuk penggunaan harian.

Pengalaman utama berpusat pada percakapan AI, dengan navigasi ringkas dan fitur tambahan yang dibuka saat diperlukan. Beranda bukan dashboard statis, melainkan pintu masuk berbasis bahasa alami.

### Core Principles

1. **Chat first:** Percakapan menjadi pusat pengalaman.
2. **Dark by default:** Tema gelap default; tema terang opt-in via `[data-theme="light"]`.
3. **Minimal navigation:** Tidak semua modul ditampilkan sekaligus.
4. **Accent, not decoration:** Satu aksen oranye untuk menandai aksi/status; tidak ada gradient atau glow.
5. **Fast interaction:** Setiap aksi memberi respons cepat.
6. **Progressive disclosure:** Fitur lanjutan dibuka saat relevan.
7. **Performance first:** Hindari render, request, dan proses yang tidak perlu.
8. **Accessible:** Nyaman dengan keyboard, layar kecil, dan teknologi bantu.

## 2. Visual Identity

### 2.1 Color Palette

Token didefinisikan di `:root` (gelap, default) dan `[data-theme="light"]` (opsional). Dipetakan ke Tailwind v4 melalui `@theme inline` di `globals.css`.

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--background` | `#08090a` | `#ffffff` | Latar utama |
| `--surface` | `#0f1011` | `#ffffff` | Panel, sidebar, kartu |
| `--surface-muted` | `#191a1b` | `#f5f5f5` | Area sekunder, hover item aktif |
| `--surface-hover` | `#28282c` | `#ececec` | Hover permukaan |
| `--sidebar` | `#0f1011` | `#fafafa` | Latar sidebar |
| `--foreground` | `#f7f8f8` | `#171717` | Teks utama |
| `--muted` | `#d0d6e0` | `#737373` | Teks sekunder terang |
| `--muted-2` | `#8a8f98` | `#6b7280` | Teks sekunder redup |
| `--muted-3` | `#8a8f98` | `#6b7280` | Teks tersier |
| `--border` | `#28282c` | `#e5e5e5` | Pembatas |
| `--primary` | `#e2874c` | `#c96f36` | Aksen/brand oranye |
| `--primary-foreground` | `#1b1109` | `#ffffff` | Teks di atas primary |
| `--accent` | `#e2874c` | `#c96f36` | Aksen |
| `--success` | `#22c55e` | `#16a34a` | Status sukses |
| `--warning` | `#f59e0b` | `#d97706` | Peringatan |
| `--danger` | `#ef4444` | `#b42318` | Error penting |

Di Tailwind, token dipakai sebagai `bg-background`, `bg-surface`, `text-foreground`, `text-muted`, `border-border`, `text-primary`, `bg-primary/10`, dan seterusnya.

### Color Rules

- Gunakan permukaan gelap netral sebagai fondasi; hierarki lewat perbedaan luminansi.
- Oranye `primary` adalah satu-satunya aksen brand; gunakan hemat untuk fokus, ikon tab aktif, dan aksi utama.
- Warna status (`success`/`warning`/`danger`) hanya untuk makna fungsional.
- Jangan memakai warna sebagai satu-satunya indikator status; sertakan ikon atau teks.
- Hindari gradient, neon, dan warna dekoratif.

### 2.2 Prohibited Effects

Dilarang:
- Gradient dan multicolor background.
- Glow, neon, light trails.
- Glassmorphism/backdrop blur dekoratif.
- Shadow dekoratif tebal.
- Animasi partikel, parallax, elemen 3D.
- Animasi masuk yang tidak memberi makna.
- Hover mencolok.

Shadow tipis (`shadow-sm`, `shadow-lg`) hanya untuk dropdown/menu agar terbaca sebagai lapisan di atas konten. Kualitas visual dibangun dari tipografi, kontras, spacing, dan konsistensi.

## 3. Typography

Body memakai system font stack; judul halaman memakai font brand.

```css
/* body */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
font-size: 14px;
line-height: 1.5;

/* .font-brand (judul halaman) */
font-family: var(--font-brand), var(--font-sans); /* Space Grotesk */
```

`--font-brand` di-inject lewat `next/font/google` `Space_Grotesk` di `layout.tsx`.

| Element | Size | Weight | Font |
|---|---:|---:|---|
| Page title (`h1`) | 24px (`text-2xl`) | 600 | brand |
| Section title (`h2`) | 15–18px | 500–600 | sans |
| Card title (`h3`) | 12–15px | 500–600 | sans |
| Body | 14px | 400 | sans |
| Secondary | 13px | 400 | sans |
| Caption/label | 10–12px | 400–500 | sans |
| Code | 13px | 400 | mono |

Guidelines:
- Eyebrow halaman memakai `text-[11px] uppercase tracking-wide text-muted` di atas `h1`.
- Batasi variasi ukuran/weight.
- Monospace untuk kode: `--font-mono` (ui-monospace/Menlo/Consolas).
- Jangan mengecilkan teks hanya demi memuat lebih banyak informasi.

## 4. Layout and Spacing

Spacing berbasis kelipatan 4px (kelas Tailwind `p-2`=8px, `p-4`=16px, `gap-3`=12px, dll.).

Radius yang dipakai: `rounded-lg` (8px, dominan), `rounded-xl` (12px, kartu/panel), `rounded-full` (pil/badge). Hindari `rounded-2xl` kecuali composer.

Rules:
- Hindari panel bersarang berlebihan.
- Divider tipis (`border-border`) untuk memisah.
- Kartu hanya untuk kelompok informasi yang benar-benar terpisah.
- Pertahankan lebar baca nyaman untuk percakapan.
- Gunakan spacing untuk membedakan kelompok konten.

## 5. Application Shell

Struktur shell aktual (`AppShell.tsx`):

```text
Axtra
├── Sidebar (desktop, dapat diciutkan)
│   ├── Logo + Axtra + tombol ciutkan
│   ├── Menu fitur (FeatureSidebar): pencarian, daftar fitur, folder mode Chat
│   ├── UsageMeter (token/menit + harian)
│   └── Menu Akun: Profil, Memori, Pengaturan, Keluar
├── Topbar (h-11)
│   ├── Tombol drawer (mobile) + logo (mobile)
│   ├── UsageMeter
│   └── ThemeToggle (di halaman menu) atau ChatHistoryMenu (di halaman chat)
├── Main
│   ├── ChatTabs (hanya di /chat/*)
│   └── PageTransition (isi halaman)
└── Footer
```

### 5.1 Sidebar

- Desktop terbuka lebar 224px (`w-56`), menciut ke 56px (`w-14`) dengan transisi 150ms.
- Mobile: drawer 256px (`w-64`) dengan overlay gelap.
- Menu fitur: pencarian, item dengan ikon + label, item aktif `bg-surface-muted font-medium`.
- Folder **Chat** dapat dibuka untuk menampilkan lima mode.
- Fitur belum live ditandai dot `bg-muted/50` dan label `· Fase N`.
- Urutan, visibilitas, dan label item berasal dari konfigurasi menu di `localStorage`.
- Meter token dapat dilipat; status disimpan di `localStorage`.

### 5.2 Topbar dan Footer

- Topbar ringkas `h-11` dengan border bawah.
- Tombol toggle tema tampil di halaman menu/preferensi; tombol riwayat percakapan tampil di halaman chat.
- Footer: `Axtra by Itz AI · Febry Workstation` dengan brand font untuk nama workstation.

### 5.3 Navigation Behavior

- Desktop: sidebar dapat dibuka/diciutkan.
- Mobile: navigasi lewat drawer; drawer tertutup otomatis saat rute berubah.
- `NavigationProgress` menampilkan bar tipis indeterminate di atas saat navigasi.
- Pertahankan konteks percakapan saat membuka menu/pengaturan.

## 6. Home Orchestrator

Beranda `/` bukan dashboard statis (`MenuOrchestrator.tsx`).

- Header brand dengan maskot, greting, dan composer bahasa alami.
- Composer memanggil `POST /api/orchestrator`; aksi yang diizinkan: `navigate`, `new_conversation`, `focus_menu`, `menu_order`, `menu_visibility`, `menu_rename`, `reset_menu`, `set_theme`, `save_memory`.
- Route dan ID menu divalidasi di backend; model tidak boleh mengarang halaman/menu.
- `AssistantDigest` menampilkan sapaan + 3–4 rekomendasi dari riwayat/memori/profil, di-cache di `localStorage` dan bisa dimuat ulang manual.
- Shortcut utama: Chat, Proyek, Cari Kerja, Riset, dan Generated Image.
- Bila LLM gagal, orchestrator dan digest memakai fallback aman.

## 7. Chat Interface

### 7.1 Chat Modes

Lima mode dengan prompt, saran, riwayat, dan slash command sendiri: `general`, `curhat`, `brainstorming`, `document`, `research`. Memori personal dibagi lintas mode. `/chat` menampilkan pemilih mode berupa grid kartu; `/chat/[mode]` membuka chat baru.

### 7.2 Conversation Design

- Pesan pengguna dan respons AI dibedakan lewat alignment, spacing, dan hierarki teks.
- Hindari bubble berwarna mencolok; gunakan permukaan netral.
- Respons AI dirender Markdown (`.markdown`) dengan heading, list, tabel, tautan, dan blok kode bergaya konsisten.
- Sumber riset ditampilkan jelas.
- Tidak ada avatar besar atau dekorasi berulang.

### 7.3 Tabs

- `ChatTabs` horizontal memetakan tab ke percakapan terbuka; indikator streaming di tab aktif.
- Tombol `+` membuka menu mode; tombol `X` menutup tab.

### 7.4 Message Composer

- Input multiline auto-grow dengan tinggi awal ringkas.
- Enter mengirim, Shift+Enter baris baru.
- Tombol stop selama generasi.
- Slash command palette (mengetik `/`) menampilkan command sesuai mode.
- `@mention` menyuntikkan konteks proyek/lamaran.
- Mode Riset: input crawl URL dan pencarian web.
- Lampiran dokumen (TXT/MD/PDF).
- Composer tetap responsif saat streaming; tidak mengirim request saat pengguna mengetik.

### 7.5 Streaming

- SSE dengan event `meta`, `token`, `memory`, `warning`, `done`, `error`.
- Teks dirender bertahap; tanpa animasi mengetik buatan.
- Hanya pesan aktif yang diperbarui.
- `done` membawa `elapsed_ms` dan opsi jawaban.
- Opsi jawaban ditampilkan sebagai tombol dari `messages.metadata.options`.

## 8. Settings

Halaman `/settings` memakai lebar penuh (bukan kartu sempit) dan rail vertikal sticky di desktop (`SettingsTabs.tsx`).

- Layout `lg:grid lg:grid-cols-[236px_minmax(0,1fr)]`.
- Rail: di desktop satu kolom sticky `lg:sticky lg:top-0`; di mobile grid 2 kolom (`sm:grid-cols-4`).
- Tab aktif: `bg-primary/10 text-foreground` dengan ikon `text-primary`.
- Tab dan deskripsi:
  1. **Model teks** — provider, API key, model chat, kuota.
  2. **Model gambar** — provider, model, style Image API.
  3. **Chat & fitur** — persona, perilaku, dan skill per mode.
  4. **Skills** — pustaka skill.
  5. **Slash command** — daftar command per mode.
- Header konten menampilkan label + deskripsi tab aktif di desktop.

Model teks (`preferences.llm`) dan model gambar (`preferences.llm_image`) dikelola di tab terpisah.

Katalog dan grid (skill, command, model) memakai `grid` responsif (`md:grid-cols-2 2xl:grid-cols-3`).

## 9. Other Feature Surfaces

- `/memory` — CRUD memori, filter tipe, pencarian, cluster topik serupa, merge.
- `/profile` — identitas dan gaya komunikasi.
- `/projects` + `/projects/[id]` — grid proyek, detail dua kolom (ringkasan/metadata/kesehatan + riwayat, papan tugas Kanban, file explorer, data non-repo, sidebar Tanya repo).
- `/jobs` + `/jobs/[id]` — tracker lamaran, CV, links, analisa, cover letter.
- `/images` — Generated Image: prompt, referensi, style, rasio/resolusi/kualitas/format/background/seed/steps/jumlah, katalog model, streaming pratinjau, riwayat sesi, peringatan kredit.
- `/vibe` dan `/projects/[id]/vibe` — empat tab: Discovery, Dokumen, Rencana, Verifikasi.

## 10. Component Guidelines

### Buttons
- Tinggi standar 36–44px (`h-9`/`h-11`); area sentuh mobile ≥ 44×44px.
- Label jelas; maksimal satu tombol utama per kelompok.
- Tombol ikon wajib punya accessible name (`aria-label`/`title`).
- Tidak ada tombol dekoratif tanpa fungsi.

### Inputs
- `rounded-lg border border-border bg-surface` dengan teks 13px.
- Focus: `focus:border-primary/60 focus:ring-2 focus:ring-primary/15`.
- `:focus-visible` global memakai outline 2px `foreground`.
- Label dan pesan error jelas.

### Cards
- `rounded-lg`/`rounded-xl` + `border border-border bg-surface`.
- Tanpa shadow dekoratif; hover tipis (`hover:border-primary/30 hover:bg-surface-muted`) untuk kartu interaktif.
- Hindari kartu di dalam kartu.

### Dialogs and Menus (`ui/Modal.tsx`)
- `role="dialog"`, `aria-modal`, label, dukungan Escape.
- Tone: `success`, `error`, `info` dengan ikon dan warna status.
- Tindakan destruktif memerlukan konfirmasi.
- `OperationStatus` untuk status operasi inline.

### Icons
- Satu library: Lucide, penggunaan selektif.
- Ukuran umum 14–20px; dekorasi minimal.

## 11. Interaction and Motion

Motion-minimal dengan kelas animasi terpusat di `globals.css`:

- `.animate-page-in` — masuk halaman (220ms).
- `.animate-menu-in` — daftar menu dengan stagger (200ms).
- `.animate-nav-progress` — bar navigasi indeterminate.
- `.animate-scan` / `.animate-step-pulse` — progres indeks repo.
- `.animate-welcome` / `.animate-line` / `.animate-shake` — layar login.
- Transisi warna/hover 150ms.

Aturan:
- Tidak ada animasi dekoratif.
- Hormati `prefers-reduced-motion` (semua durasi dipangkas ke 0.01ms).
- Jangan menunda navigasi karena transisi.

## 12. Responsive Design

### Desktop
- Chat area utama; sidebar dapat diciutkan.
- Lebar pesan dibatasi untuk keterbacaan.
- Panel tambahan muncul saat diperlukan.

### Tablet
- Sidebar diciutkan atau drawer.
- Komposisi chat sederhana; hindari banyak kolom.

### Mobile
- Chat fokus utama; composer mengikuti safe area.
- Navigasi lewat drawer.
- Tabel panjang digulir horizontal; kode tetap terbaca.
- Draft pesan dipertahankan saat pindah konteks bila memungkinkan.

## 13. Performance Requirements

### Frontend
- Server Components untuk konten non-interaktif; Client Components hanya untuk bagian interaktif.
- Lazy-load modul sekunder.
- System font untuk body; hanya font brand yang diunduh.
- `next/image` untuk aset gambar.
- Pagination untuk riwayat (sidebar memuat 30 per batch).
- Hindari global state besar yang memicu render ulang luas.
- Jangan mengirim seluruh riwayat untuk setiap operasi.

### Performance Targets (validasi terhadap build produksi)

| Metric | Target |
|---|---|
| Initial JavaScript | Usahakan di bawah 100 KB gzip untuk shell awal |
| Largest Contentful Paint | ≤ 2.5 detik |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.1 |
| Decorative animation | 0 |

## 14. Backend Efficiency

### Request Policy
- Jangan memanggil API akibat render ulang.
- Hindari polling agresif; meter token polling tiap 15 detik dan dimuat ulang setelah turn.
- Gunakan pagination dan debounce untuk pencarian server.
- Batalkan/koalesensikan request yang tidak lagi diperlukan (sidebar mengoalesensi event perubahan 400ms).

### AI Request Policy
- Satu pesan pengguna = satu alur generasi utama (kecuali tool/retry).
- Ambil hanya memori relevan, bukan seluruh database.
- Batasi konteks lewat `MAX_CONTEXT_MESSAGES`.
- Tampilkan rate limit dengan pesan jelas.
- Jangan memblokir UI saat tugas berat berjalan.

### Streaming dan SSE
- Endpoint SSE dikecualikan dari gzip.
- Header SSE mencegah buffering.

### Crawl Provider Policy
- Satu seam provider di `services/web_crawler.py` + `crawlers/`.
- Parser `httpx` default; Firecrawl opt-in.
- Guard SSRF + normalisasi URL selalu sebelum panggilan provider.
- Preferensi user hanya menyimpan nama provider; kunci di env server.
- Fallback ke parser bawaan saat Firecrawl tidak tersedia.

### Background Tasks (rencana)
Untuk pekerjaan non-interaktif: simpan job persisten, kembalikan status, jalankan worker, simpan hasil, kirim notifikasi. Jangan mengandalkan timer browser. **Belum diimplementasikan.**

## 15. Loading, Error, and Empty States

### Loading
- Placeholder sederhana untuk menjaga stabilitas layout.
- `LoadingState` dan spinner kecil untuk operasi yang lebih dari instan.
- Bedakan streaming chat dan progres background (indeks repo).

### Error
- Pesan jelas (`role="alert"`, `text-danger`).
- Sediakan retry jika aman.
- Jangan menampilkan stack trace atau secrets.

### Empty State
- Jelaskan kondisi; beri satu tindakan utama.
- Tanpa ilustrasi dekoratif besar.

### Offline
- `sw.js` menyediakan shell PWA.
- Pertahankan draft lokal bila aman; jangan klaim terkirim sebelum server konfirmasi.
- Cegah pengiriman duplikat saat retry.

## 16. Accessibility

- Kontras teks memenuhi WCAG AA.
- Keyboard navigation dan `:focus-visible` (outline 2px foreground).
- Elemen semantik: `nav`, `main`, `footer`, `role="tablist"`, `role="dialog"`.
- Accessible name untuk tombol ikon.
- `aria-current="page"`, `aria-selected`, `aria-expanded` pada navigasi/tab.
- Hormati `prefers-reduced-motion`.
- Jangan memakai warna sebagai satu-satunya indikator.

## 17. Recommended Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 dengan token di `globals.css`
- **Icons:** Lucide (selektif)
- **Markdown:** renderer dengan sanitasi
- **Streaming:** SSE melalui backend
- **PWA:** Web App Manifest + Service Worker
- **Testing:** lint, typecheck, unit test backend, dan build produksi

## 18. Design Acceptance Checklist

Sebelum halaman dinyatakan selesai:

- [ ] Tema gelap menjadi default; tema terang berfungsi via toggle.
- [ ] Chat merupakan fokus utama.
- [ ] Navigasi ringkas dan mudah ditemukan.
- [ ] Aksen oranye dipakai hemat, bukan dekoratif.
- [ ] Tidak ada gradient, glow, glassmorphism, atau animasi dekoratif.
- [ ] Tipografi dan spacing konsisten dengan token.
- [ ] Semua tombol menjalankan fungsi nyata.
- [ ] Layout berfungsi di desktop dan mobile.
- [ ] Keyboard navigation dan focus indicator berfungsi.
- [ ] Tidak ada API request tidak perlu akibat render.
- [ ] Data dimuat bertahap bila besar.
- [ ] Loading, error, dan empty state tersedia.
- [ ] Interaksi tetap responsif saat AI streaming.
- [ ] Hasil build produksi telah diuji.
- [ ] `prefers-reduced-motion` dihormati.

## 19. Final Design Principle

Axtra harus terlihat sederhana karena kompleksitas ditangani sistem, bukan dibebankan ke pengguna.

Chat menjadi pusat. Navigasi ringkas. Fitur tambahan tersedia saat diperlukan. Visual tidak bersaing dengan konten. Setiap request dan proses punya alasan jelas.

**The interface stays quiet. The intelligence does the work.**
