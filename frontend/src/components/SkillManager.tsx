"use client";

import { useState } from "react";
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { SkillPreview } from "@/components/SkillPreview";
import {
  createSkill,
  deleteSkill,
  fetchSkill,
  parseSkillMd,
  updateSkill,
  type Skill,
  type SkillInput,
  type SkillSource,
  type SkillStatus,
  type SkillSummary,
} from "@/lib/api";

type FormState = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  source: SkillSource;
  license: string;
  status: SkillStatus;
  content: string;
};

const STATUS_ORDER: SkillStatus[] = ["active", "draft", "disabled"];
const STATUS_LABEL: Record<SkillStatus, string> = {
  active: "Aktif",
  draft: "Draft",
  disabled: "Nonaktif",
};
const SOURCES: SkillSource[] = ["custom", "imported", "ai_generated"];

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    slug: "",
    description: "",
    category: "general",
    version: "1",
    source: "custom",
    license: "",
    status: "active",
    content: "",
  };
}

function formFromSkill(skill: Skill): FormState {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    source: skill.source,
    license: skill.license,
    status: skill.status,
    content: skill.content,
  };
}

export function SkillManager({
  skills,
  counts,
  onRefresh,
}: {
  skills: SkillSummary[];
  counts: Record<string, number>;
  onRefresh: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [pasted, setPasted] = useState("");
  const [mode, setMode] = useState<"manual" | "paste">("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<SkillStatus | "">("");

  const visible = filter ? skills.filter((s) => s.status === filter) : skills;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleParse() {
    if (!form) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const parsed = await parseSkillMd(pasted, form.name);
      setForm((prev) =>
        prev
          ? {
              ...prev,
              name: parsed.name,
              slug: parsed.slug,
              description: parsed.description || prev.description,
              license: parsed.license || prev.license,
              content: parsed.content,
            }
          : prev,
      );
      setNotice("SKILL.md berhasil diparse. Periksa lalu simpan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memparse SKILL.md.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!form) return;
    if (!form.name.trim() || !form.content.trim()) {
      setError("Nama dan konten wajib diisi.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: SkillInput = {
        name: form.name,
        slug: form.slug || undefined,
        description: form.description,
        category: form.category,
        version: form.version,
        source: form.source,
        license: form.license,
        status: form.status,
        content: form.content,
      };
      if (form.id) {
        await updateSkill(form.id, payload);
      } else {
        await createSkill(payload);
      }
      await onRefresh();
      setForm(null);
      setPasted("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan skill.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus(skill: SkillSummary) {
    setError(null);
    try {
      const next: SkillStatus = skill.status === "active" ? "disabled" : "active";
      await updateSkill(skill.id, { status: next });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status.");
    }
  }

  async function handleEdit(skill: SkillSummary) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const full = await fetchSkill(skill.id);
      setForm(formFromSkill(full));
      setMode("manual");
      setPasted("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat skill.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(skill: SkillSummary) {
    const affected = counts[skill.slug];
    const detail = affected
      ? `\nSkill ini ter-assign ke ${affected} fitur; pemakaiannya akan hilang.`
      : "";
    if (!window.confirm(`Hapus skill "${skill.name}"?${detail}`)) return;
    setError(null);
    try {
      await deleteSkill(skill.id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus skill.");
    }
  }

  return (
    <section>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText size={16} aria-hidden className="text-muted" />
          <h2 className="text-sm font-medium">Kelola Skill</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as SkillStatus | "")
            }
            aria-label="Filter status skill"
            className="h-8 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-foreground/40"
          >
            <option value="">Semua status</option>
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm());
              setMode("manual");
              setPasted("");
              setError(null);
              setNotice(null);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
          >
            <Plus size={13} aria-hidden />
            Skill baru
          </button>
        </div>
      </header>
      <p className="mt-1 text-[12px] text-muted">
        Skill adalah konten Markdown dengan metadata. Skill aktif yang
        di-assign ke fitur akan dimuat ke prompt. Konten hanya teks dan tidak
        dieksekusi.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {error}
        </p>
      )}
      {notice && <p className="mt-2 text-[12px] text-muted">{notice}</p>}

      {form && (
        <SkillForm
          form={form}
          mode={mode}
          pasted={pasted}
          busy={busy}
          onMode={setMode}
          onPasted={setPasted}
          onParse={handleParse}
          onChange={update}
          onSubmit={handleSubmit}
          onCancel={() => setForm(null)}
        />
      )}

      <ul className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {visible.length === 0 && (
          <li className="rounded-lg border border-border bg-surface px-4 py-3 text-[12px] text-muted">
            Belum ada skill.
          </li>
        )}
        {visible.map((skill) => (
          <li
            key={skill.id}
            className="rounded-lg border border-border bg-surface"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium text-foreground">
                    {skill.name}
                  </span>
                  <span className="rounded border border-border px-1 text-[10px] text-muted">
                    {skill.category}
                  </span>
                  <span
                    className={`rounded border px-1 text-[10px] ${
                      skill.status === "active"
                        ? "border-border text-foreground"
                        : "border-border text-muted"
                    }`}
                  >
                    {STATUS_LABEL[skill.status]}
                  </span>
                  <span className="text-[10px] text-muted">v{skill.version}</span>
                  {counts[skill.slug] ? (
                    <span className="text-[10px] text-muted">
                      {counts[skill.slug]} fitur
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[11px] text-muted">
                  {skill.description || skill.slug}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleToggleStatus(skill)}
                  className="rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                >
                  {skill.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${skill.name}`}
                  onClick={() => void handleEdit(skill)}
                  className="rounded-md p-1.5 text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                >
                  <Pencil size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Hapus ${skill.name}`}
                  onClick={() => void handleDelete(skill)}
                  className="rounded-md p-1.5 text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkillForm({
  form,
  mode,
  pasted,
  busy,
  onMode,
  onPasted,
  onParse,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: FormState;
  mode: "manual" | "paste";
  pasted: string;
  busy: boolean;
  onMode: (mode: "manual" | "paste") => void;
  onPasted: (value: string) => void;
  onParse: () => void;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const field =
    "mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";
  const label = "block text-[11px] uppercase tracking-wide text-muted";

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] uppercase tracking-wide text-muted">
          {form.id ? "Edit skill" : "Skill baru"}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Tutup formulir"
          className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        {(["manual", "paste"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-150 ${
              mode === value
                ? "border-foreground/40 bg-surface-muted text-foreground"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {value === "manual" ? "Manual" : "Tempel SKILL.md"}
          </button>
        ))}
      </div>

      {mode === "paste" && (
        <div className="mt-3">
          <label className={label} htmlFor="skill-raw">
            SKILL.md (frontmatter + Markdown)
          </label>
          <textarea
            id="skill-raw"
            value={pasted}
            onChange={(event) => onPasted(event.target.value)}
            rows={6}
            placeholder={"---\nname: Nama Skill\ndescription: ...\n---\n\n# Konten"}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
          />
          <button
            type="button"
            onClick={onParse}
            disabled={busy || !pasted.trim()}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={13} aria-hidden className="animate-spin" />
            ) : (
              <Wand2 size={13} aria-hidden />
            )}
            Parse
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="skill-name">
            Nama
          </label>
          <input
            id="skill-name"
            value={form.name}
            maxLength={120}
            onChange={(event) => onChange("name", event.target.value)}
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="skill-slug">
            Slug
          </label>
          <input
            id="skill-slug"
            value={form.slug}
            maxLength={80}
            onChange={(event) => onChange("slug", event.target.value)}
            placeholder="otomatis dari nama"
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="skill-category">
            Kategori
          </label>
          <input
            id="skill-category"
            value={form.category}
            maxLength={60}
            onChange={(event) => onChange("category", event.target.value)}
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="skill-version">
            Versi
          </label>
          <input
            id="skill-version"
            value={form.version}
            maxLength={20}
            onChange={(event) => onChange("version", event.target.value)}
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="skill-source">
            Sumber
          </label>
          <select
            id="skill-source"
            value={form.source}
            onChange={(event) =>
              onChange("source", event.target.value as SkillSource)
            }
            className={field}
          >
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="skill-status">
            Status
          </label>
          <select
            id="skill-status"
            value={form.status}
            onChange={(event) =>
              onChange("status", event.target.value as SkillStatus)
            }
            className={field}
          >
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="skill-license">
            Lisensi
          </label>
          <input
            id="skill-license"
            value={form.license}
            maxLength={120}
            onChange={(event) => onChange("license", event.target.value)}
            className={field}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className={label} htmlFor="skill-description">
          Deskripsi
        </label>
        <input
          id="skill-description"
          value={form.description}
          maxLength={500}
          onChange={(event) => onChange("description", event.target.value)}
          className={field}
        />
      </div>

      <div className="mt-3">
        <label className={label} htmlFor="skill-content">
          Konten (Markdown)
        </label>
        <textarea
          id="skill-content"
          value={form.content}
          onChange={(event) => onChange("content", event.target.value)}
          rows={8}
          maxLength={40000}
          placeholder="# Ringkasan&#10;&#10;## Kapan dipakai&#10;..."
          className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
        />
      </div>

      {form.content && (
        <div className="mt-3">
          <p className={label}>Pratinjau</p>
          <div className="mt-1">
            <SkillPreview content={form.content} />
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Menyimpan..." : form.id ? "Perbarui" : "Simpan"}
        </button>
      </div>
    </div>
  );
}
