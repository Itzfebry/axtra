import {
  BadgeCheck,
  Bell,
  Brain,
  Code2,
  FolderKanban,
  Globe,
  GraduationCap,
  MessageSquare,
  PenTool,
  Settings,
  User,
  Workflow,
} from "lucide-react";

export type Feature = {
  id: string;
  title: string;
  description: string;
  icon: typeof MessageSquare;
  /** Present when the feature is live today; absent for fase berikutnya. */
  href?: string;
  /** Shown as a badge on features that are not live yet. */
  phase?: number;
};

export const PERSONAL: Feature[] = [
  {
    id: "memory",
    href: "/memory",
    title: "Memori",
    description: "Periksa, koreksi, atau hapus fakta personal yang diingat Axtra.",
    icon: Brain,
  },
  {
    id: "profile",
    href: "/profile",
    title: "Profil",
    description: "Identitas dasar: nama, zona waktu, dan gaya komunikasi.",
    icon: User,
  },
  {
    id: "settings",
    href: "/settings",
    title: "Pengaturan",
    description: "Posisi (peran) dan perilaku Axtra untuk tiap fitur & mode chat.",
    icon: Settings,
  },
  {
    id: "skills",
    title: "Skills",
    description: "Peta kemampuan dan bukti progres yang terukur.",
    icon: BadgeCheck,
    phase: 3,
  },
];

export const FEATURES: Feature[] = [
  {
    id: "chat",
    href: "/chat",
    title: "Chat",
    description:
      "Empat mode: General, Curhat, Brainstorming, dan Document dengan upload dokumen.",
    icon: MessageSquare,
  },
  {
    id: "projects",
    title: "Proyek",
    description: "Spesifikasi, keputusan teknis, progres, dan dokumen proyek.",
    icon: FolderKanban,
    phase: 2,
  },
  {
    id: "vibe-coding",
    title: "Vibe Coding",
    description: "Dari ide menjadi PRD, arsitektur, dan task breakdown.",
    icon: Code2,
    phase: 5,
  },
  {
    id: "automation",
    title: "Otomasi",
    description: "Pekerjaan terjadwal yang berjalan tanpa browser terbuka.",
    icon: Workflow,
    phase: 4,
  },
  {
    id: "notifications",
    title: "Notifikasi",
    description: "Laporan dan pengingat lewat Telegram serta Web Push.",
    icon: Bell,
    phase: 4,
  },
  {
    id: "mentor",
    title: "Mentor",
    description: "Evaluasi progres, kesenjangan skill, dan rekomendasi belajar.",
    icon: GraduationCap,
    phase: 3,
  },
  {
    id: "creator-tools",
    title: "Generated Image",
    description: "Ide konten, hook, outline, naskah, dan kalender konten.",
    icon: PenTool,
    phase: 6,
  },
  {
    id: "research",
    title: "Riset Web",
    description: "Cari, bandingkan, dan ringkas sumber dengan referensi.",
    icon: Globe,
    phase: 6,
  },
];