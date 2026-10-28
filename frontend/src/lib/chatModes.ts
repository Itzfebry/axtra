import {
  FileText,
  HeartHandshake,
  Lightbulb,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

export type ChatMode = "general" | "curhat" | "brainstorming" | "document";

export const CHAT_MODE_IDS: ChatMode[] = [
  "general",
  "curhat",
  "brainstorming",
  "document",
];

export function isChatMode(value: string): value is ChatMode {
  return (CHAT_MODE_IDS as string[]).includes(value);
}

export type ChatModeConfig = {
  id: ChatMode;
  label: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  suggestions: string[];
  capabilities: string[];
};

export const CHAT_MODES: ChatModeConfig[] = [
  {
    id: "general",
    label: "General",
    tagline: "Percakapan serba guna",
    description:
      "Tanya apa saja, minta ringkasan, atau lanjutkan pekerjaan harian dengan jawaban ringkas dan praktis.",
    icon: MessagesSquare,
    suggestions: [
      "Bantu aku menyusun rencana belajar minggu ini.",
      "Ringkas proyek yang sedang aku kerjakan.",
      "Bantu aku memilih prioritas hari ini.",
      "Apa yang kamu ingat tentang tujuanku?",
    ],
    capabilities: ["Riwayat terpisah", "Akses memori bersama"],
  },
  {
    id: "curhat",
    label: "Curhat",
    tagline: "Ruang cerita yang aman",
    description:
      "Ceritakan apa yang sedang kamu rasakan. Axtra mendengarkan dulu, tidak menghakimi, dan tidak buru-buru memberi solusi.",
    icon: HeartHandshake,
    suggestions: [
      "Aku lagi capek banget hari ini.",
      "Aku bingung harus mulai dari mana.",
      "Aku butuh tempat cerita tanpa dihakimi.",
      "Bantu aku memahami perasaanku sekarang.",
    ],
    capabilities: ["Nada empatik", "Riwayat privat per mode", "Akses memori bersama"],
  },
  {
    id: "brainstorming",
    label: "Brainstorming",
    tagline: "Banyak ide, tanpa dihakimi",
    description:
      "Ajak Axtra meledakkan ide dari berbagai sudut, lalu tandai mana yang paling layak dikembangkan.",
    icon: Lightbulb,
    suggestions: [
      "Beri ide nama untuk proyek baruku.",
      "Cara meningkatkan fokus belajar?",
      "Ide konten seminggu ke depan.",
      "Pecah masalah ini jadi beberapa pendekatan.",
    ],
    capabilities: ["5–10 ide per balasan", "Sorotan ide terbaik", "Akses memori bersama"],
  },
  {
    id: "document",
    label: "Document",
    tagline: "Tanya jawab dengan dokumen",
    description:
      "Unggah TXT, MD, atau PDF lalu tanyakan isinya. Jawaban mengutamakan dokumen dan menyebut bagian yang relevan.",
    icon: FileText,
    suggestions: [
      "Ringkas dokumen ini.",
      "Apa poin utama dokumen ini?",
      "Buat daftar tindakan dari dokumen ini.",
      "Cari bagian yang membahas risiko.",
    ],
    capabilities: ["Upload TXT, MD, PDF", "Konteks per percakapan", "Akses memori bersama"],
  },
];

export function getChatMode(id: ChatMode | string | null | undefined): ChatModeConfig {
  return CHAT_MODES.find((mode) => mode.id === id) ?? CHAT_MODES[0];
}