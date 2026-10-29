# Axtra — Design System & UI Guidelines

**Product:** Axtra Personal AI Agent  
**Document:** `Design.md`  
**Version:** 1.1  
**Design Direction:** Minimalist · Black-first · Chat-centric · Performance-first  
**Platform:** Web Application + Progressive Web App (PWA)

---

## 1. Design Philosophy

Axtra menggunakan desain minimalis dengan latar hitam sebagai tema utama. Antarmuka harus terasa tenang, profesional, intuitif, dan ringan untuk penggunaan sehari-hari.

Pengalaman utama berpusat pada percakapan AI, dengan navigasi minimal dan fitur tambahan yang dapat diakses ketika diperlukan.

### Core Principles

1. **Chat first:** Percakapan menjadi pusat pengalaman aplikasi.
2. **Black by default:** Dark mode menggunakan warna hitam dan abu-abu netral.
3. **Minimal navigation:** Jangan menampilkan semua modul sekaligus.
4. **Zero decorative effects:** Tidak menggunakan gradient, glow, glassmorphism, atau animasi dekoratif.
5. **Fast interaction:** Setiap tindakan harus memberikan respons secepat mungkin.
6. **Progressive disclosure:** Tampilkan fitur lanjutan hanya ketika relevan.
7. **Performance first:** Hindari rendering, request, dan pemrosesan yang tidak diperlukan.
8. **Accessible:** Tetap nyaman digunakan dengan keyboard, layar kecil, dan teknologi bantu.

## 2. Visual Identity

### 2.1 Color Palette

Tema gelap menjadi default. Tema terang tersedia sebagai opsi.

| Token | Dark Mode | Light Mode | Usage |
|---|---|---|---|
| `background` | `#000000` | `#FFFFFF` | Latar utama |
| `surface` | `#0A0A0A` | `#FFFFFF` | Panel dan sidebar |
| `surface-muted` | `#171717` | `#F5F5F5` | Area sekunder |
| `foreground` | `#F5F5F5` | `#171717` | Teks utama |
| `muted` | `#A3A3A3` | `#737373` | Teks sekunder |
| `border` | `#262626` | `#E5E5E5` | Pembatas |
| `primary` | `#F5F5F5` | `#171717` | Tombol utama |
| `primary-foreground` | `#000000` | `#FFFFFF` | Teks tombol utama |
| `danger` | `#F87171` | `#B42318` | Error penting |

### Color Rules

- Gunakan warna netral sebagai fondasi.
- Hitam merupakan latar utama, bukan abu-abu dengan banyak variasi.
- Gunakan perbedaan luminansi untuk menciptakan hierarki.
- Warna status hanya digunakan ketika memiliki arti fungsional.
- Jangan menggunakan warna berbeda untuk membedakan setiap modul.
- Jangan menggunakan warna sebagai satu-satunya indikator status.
- Hindari aksen RGB, neon, dan warna dekoratif.

### 2.2 Prohibited Effects

Dilarang menggunakan:

- Gradient dan multicolor backgrounds.
- Glow, neon, dan light trails.
- Glassmorphism dan backdrop blur.
- Shadow dekoratif yang tebal.
- Animasi partikel, parallax, dan elemen 3D.
- Animasi masuk yang tidak diperlukan.
- Hover effects yang mencolok.
- Background video atau animasi berulang.
- Efek visual yang menghambat interaksi.

Kualitas visual dibangun melalui tipografi, kontras, spacing, komposisi, dan konsistensi.

## 3. Typography

Gunakan system font stack agar aplikasi tidak perlu mengunduh font eksternal.

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

| Element | Size | Weight |
|---|---:|---:|
| Page title | 24px | 600 |
| Section title | 18px | 600 |
| Card title | 15px | 600 |
| Body text | 14px | 400 |
| Secondary text | 13px | 400 |
| Caption | 12px | 400 |
| Code | 13–14px | 400 |

Guidelines:

- Gunakan line-height sekitar 1.5 untuk teks utama.
- Batasi jumlah variasi ukuran dan weight.
- Hindari teks uppercase secara berlebihan.
- Gunakan monospace untuk kode.
- Pastikan teks panjang nyaman dibaca.
- Jangan mengecilkan teks hanya untuk memasukkan lebih banyak informasi.

## 4. Layout and Spacing

Gunakan sistem spacing berbasis kelipatan 4px.

| Token | Value |
|---|---:|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-12` | 48px |

Rules:

- Hindari panel bersarang.
- Gunakan divider tipis jika diperlukan.
- Batasi card pada informasi yang benar-benar membutuhkan pengelompokan.
- Pertahankan lebar baca yang nyaman untuk percakapan.
- Hindari perubahan layout mendadak.
- Gunakan spacing untuk membedakan kelompok konten.
- Jangan memenuhi ruang kosong hanya agar halaman terlihat lebih sibuk.

## 5. Application Shell

Axtra menggunakan struktur aplikasi chat-centric.

```text
Axtra
├── Minimal Sidebar
│   ├── New Chat
│   ├── Recent Conversations
│   ├── Search Conversations
│   └── More
│       ├── Memory
│       ├── Projects
│       ├── Journal
│       └── Settings
│
└── Main Chat Area
    ├── Compact Header
    ├── Conversation
    └── Message Composer
```

### 5.1 Sidebar

- Lebar desktop sekitar 220–240px ketika terbuka.
- Sidebar dapat diciutkan.
- Tampilkan New Chat, percakapan terbaru, dan akses ke navigasi tambahan.
- Modul sekunder diletakkan di menu More atau area navigasi yang setara.
- Jangan menampilkan seluruh fitur sebagai daftar besar.
- Gunakan ikon sederhana dan label yang jelas.
- Item aktif dibedakan dengan background netral.
- Riwayat percakapan menggunakan pagination atau pemuatan bertahap.
- Jangan mengambil semua riwayat hanya untuk menampilkan sidebar.

### 5.2 Main Chat Area

- Mengisi ruang utama yang tersedia.
- Konten percakapan memiliki lebar baca yang nyaman.
- Header ringkas dan tidak mendominasi layar.
- Composer mudah dijangkau dan tidak menghalangi pesan.
- Jangan menambahkan dashboard, statistik, atau panel samping secara default.
- Panel konteks hanya dibuka saat pengguna memerlukannya.

### 5.3 Navigation Behavior

- Desktop: sidebar dapat dibuka dan diciutkan.
- Mobile: navigasi tersedia melalui drawer atau menu ringkas.
- Navigasi sekunder tidak mengambil ruang permanen di layar chat.
- Pertahankan konteks percakapan ketika membuka menu atau pengaturan.
- Hindari membuka halaman baru jika drawer atau panel kontekstual sudah memadai.

## 6. Chat Interface

Chat merupakan fitur utama Axtra dan harus terasa familier bagi pengguna aplikasi AI modern.

### 6.1 Conversation Design

- Gunakan tampilan percakapan sederhana seperti ChatGPT.
- Pesan pengguna dan respons AI dibedakan melalui alignment, spacing, dan hierarki teks.
- Hindari bubble berwarna mencolok.
- Tampilkan respons AI dengan format Markdown yang konsisten.
- Heading, list, tabel, tautan, dan kode harus mudah dibaca.
- Sediakan copy action untuk kode dan konten yang relevan.
- Jangan menambahkan avatar besar atau dekorasi berulang.
- Tampilkan sumber riset secara jelas ketika fitur pencarian digunakan.

### 6.2 Message Composer

- Input multiline dengan tinggi awal yang ringkas.
- Tombol kirim mudah ditemukan.
- Enter mengirim pesan dan Shift+Enter membuat baris baru.
- Tampilkan tombol stop selama generasi berlangsung.
- Attachment dan tools tersedia sebagai tindakan sekunder.
- Composer tetap responsif saat AI sedang melakukan streaming.
- Jangan mengirim request ke backend saat pengguna masih mengetik.
- Pastikan composer tidak tertutup keyboard pada perangkat mobile.

### 6.3 Streaming

- Gunakan SSE atau mekanisme streaming yang disediakan backend.
- Render teks yang diterima secara bertahap.
- Hindari animasi mengetik buatan.
- Jangan melakukan parsing seluruh riwayat pada setiap token.
- Batasi pembaruan UI pada pesan yang sedang aktif.
- Jangan melakukan retrieval memori berulang pada setiap token.
- Sediakan retry atau tindakan melanjutkan jika didukung backend.

### 6.4 Empty State

Saat belum ada percakapan, tampilkan:

- Nama Axtra.
- Kalimat singkat yang menjelaskan kegunaan aplikasi.
- Input pesan sebagai fokus utama.
- Maksimal empat contoh prompt yang relevan.

Tidak perlu ilustrasi besar, animasi, atau dashboard pembuka.

## 7. Progressive Disclosure

Fitur Axtra cukup banyak, tetapi tidak boleh membuat halaman chat terasa rumit.

Aturan:

- Tampilkan tindakan utama terlebih dahulu.
- Letakkan tindakan sekunder dalam menu kontekstual.
- Buka panel tambahan hanya jika diperlukan.
- Gunakan dialog untuk konfirmasi atau input yang membutuhkan fokus.
- Hindari menampilkan semua kontrol sekaligus.
- Jangan menyembunyikan fitur penting terlalu dalam.
- Setiap tindakan harus memiliki label atau petunjuk yang dapat dipahami.

Tujuannya adalah menjaga antarmuka sederhana tanpa mengurangi kemampuan produk.

## 8. Component Guidelines

### Buttons

- Tinggi standar 36–40px.
- Area sentuh mobile minimal 44 × 44px.
- Gunakan label yang jelas.
- Maksimal satu tombol utama untuk satu kelompok aksi.
- Tombol sekunder menggunakan gaya sederhana.
- Tombol ikon harus memiliki accessible name.
- Jangan membuat tombol dekoratif yang tidak menjalankan fungsi nyata.

### Inputs

- Background solid.
- Border tipis.
- Focus indicator terlihat.
- Label dan pesan error jelas.
- Hindari validasi server pada setiap karakter jika tidak diperlukan.

### Cards

- Gunakan hanya untuk kelompok informasi yang benar-benar terpisah.
- Radius sekitar 8px.
- Tanpa shadow dekoratif.
- Hindari card di dalam card.
- Gunakan list biasa jika struktur informasi sederhana.

### Dialogs and Menus

- Mendukung keyboard navigation dan Escape.
- Tidak membuat dialog bertingkat tanpa kebutuhan kuat.
- Tindakan destruktif memerlukan konfirmasi.
- Menu berisi tindakan yang relevan dengan konteks aktif.

### Icons

- Gunakan satu library ikon yang konsisten.
- Pilih ikon sederhana dan mudah dikenali.
- Ukuran umum 16–20px.
- Hindari ikon berlebihan hanya untuk dekorasi.

## 9. Interaction and Motion

Axtra menerapkan motion-minimal.

- Tidak ada animasi dekoratif.
- Feedback interaksi harus langsung.
- Hindari animasi layout yang tidak penting.
- Jangan menganimasikan shadow, filter, atau backdrop blur.
- Transisi sederhana sekitar 100–150ms hanya jika meningkatkan pemahaman interaksi.
- Hormati `prefers-reduced-motion`.
- Jangan menunda navigasi atau aksi karena transisi.

## 10. Responsive Design

### Desktop

- Chat menjadi area utama.
- Sidebar dapat diciutkan.
- Lebar pesan dibatasi untuk keterbacaan.
- Panel tambahan hanya muncul saat diperlukan.

### Tablet

- Sidebar dapat diciutkan atau dibuka sebagai drawer.
- Pertahankan komposisi chat yang sederhana.
- Jangan memaksakan banyak kolom.

### Mobile

- Chat menjadi fokus utama.
- Composer mengikuti safe area perangkat.
- Navigasi melalui drawer atau menu ringkas.
- Tombol utama mudah dijangkau.
- Tabel panjang dapat digulir horizontal atau diubah menjadi format yang sesuai.
- Kode harus tetap dapat dibaca dan digulir.
- Jangan memuat data desktop yang tidak diperlukan.
- Pertahankan draft pesan saat pengguna membuka menu atau kembali dari halaman lain jika memungkinkan.

## 11. Performance Requirements

### Frontend

- Gunakan Next.js Server Components untuk konten yang tidak membutuhkan interaktivitas client-side.
- Gunakan Client Components hanya pada bagian interaktif.
- Lazy-load modul sekunder seperti editor kompleks dan tools tambahan.
- Hindari library besar untuk fungsi sederhana.
- Gunakan system fonts.
- Hindari aset dekoratif yang tidak memberi nilai fungsional.
- Gunakan pagination untuk riwayat dan daftar panjang.
- Terapkan virtualisasi jika ukuran daftar membenarkannya.
- Hindari global state yang menyebabkan seluruh aplikasi dirender ulang.
- Jangan mengirim seluruh riwayat percakapan untuk setiap operasi.
- Evaluasi bundle berdasarkan build produksi.

### Performance Targets

Target awal untuk diuji:

| Metric | Target |
|---|---|
| Initial JavaScript | Usahakan di bawah 100 KB gzip untuk shell awal |
| Largest Contentful Paint | ≤ 2.5 detik |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.1 |
| Unnecessary API requests | 0 untuk interaksi lokal |
| Decorative animation | 0 |
| Blocking requests yang tidak perlu | 0 |

Core Web Vitals dievaluasi pada persentil ke-75 bila data lapangan tersedia. Target ukuran bundle perlu divalidasi terhadap hasil build dan kebutuhan aplikasi.

## 12. Backend Efficiency

UI yang cepat harus didukung pola request yang efisien.

### Request Policy

- Jangan memanggil API akibat render ulang komponen.
- Hindari polling agresif.
- Hindari refetch semua data setelah satu aksi kecil.
- Jangan mengirim pesan ke LLM ketika pengguna masih mengetik.
- Gunakan pagination untuk riwayat dan daftar.
- Debounce pencarian server jika diperlukan.
- Cache data dengan kebijakan yang tepat.
- Gunakan invalidation terarah.
- Cegah duplicate requests.
- Batalkan request yang tidak lagi diperlukan.

### AI Request Policy

- Satu pesan pengguna menghasilkan satu alur generasi utama, kecuali diperlukan tool call atau retry.
- Jangan menggunakan LLM untuk operasi lokal sederhana.
- Ambil hanya memori relevan, bukan seluruh database personal.
- Gunakan ringkasan percakapan untuk mengontrol context window.
- Jangan membuat ulang embedding jika sumber tidak berubah.
- Batasi retry dan penanganan kegagalan.
- Tampilkan rate limit dengan pesan yang jelas.
- Jangan memblokir UI ketika tugas berat berjalan.

### Background Tasks

Untuk pekerjaan yang tidak harus selesai dalam request interaktif:

1. Simpan job ke antrean persisten.
2. Kembalikan status job ke frontend.
3. Jalankan proses menggunakan worker.
4. Simpan hasil dan status akhir.
5. Kirim notifikasi jika dibutuhkan.

Gunakan SSE, WebSocket, atau polling terbatas berdasarkan kebutuhan. Jangan mengandalkan timer browser untuk pekerjaan terjadwal.

## 13. Loading, Error, and Empty States

### Loading

- Gunakan placeholder sederhana jika diperlukan untuk menjaga stabilitas layout.
- Jangan menampilkan spinner untuk operasi lokal yang hampir instan.
- Bedakan streaming chat dan background jobs.

### Error

- Gunakan pesan yang jelas.
- Sediakan retry jika aman.
- Jangan menampilkan stack trace atau secrets.
- Hindari retry tanpa batas.

### Empty State

- Jelaskan kondisi yang terjadi.
- Berikan satu tindakan utama.
- Hindari ilustrasi dan teks dekoratif.

### Offline

- Tampilkan status koneksi saat relevan.
- Pertahankan draft lokal jika aman.
- Jangan mengklaim pesan terkirim sebelum server mengonfirmasi.
- Cegah pengiriman duplikat ketika melakukan retry.

## 14. Accessibility

- Penuhi kontras teks WCAG 2.2 AA.
- Dukung keyboard navigation.
- Tampilkan focus indicator yang jelas.
- Gunakan elemen HTML semantik.
- Sediakan accessible name untuk tombol ikon.
- Umumkan status penting melalui screen reader tanpa membacakan setiap token streaming.
- Hormati preferensi reduced motion.
- Pastikan UI tetap berfungsi saat teks diperbesar.
- Jangan menggunakan warna sebagai satu-satunya indikator.

## 15. Recommended Stack

- **Framework:** Next.js
- **Language:** TypeScript
- **Styling:** CSS Modules atau Tailwind CSS dengan token terpusat
- **Icons:** Lucide dengan penggunaan selektif
- **Markdown:** Renderer dengan sanitasi yang sesuai
- **Streaming:** SSE melalui kontrak API backend
- **PWA:** Web App Manifest dan Service Worker
- **Testing:** Unit, integration, accessibility, dan performance testing

Pilih satu pendekatan styling utama dan hindari beberapa UI framework sekaligus.

## 16. Design Acceptance Checklist

Sebelum halaman dinyatakan selesai:

- [ ] Dark mode hitam menjadi tema default.
- [ ] Light mode tersedia sebagai opsi.
- [ ] Chat merupakan fokus utama.
- [ ] Navigasi minimal dan mudah ditemukan.
- [ ] Tidak ada gradient, glow, glassmorphism, atau animasi dekoratif.
- [ ] Tipografi dan spacing konsisten.
- [ ] Semua tombol menjalankan fungsi nyata.
- [ ] Layout berfungsi di desktop dan mobile.
- [ ] Keyboard navigation dan focus indicator berfungsi.
- [ ] Tidak ada API request yang tidak diperlukan akibat render.
- [ ] Data dimuat secara bertahap bila jumlahnya besar.
- [ ] Loading, error, dan empty states tersedia.
- [ ] Interaksi tetap responsif saat AI streaming.
- [ ] Hasil build produksi telah diuji.
- [ ] Background jobs tidak bergantung pada browser terbuka.

## 17. Final Design Principle

Axtra harus terlihat sederhana karena kompleksitasnya ditangani oleh sistem, bukan dibebankan kepada pengguna.

Chat menjadi pusat. Navigasi tetap minimal. Fitur tambahan tersedia ketika diperlukan. Visual tidak bersaing dengan konten. Setiap request dan proses memiliki alasan yang jelas.

**The interface stays quiet. The intelligence does the work.**