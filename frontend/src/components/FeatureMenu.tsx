import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Brain,
  Code2,
  FileText,
  FolderKanban,
  GitBranch,
  Globe,
  GraduationCap,
  MessageSquare,
  NotebookPen,
  PenTool,
  Settings,
  Target,
  User,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

type Feature = {
  title: string;
  description: string;
  icon: typeof MessageSquare;
};

const AVAILABLE: (Feature & { href: string })[] = [
  {
    href: "/chat",
    title: "Chat",
    description: "Empat mode: General, Curhat, Brainstorming, dan Document dengan upload dokumen.",
    icon: MessageSquare,
  },
  {
    href: "/memory",
    title: "Memori",
    description: "Periksa, koreksi, atau hapus fakta personal yang diingat Axtra.",
    icon: Brain,
  },
  {
    href: "/profile",
    title: "Profil",
    description: "Identitas dasar: nama, zona waktu, dan gaya komunikasi.",
    icon: User,
  },
  {
    href: "/settings",
    title: "Pengaturan",
    description: "Posisi (peran) dan perilaku Axtra untuk tiap fitur & mode chat.",
    icon: Settings,
  },
];

const FUTURE: (Feature & { phase: number })[] = [
  {
    title: "Jurnal Harian",
    description: "Catat aktivitas, pencapaian, kendala, dan refleksi harian.",
    icon: NotebookPen,
    phase: 2,
  },
  {
    title: "Tujuan & Prioritas",
    description: "Kelola target, tenggat, dan prioritas berdasarkan konteks.",
    icon: Target,
    phase: 2,
  },
  {
    title: "Proyek",
    description: "Spesifikasi, keputusan teknis, progres, dan dokumen proyek.",
    icon: FolderKanban,
    phase: 2,
  },
  {
    title: "Mentor AI",
    description: "Evaluasi progres, kesenjangan skill, dan rekomendasi belajar.",
    icon: GraduationCap,
    phase: 3,
  },
  {
    title: "Keterampilan",
    description: "Peta kemampuan dan bukti progres yang terukur.",
    icon: BadgeCheck,
    phase: 3,
  },
  {
    title: "Otomasi",
    description: "Pekerjaan terjadwal yang berjalan tanpa browser terbuka.",
    icon: Workflow,
    phase: 4,
  },
  {
    title: "Notifikasi",
    description: "Laporan dan pengingat lewat Telegram serta Web Push.",
    icon: Bell,
    phase: 4,
  },
  {
    title: "GitHub",
    description: "Repo dan aktivitas read-only yang terhubung ke proyek.",
    icon: GitBranch,
    phase: 5,
  },
  {
    title: "Vibecoding",
    description: "Dari ide menjadi PRD, arsitektur, dan task breakdown.",
    icon: Code2,
    phase: 5,
  },
  {
    title: "Riset Web",
    description: "Cari, bandingkan, dan ringkas sumber dengan referensi.",
    icon: Globe,
    phase: 6,
  },
  {
    title: "Analisis File",
    description: "Baca PDF, TXT, dan Markdown untuk konteks tambahan.",
    icon: FileText,
    phase: 6,
  },
  {
    title: "Creator Tools",
    description: "Ide konten, hook, outline, naskah, dan kalender konten.",
    icon: PenTool,
    phase: 6,
  },
];

export function FeatureMenu() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-16">
        <header>
          <p className="text-[11px] uppercase tracking-wide text-muted">Ruang kerja</p>
          <div className="mt-1 flex items-center gap-2.5">
            <Image src="/axtratr.png" alt="" width={36} height={36} priority className="h-9 w-9 rounded-lg" />
            <h1 className="text-2xl font-semibold tracking-tight">Axtra</h1>
          </div>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            Pilih fitur yang ingin dibuka. Modul bertanda fase akan tersedia pada
            pengembangan berikutnya.
          </p>
        </header>

        <section className="mt-8" aria-labelledby="available-heading">
          <h2
            id="available-heading"
            className="text-[11px] uppercase tracking-wide text-muted"
          >
            Tersedia sekarang
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {AVAILABLE.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.href}>
                  <Link
                    href={feature.href}
                    className="group flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors duration-150 hover:border-foreground/30 hover:bg-surface-muted"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-foreground transition-colors duration-150 group-hover:bg-background">
                        <Icon size={18} aria-hidden />
                      </span>
                      <ArrowRight
                        size={16}
                        aria-hidden
                        className="text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      />
                    </div>
                    <h3 className="mt-3 text-sm font-medium">{feature.title}</h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">
                      {feature.description}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="future-heading">
          <h2 id="future-heading" className="text-[11px] uppercase tracking-wide text-muted">
            Fase berikutnya
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FUTURE.map((feature) => {
              const Icon = feature.icon;
              return (
                <li
                  key={feature.title}
                  className="flex h-full flex-col rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-muted">
                      <Icon size={18} aria-hidden />
                    </span>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      Fase {feature.phase}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-muted">{feature.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    {feature.description}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}