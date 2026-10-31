"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  fetchFeatureSettings,
  saveCrawlSettings,
  saveFeatureSettings,
  type CrawlProviderId,
  type FeatureCatalogEntry,
  type FeatureSelection,
  type FeatureSettings,
  type SkillSummary,
} from "@/lib/api";
import { LoadingState } from "@/components/ui/LoadingState";
import { SkillManager } from "@/components/SkillManager";
import { SkillPicker } from "@/components/SkillPicker";
import { getChatMode } from "@/lib/chatModes";

type Drafts = Record<string, FeatureSelection>;
type SkillDrafts = Record<string, string[]>;

const MODE_IDS = ["general", "curhat", "brainstorming", "document", "research"];

function emptySelection(): FeatureSelection {
  return { roles: "", skills: "", instruction: "", behavior: "" };
}

function chatFeatureId(feature: string): string | null {
  return feature.startsWith("chat:") ? feature.slice(5) : null;
}

function featureTitle(entry: FeatureCatalogEntry): { label: string; tagline: string } {
  const mode = chatFeatureId(entry.id);
  if (mode && MODE_IDS.includes(mode)) {
    const config = getChatMode(mode);
    return { label: config.label, tagline: config.tagline };
  }
  return { label: entry.label, tagline: entry.description };
}

export function FeatureSettings() {
  const [data, setData] = useState<FeatureSettings | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [skillDrafts, setSkillDrafts] = useState<SkillDrafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFeature, setOpenFeature] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [savingCrawl, setSavingCrawl] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchFeatureSettings();
    setData(result);
    setDrafts(
      Object.fromEntries(
        result.features.map((entry) => [entry.id, entry.selected]),
      ),
    );
    setSkillDrafts({ ...result.assignments });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Gagal memuat pengaturan."),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const groups = useMemo(() => {
    if (!data) return [] as { name: string; features: FeatureCatalogEntry[] }[];
    const map = new Map<string, FeatureCatalogEntry[]>();
    for (const entry of data.features) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()].map(([name, features]) => ({ name, features }));
  }, [data]);

  function patch(feature: string, changes: Partial<FeatureSelection>) {
    setDrafts((prev) => ({
      ...prev,
      [feature]: { ...(prev[feature] ?? emptySelection()), ...changes },
    }));
    setSaved(null);
  }

  function patchSkills(feature: string, ids: string[]) {
    setSkillDrafts((prev) => ({ ...prev, [feature]: ids }));
    setSaved(null);
  }

  async function handleSave(entry: FeatureCatalogEntry) {
    const draft = drafts[entry.id] ?? emptySelection();
    setSaving(entry.id);
    setError(null);
    try {
      const result = await saveFeatureSettings({
        feature: entry.id,
        roles: draft.roles,
        skills: draft.skills,
        instruction: draft.instruction,
        behavior: draft.behavior,
        skill_ids: skillDrafts[entry.id] ?? [],
      });
      setDrafts((prev) => ({ ...prev, [entry.id]: result.selected }));
      setSkillDrafts((prev) => ({ ...prev, [entry.id]: result.skill_ids }));
      setSaved(entry.id);
      window.setTimeout(
        () => setSaved((current) => (current === entry.id ? null : current)),
        2000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveCrawl(provider: CrawlProviderId) {
    if (!data?.crawl || data.crawl.provider === provider) return;
    setSavingCrawl(true);
    setError(null);
    try {
      const crawl = await saveCrawlSettings({ provider });
      setData((prev) => (prev ? { ...prev, crawl } : prev));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan pengaturan crawl.",
      );
    } finally {
      setSavingCrawl(false);
    }
  }

  return (
    <section>
      <header className="flex items-center gap-2">
        <SlidersHorizontal size={16} aria-hidden className="text-muted" />
        <h2 className="text-sm font-medium">Peran, skill &amp; instruksi per fitur</h2>
      </header>
      <p className="mt-1 text-[12px] text-muted">
        Isi peran lewat field teks, pilih skill terstruktur, dan tambahkan
        instruksi per fitur. Perubahan berlaku pada balasan berikutnya.
      </p>

      {loading && (
        <LoadingState
          label="Memuat pengaturan..."
          variant="cards"
          rows={4}
          className="mt-4"
        />
      )}

      {error && (
        <p role="alert" className="mt-4 text-[12px] text-danger">
          {error}
        </p>
      )}

      {data?.crawl && <CrawlCard data={data} saving={savingCrawl} onSave={handleSaveCrawl} />}

      <div className="mt-4 grid items-start gap-5 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.name}>
            <h3 className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted">
              {group.name}
              <span className="font-normal normal-case tracking-normal">
                {group.features.length} fitur
              </span>
            </h3>
            <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
              {group.features.map((entry, index) => (
                <li key={entry.id} className={index > 0 ? "border-t border-border" : ""}>
                  <FeatureRow
                    entry={entry}
                    open={openFeature === entry.id}
                    draft={drafts[entry.id] ?? emptySelection()}
                    skillIds={skillDrafts[entry.id] ?? []}
                    skills={data?.skills ?? []}
                    saving={saving === entry.id}
                    saved={saved === entry.id}
                    onToggle={() =>
                      setOpenFeature((current) =>
                        current === entry.id ? null : entry.id,
                      )
                    }
                    onPatch={(changes) => patch(entry.id, changes)}
                    onPatchSkills={(ids) => patchSkills(entry.id, ids)}
                    onSave={() => void handleSave(entry)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {data && Object.keys(data.commands).length > 0 && (
        <CommandSummary commands={data.commands} />
      )}

      {data && (
        <div className="mt-8 border-t border-border pt-6">
          <SkillManager
            skills={data.skills}
            counts={data.skill_counts}
            onRefresh={load}
          />
        </div>
      )}
    </section>
  );
}

function CrawlCard({
  data,
  saving,
  onSave,
}: {
  data: FeatureSettings;
  saving: boolean;
  onSave: (provider: CrawlProviderId) => void;
}) {
  const crawl = data.crawl;
  if (!crawl) return null;
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] uppercase tracking-wide text-muted">
          Provider crawl
        </h3>
        {crawl.provider === "firecrawl" && (
          <span className="text-[11px] text-muted">
            Kuota: {crawl.daily_used}/{crawl.daily_limit} hari ini &middot;{" "}
            {crawl.monthly_used}/{crawl.monthly_limit} bulan ini
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Dipakai untuk Riset Web dan crawl lowongan. Parser bawaan gratis dan
        privat; Firecrawl menangani halaman berat JavaScript. Kunci hanya di
        server.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            { id: "httpx", label: "Parser bawaan (httpx)" },
            { id: "firecrawl", label: "Firecrawl" },
          ] as { id: CrawlProviderId; label: string }[]
        ).map((option) => {
          const selected = crawl.provider === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              disabled={saving}
              onClick={() => onSave(option.id)}
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
      {crawl.provider === "firecrawl" && !crawl.firecrawl_ready && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          Firecrawl belum dikonfigurasi di server (kunci kosong).
        </p>
      )}
    </div>
  );
}

function FeatureRow({
  entry,
  open,
  draft,
  skillIds,
  skills,
  saving,
  saved,
  onToggle,
  onPatch,
  onPatchSkills,
  onSave,
}: {
  entry: FeatureCatalogEntry;
  open: boolean;
  draft: FeatureSelection;
  skillIds: string[];
  skills: SkillSummary[];
  saving: boolean;
  saved: boolean;
  onToggle: () => void;
  onPatch: (changes: Partial<FeatureSelection>) => void;
  onPatchSkills: (ids: string[]) => void;
  onSave: () => void;
}) {
  const { label, tagline } = featureTitle(entry);
  const roleListId = `roles-${entry.id}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-muted"
      >
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-muted transition-transform duration-150 ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-foreground">
            {label}
          </span>
          <span className="block truncate text-[11px] text-muted">{tagline}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <div>
            <label
              htmlFor={`roles-input-${entry.id}`}
              className="block text-[11px] uppercase tracking-wide text-muted"
            >
              Role/Peran
            </label>
            <input
              id={`roles-input-${entry.id}`}
              value={draft.roles}
              onChange={(event) => onPatch({ roles: event.target.value })}
              list={roleListId}
              maxLength={500}
              placeholder="mis. Konsultan teknis, Reviewer senior"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
            />
            <datalist id={roleListId}>
              {entry.role_suggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            {entry.role_suggestions.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Saran: {entry.role_suggestions.join(", ")}
              </p>
            )}
          </div>

          <div>
            <span className="block text-[11px] uppercase tracking-wide text-muted">
              Skill
            </span>
            <p className="mb-1 mt-0.5 text-[11px] text-muted">
              Skill aktif yang dipilih akan dimuat ke prompt fitur ini.
            </p>
            <SkillPicker
              skills={skills}
              selected={skillIds}
              onChange={onPatchSkills}
            />
          </div>

          <div>
            <label
              htmlFor={`instruction-${entry.id}`}
              className="block text-[11px] uppercase tracking-wide text-muted"
            >
              Instruksi
            </label>
            <textarea
              id={`instruction-${entry.id}`}
              value={draft.instruction}
              onChange={(event) => onPatch({ instruction: event.target.value })}
              rows={3}
              maxLength={1000}
              placeholder="Instruksi bebas untuk fitur ini, mis. selalu sertakan contoh konkret."
              className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Check size={13} aria-hidden />
                Tersimpan
              </span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandSummary({
  commands,
}: {
  commands: Partial<Record<string, { id: string; label: string }[]>>;
}) {
  const entries = Object.entries(commands).filter(
    ([, list]) => (list?.length ?? 0) > 0,
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-[12px] uppercase tracking-wide text-muted">Slash command</h3>
      <ul className="mt-2 space-y-2">
        {entries.map(([mode, list]) => (
          <li key={mode} className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-foreground">
              {MODE_IDS.includes(mode) ? getChatMode(mode).label : mode}
            </span>
            <span className="flex flex-wrap gap-1">
              {(list ?? []).map((command) => (
                <code
                  key={command.id}
                  className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted"
                >
                  /{command.id}
                </code>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}