import {
  BadgeCheck,
  Brain,
  Briefcase,
  Code2,
  FolderKanban,
  Image as ImageIcon,
  MessageSquare,
  Settings,
  User,
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
      "Lima mode: General, Curhat, Brainstorming, Document, dan Riset Web dengan crawl URL.",
    icon: MessageSquare,
  },
  {
    id: "projects",
    href: "/projects",
    title: "Proyek",
    description: "Spesifikasi, keputusan teknis, progres, dan dokumen proyek.",
    icon: FolderKanban,
  },
  {
    id: "jobs",
    href: "/jobs",
    title: "Cari Kerja",
    description:
      "Lacak lamaran, crawl lowongan, cocokkan CV, dan buat cover letter.",
    icon: Briefcase,
  },
  {
    id: "prd",
    href: "/vibe",
    title: "Vibe Coding",
    description: "Dari ide menjadi PRD, arsitektur, test plan, task, dan prompt agent.",
    icon: Code2,
  },
  {
    id: "creator-tools",
    href: "/images",
    title: "Generated Image",
    description: "Buat gambar dari deskripsi, lengkap dengan gaya dan rasio.",
    icon: ImageIcon,
  },
];