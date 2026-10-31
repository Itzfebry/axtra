"use client";

import {
  BookOpen,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Server,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FeatureSettings } from "@/components/FeatureSettings";
import { SkillManager } from "@/components/SkillManager";
import { ImageSettings } from "@/components/settings/ImageSettings";
import { ProviderSettings } from "@/components/settings/ProviderSettings";
import { fetchChatSettings, fetchFeatureSettings } from "@/lib/api";
import type { ChatCommand, ChatModeId, SkillSummary } from "@/lib/api";
import { getChatMode } from "@/lib/chatModes";

type TabId = "provider" | "image" | "chat" | "skills" | "commands";

const TABS: {
  id: TabId;
  label: string;
  description: string;
  icon: typeof Server;
}[] = [
  {
    id: "provider",
    label: "Model teks",
    description: "Provider, API key, model chat, dan kuota.",
    icon: Server,
  },
  {
    id: "image",
    label: "Model gambar",
    description: "Provider, model, dan style Image API.",
    icon: ImageIcon,
  },
  {
    id: "chat",
    label: "Chat & fitur",
    description: "Peran, perilaku, dan skill per mode.",
    icon: MessageSquare,
  },
  {
    id: "skills",
    label: "Skills",
    description: "Kelola pustaka skill.",
    icon: BookOpen,
  },
  {
    id: "commands",
    label: "Slash command",
    description: "Daftar command per mode.",
    icon: Terminal,
  },
];

export function SettingsTabs() {
  const [tab, setTab] = useState<TabId>("provider");
  const active = TABS.find((item) => item.id === tab);

  return (
    <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div
        role="tablist"
        aria-label="Bagian pengaturan"
        className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface p-1.5 sm:grid-cols-4 lg:sticky lg:top-0 lg:grid-cols-1 lg:p-2"
      >
        {TABS.map((item) => {
          const selected = item.id === tab;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                selected
                  ? "bg-primary/10 text-foreground"
                  : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <Icon
                size={15}
                aria-hidden
                className={`mt-0.5 shrink-0 ${selected ? "text-primary" : ""}`}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">{item.label}</span>
                <span className="mt-0.5 hidden text-[10px] leading-snug text-muted lg:block">
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-w-0 lg:mt-0">
        <div className="mb-3 hidden items-baseline justify-between gap-3 lg:flex">
          <h2 className="text-[15px] font-medium text-foreground">{active?.label}</h2>
          <p className="text-[11px] text-muted">{active?.description}</p>
        </div>
        {tab === "provider" && <ProviderSettings />}
        {tab === "image" && <ImageSettings />}
        {tab === "chat" && <FeatureSettings />}
        {tab === "skills" && <SkillsSettings />}
        {tab === "commands" && <CommandCatalog />}
      </div>
    </div>
  );
}

function SkillsSettings() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchFeatureSettings();
      setSkills(data.skills);
      setCounts(data.skill_counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat skill.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="text-[12px] text-danger">
        {error}
      </p>
    );
  }
  if (!skills) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Memuat skill...
      </div>
    );
  }
  return <SkillManager skills={skills} counts={counts} onRefresh={load} />;
}

function CommandCatalog() {
  const [commands, setCommands] = useState<
    Partial<Record<ChatModeId, ChatCommand[]>> | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchChatSettings()
      .then((data) => setCommands(data.commands))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Gagal memuat command."),
      );
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-[12px] text-danger">
        {error}
      </p>
    );
  }
  if (!commands) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Memuat command...
      </div>
    );
  }

  const entries = Object.entries(commands).filter(
    ([, list]) => (list?.length ?? 0) > 0,
  );

  return (
    <div>
      <p className="mb-3 text-[12px] text-muted">
        Slash command dipakai saat mengetik <code>/</code> di chat. Command hanya
        aktif untuk mode pemiliknya.
      </p>
      {entries.length === 0 && (
        <p className="text-[12px] text-muted">Belum ada command.</p>
      )}
      <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {entries.map(([mode, list]) => (
          <div
            key={mode}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <h3 className="flex items-center justify-between gap-2 text-[12px] font-medium text-foreground">
              {labelForMode(mode)}
              <span className="text-[10px] font-normal text-muted">
                {(list ?? []).length} command
              </span>
            </h3>
            <ul className="mt-2 space-y-1.5">
              {(list ?? []).map((command) => (
                <li key={command.id} className="flex flex-wrap items-baseline gap-2">
                  <code className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground">
                    /{command.id}
                  </code>
                  <span className="text-[11px] text-muted">
                    {command.description}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function labelForMode(mode: string): string {
  try {
    return getChatMode(mode).label;
  } catch {
    return mode;
  }
}