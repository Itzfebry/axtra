"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import {
  fetchChatSettings,
  saveChatSettings,
  saveCrawlSettings,
  type ChatModeId,
  type ChatSettings,
  type CrawlProviderId,
  type ModeSelection,
} from "@/lib/api";
import { LoadingState } from "@/components/ui/LoadingState";
import { getChatMode } from "@/lib/chatModes";

type Drafts = Record<ChatModeId, ModeSelection>;

function emptyDrafts(): Drafts {
  return {
    general: { roles: [], role_note: "", behavior: "" },
    curhat: { roles: [], role_note: "", behavior: "" },
    brainstorming: { roles: [], role_note: "", behavior: "" },
    document: { roles: [], role_note: "", behavior: "" },
    research: { roles: [], role_note: "", behavior: "" },
  };
}

export function ModeSettings() {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ChatModeId | null>(null);
  const [saved, setSaved] = useState<ChatModeId | null>(null);
  const [savingCrawl, setSavingCrawl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchChatSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setDrafts(data.selected);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Gagal memuat pengaturan."),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commandSummary = useMemo(() => {
    if (!settings) return [] as { mode: ChatModeId; labels: string[] }[];
    return (Object.keys(settings.commands) as ChatModeId[]).map((mode) => ({
      mode,
      labels: (settings.commands[mode] ?? []).map((command) => `/${command.id}`),
    }));
  }, [settings]);

  function patch(mode: ChatModeId, changes: Partial<ModeSelection>) {
    setDrafts((prev) => ({ ...prev, [mode]: { ...prev[mode], ...changes } }));
    setSaved(null);
  }

  function toggleRole(mode: ChatModeId, roleId: string) {
    const current = drafts[mode].roles;
    const selected = current.includes(roleId);
    // Keep at least one role selected.
    if (selected && current.length <= 1) return;
    const next = selected
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    patch(mode, { roles: next });
  }

  async function handleSave(mode: ChatModeId) {
    const draft = drafts[mode];
    if (!draft) return;
    setSaving(mode);
    setError(null);
    try {
      const data = await saveChatSettings({
        mode,
        roles: draft.roles,
        behavior: draft.behavior,
        role_note: draft.role_note,
      });
      setSettings(data);
      // Merge only the saved mode so unsaved edits in other modes survive.
      setDrafts((prev) => ({ ...prev, [mode]: data.selected[mode] ?? prev[mode] }));
      setSaved(mode);
      window.setTimeout(() => setSaved((current) => (current === mode ? null : current)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveCrawl(provider: CrawlProviderId) {
    if (!settings?.crawl || settings.crawl.provider === provider) return;
    setSavingCrawl(true);
    setError(null);
    try {
      const crawl = await saveCrawlSettings({ provider });
      setSettings((prev) => (prev ? { ...prev, crawl } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan crawl.");
    } finally {
      setSavingCrawl(false);
    }
  }

  return (
    <section>
      <header className="flex items-center gap-2">
        <SlidersHorizontal size={16} aria-hidden className="text-muted" />
        <h2 className="text-sm font-medium">Pengaturan fitur &amp; mode</h2>
      </header>
      <p className="mt-1 max-w-2xl text-[12px] text-muted">
        Pilih satu atau beberapa peran Axtra untuk tiap mode (multi-pilih) dan atur
        alur perilakunya. Perubahan berlaku pada balasan berikutnya.
      </p>

      {loading && (
        <LoadingState label="Memuat pengaturan..." variant="cards" rows={4} className="mt-4" />
      )}

      {error && (
        <p role="alert" className="mt-4 text-[12px] text-danger">
          {error}
        </p>
      )}

      {settings?.crawl && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] uppercase tracking-wide text-muted">
              Provider crawl
            </h3>
            {settings.crawl.provider === "firecrawl" && (
              <span className="text-[11px] text-muted">
                Kuota Firecrawl: {settings.crawl.daily_used}/{settings.crawl.daily_limit} hari
                ini &middot; {settings.crawl.monthly_used}/{settings.crawl.monthly_limit} bulan ini
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[12px] text-muted">
            Dipakai untuk Riset Web dan crawl lowongan. Parser bawaan gratis dan
            privat; Firecrawl mengambil halaman berat JavaScript dengan kualitas
            teks lebih baik. Kunci Firecrawl hanya tersimpan di server.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                { id: "httpx", label: "Parser bawaan (httpx)" },
                { id: "firecrawl", label: "Firecrawl" },
              ] as { id: CrawlProviderId; label: string }[]
            ).map((option) => {
              const selected = settings.crawl?.provider === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={savingCrawl}
                  onClick={() => void handleSaveCrawl(option.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 disabled:opacity-60 ${
                    selected
                      ? "border-foreground/40 bg-surface-muted text-foreground"
                      : "border-border text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  {selected && <Check size={12} aria-hidden />}
                  {option.label}
                </button>
              );
            })}
          </div>
          {settings.crawl.provider === "firecrawl" && !settings.crawl.firecrawl_ready && (
            <p role="alert" className="mt-2 text-[11px] text-danger">
              Firecrawl belum dikonfigurasi di server (kunci kosong). Crawl akan
              memakai parser bawaan sampai kunci diisi.
            </p>
          )}
        </div>
      )}

      {settings && (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.modes.map((entry) => {
            const config = getChatMode(entry.id);
            const Icon = config.icon;
            const draft =
              drafts[entry.id] ?? { roles: [], role_note: "", behavior: "" };
            const behaviorPreset = entry.behaviors.find(
              (behavior) => behavior.id === draft.behavior,
            );
            return (
              <li
                key={entry.id}
                className="flex flex-col rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                    <Icon size={16} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">{config.label}</h3>
                    <p className="truncate text-[11px] text-muted">{config.tagline}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    Peran Axtra
                  </span>
                  <span className="text-[11px] text-muted">
                    {draft.roles.length} dipilih
                  </span>
                </div>
                <div
                  role="group"
                  aria-label={`Peran Axtra untuk mode ${config.label}`}
                  className="mt-1.5 flex flex-wrap gap-1.5"
                >
                  {entry.roles.map((role) => {
                    const selected = draft.roles.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        title={role.description}
                        aria-pressed={selected}
                        onClick={() => toggleRole(entry.id, role.id)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                          selected
                            ? "border-foreground/40 bg-surface-muted text-foreground"
                            : "border-border text-muted hover:bg-surface-muted hover:text-foreground"
                        }`}
                      >
                        {selected && <Check size={12} aria-hidden />}
                        {role.label}
                      </button>
                    );
                  })}
                </div>

                <label
                  htmlFor={`behavior-${entry.id}`}
                  className="mt-3 text-[11px] uppercase tracking-wide text-muted"
                >
                  Alur perilaku
                </label>
                <select
                  id={`behavior-${entry.id}`}
                  value={draft.behavior}
                  onChange={(event) => patch(entry.id, { behavior: event.target.value })}
                  className="mt-1 h-9 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
                >
                  {entry.behaviors.map((behavior) => (
                    <option key={behavior.id} value={behavior.id}>
                      {behavior.label}
                    </option>
                  ))}
                </select>
                {behaviorPreset?.steps && behaviorPreset.steps.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {behaviorPreset.steps.map((step, index) => (
                      <span key={step} className="flex items-center gap-1">
                        {index > 0 && <span className="text-[11px] text-muted">→</span>}
                        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                          {step}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                <label
                  htmlFor={`note-${entry.id}`}
                  className="mt-3 text-[11px] uppercase tracking-wide text-muted"
                >
                  Catatan peran (opsional)
                </label>
                <textarea
                  id={`note-${entry.id}`}
                  value={draft.role_note}
                  onChange={(event) => patch(entry.id, { role_note: event.target.value })}
                  rows={2}
                  maxLength={500}
                  placeholder="Tambahan gaya atau batasan khusus..."
                  className="mt-1 resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
                />

                <div className="mt-3 flex items-center justify-end gap-2">
                  {saved === entry.id && (
                    <span className="flex items-center gap-1 text-[11px] text-muted">
                      <Check size={13} aria-hidden />
                      Tersimpan
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSave(entry.id)}
                    disabled={saving === entry.id || draft.roles.length === 0}
                    className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                  >
                    {saving === entry.id ? "Menyimpan..." : "Simpan"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {commandSummary.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-[12px] uppercase tracking-wide text-muted">Slash command</h3>
          <ul className="mt-2 space-y-2">
            {commandSummary.map(({ mode, labels }) => (
              <li key={mode} className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-foreground">
                  {getChatMode(mode).label}
                </span>
                <span className="flex flex-wrap gap-1">
                  {labels.map((label) => (
                    <code
                      key={label}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted"
                    >
                      {label}
                    </code>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            Ketik <code className="rounded border border-border px-1 py-0.5">/</code> di
            composer saat berada pada mode terkait untuk memilih command.
          </p>
        </div>
      )}
    </section>
  );
}
