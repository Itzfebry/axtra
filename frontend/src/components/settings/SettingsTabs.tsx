"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FeatureSettings } from "@/components/FeatureSettings";
import { SkillManager } from "@/components/SkillManager";
import { ProviderSettings } from "@/components/settings/ProviderSettings";
import { fetchChatSettings, fetchFeatureSettings } from "@/lib/api";
import type { ChatCommand, ChatModeId, SkillSummary } from "@/lib/api";
import { getChatMode } from "@/lib/chatModes";

type TabId = "provider" | "chat" | "skills" | "commands";

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: "provider",
    label: "Provider",
    description: "API key, model, koneksi, dan kuota.",
  },
  {
    id: "chat",
    label: "Chat & fitur",
    description: "Peran, perilaku, dan skill per mode.",
  },
  {
    id: "skills",
    label: "Skills",
    description: "Kelola pustaka skill.",
  },
  {
    id: "commands",
    label: "Slash command",
    description: "Daftar command per mode.",
  },
];

export function SettingsTabs() {
  const [tab, setTab] = useState<TabId>("provider");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Bagian pengaturan"
        className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5"
      >
        {TABS.map((item) => {
          const selected = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-2 text-left transition-colors duration-150 ${
                selected
                  ? "bg-primary/10 text-foreground"
                  : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <span className="block text-[12px] font-medium">{item.label}</span>
              <span className="hidden text-[10px] text-muted sm:block">
                {item.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "provider" && <ProviderSettings />}
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
    <div className="space-y-3">
      <p className="text-[12px] text-muted">
        Slash command dipakai saat mengetik <code>/</code> di chat. Command hanya
        aktif untuk mode pemiliknya.
      </p>
      {entries.length === 0 && (
        <p className="text-[12px] text-muted">Belum ada command.</p>
      )}
      {entries.map(([mode, list]) => (
        <div
          key={mode}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <h3 className="text-[12px] font-medium text-foreground">
            {labelForMode(mode)}
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
  );
}

function labelForMode(mode: string): string {
  try {
    return getChatMode(mode).label;
  } catch {
    return mode;
  }
}