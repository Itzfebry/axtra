"use client";

import { Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  createProject,
  deleteProject,
  indexProjectRepo,
  listProjects,
  updateProject,
  type Project,
  type ProjectStatus,
} from "@/lib/api";
import {
  PROJECT_INPUT_CLASS,
  PROJECT_LABEL_CLASS,
  PROJECT_STATUSES,
  PROJECT_STATUS_CLASSES,
  PROJECT_STATUS_LABELS,
  REPO_STATUS_LABELS,
} from "@/lib/projectMeta";

const STATUSES = PROJECT_STATUSES;
const STATUS_LABELS = PROJECT_STATUS_LABELS;
const STATUS_CLASSES = PROJECT_STATUS_CLASSES;

type Draft = {
  name: string;
  description: string;
  status: ProjectStatus;
  tech_stack: string;
  repo_url: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  status: "idea",
  tech_stack: "",
  repo_url: "",
  notes: "",
};

function DraftFields({
  value,
  onChange,
  inputClass,
  labelClass,
}: {
  value: Draft;
  onChange: (next: Draft) => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Nama proyek</label>
        <input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="Contoh: Axtra"
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={value.status}
            onChange={(event) =>
              onChange({ ...value, status: event.target.value as ProjectStatus })
            }
            className={`mt-1 ${inputClass}`}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Tech stack (pisah koma)</label>
          <input
            value={value.tech_stack}
            onChange={(event) => onChange({ ...value, tech_stack: event.target.value })}
            placeholder="Next.js, FastAPI"
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Deskripsi</label>
        <textarea
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          rows={2}
          placeholder="Tujuan dan ruang lingkup proyek."
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label className={labelClass}>URL repo (opsional)</label>
        <input
          value={value.repo_url}
          onChange={(event) => onChange({ ...value, repo_url: event.target.value })}
          placeholder="https://github.com/..."
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label className={labelClass}>Catatan / keputusan teknis</label>
        <textarea
          value={value.notes}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
          rows={3}
          placeholder="Keputusan, kendala, progres."
          className={`mt-1 ${inputClass}`}
        />
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<ProjectStatus | "">("");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  const [repoBusy, setRepoBusy] = useState<Record<string, boolean>>({});

  // After the first successful load, later search/filter/poll refreshes run
  // silently so typing in the search box never flashes "Memuat...".
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      const isSilent = silent || loadedOnce.current;
      if (!isSilent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await listProjects({ status: filter || undefined, search });
        setProjects(data ?? []);
        // Keep the stat strip stable while a filter/search is active.
        if (!filter && !search.trim()) setAllProjects(data ?? []);
        loadedOnce.current = true;
      } catch (err) {
        if (!isSilent) {
          setError(err instanceof Error ? err.message : "Gagal memuat proyek.");
        }
      } finally {
        if (!isSilent) setLoading(false);
      }
    },
    [filter, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  // Poll while any repo is queued or indexing so progress/summary update live.
  // Polling refreshes silently: the list must not unmount or flash "Memuat...".
  const indexing = projects.some(
    (project) =>
      project.repo_index_status === "pending" ||
      project.repo_index_status === "indexing",
  );
  useEffect(() => {
    if (!indexing) return;
    const timer = setInterval(() => void load(true), 3000);
    return () => clearInterval(timer);
  }, [indexing, load]);

  function toInput(source: Draft) {
    return {
      name: source.name.trim(),
      description: source.description.trim(),
      status: source.status,
      tech_stack: source.tech_stack
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      repo_url: source.repo_url.trim() || null,
      notes: source.notes.trim(),
    };
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProject(toInput(draft));
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan proyek.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditDraft({
      name: project.name,
      description: project.description,
      status: project.status,
      tech_stack: project.tech_stack.join(", "),
      repo_url: project.repo_url ?? "",
      notes: project.notes,
    });
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !editingId || !editDraft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject(editingId, toInput(editDraft));
      setProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setAllProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memperbarui proyek.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(project: Project) {
    const confirmed = window.confirm(
      `Hapus proyek "${project.name}"?\n\nTindakan ini tidak dapat dibatalkan.`,
    );
    if (!confirmed) return;
    try {
      await deleteProject(project.id);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      setAllProjects((prev) => prev.filter((item) => item.id !== project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus proyek.");
    }
  }

  async function runIndex(project: Project) {
    setRepoBusy((prev) => ({ ...prev, [project.id]: true }));
    setError(null);
    try {
      const updated = await indexProjectRepo(project.id);
      setProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setAllProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memulai indeks repo.");
    } finally {
      setRepoBusy((prev) => ({ ...prev, [project.id]: false }));
    }
  }

  const inputClass = PROJECT_INPUT_CLASS;
  const labelClass = PROJECT_LABEL_CLASS;

  const source = allProjects.length > 0 ? allProjects : projects;
  const stats = [
    { label: "Total proyek", value: source.length },
    { label: "Aktif", value: source.filter((p) => p.status === "active").length },
    {
      label: "Siap dianalisa",
      value: source.filter((p) => p.repo_index_status === "ready").length,
    },
    {
      label: "Perlu perhatian",
      value: source.filter(
        (p) =>
          p.repo_index_status === "error" ||
          p.repo_index_status === "pending" ||
          p.repo_index_status === "indexing",
      ).length,
    },
  ];

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-16 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Proyek</h1>
              <p className="mt-1 max-w-2xl text-[14px] text-muted">
                Spesifikasi, keputusan teknis, dan progres tiap proyek. Proyek juga
                terisi otomatis dari percakapan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
            >
              {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {showForm ? "Tutup" : "Tambah"}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <p className="text-[11px] text-muted">{stat.label}</p>
                <p className="mt-0.5 text-xl font-semibold tracking-tight">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {showForm && (
            <form
              onSubmit={submitCreate}
              className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3 lg:max-w-2xl"
            >
              <DraftFields
                value={draft}
                onChange={setDraft}
                inputClass={inputClass}
                labelClass={labelClass}
              />
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </form>
          )}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-2">
              <Search size={15} className="shrink-0 text-muted" aria-hidden />
              <label htmlFor="project-search" className="sr-only">
                Cari proyek
              </label>
              <input
                id="project-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari proyek"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setFilter("")}
                className={`inline-flex h-8 items-center rounded-lg border px-3 text-[12px] transition-colors duration-150 ${
                  filter === ""
                    ? "border-foreground/40 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                Semua
              </button>
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilter(status)}
                  className={`inline-flex h-8 items-center rounded-lg border px-3 text-[12px] transition-colors duration-150 ${
                    filter === status
                      ? "border-foreground/40 text-foreground"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {loading ? (
              <LoadingState label="Memuat proyek..." variant="cards" rows={4} className="xl:col-span-2" />
            ) : projects.length === 0 ? (
              <p className="text-[14px] text-muted xl:col-span-2">
                Belum ada proyek. Tambahkan manual atau sebutkan proyek di percakapan.
              </p>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  className="flex h-full flex-col rounded-lg border border-border bg-surface p-3"
                >
                  {editingId === project.id ? (
                    <form onSubmit={submitEdit} className="space-y-3">
                      <DraftFields
                        value={editDraft}
                        onChange={setEditDraft}
                        inputClass={inputClass}
                        labelClass={labelClass}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                        >
                          {saving ? "Menyimpan..." : "Simpan"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/projects/${project.id}`}
                              className="text-[15px] font-semibold hover:underline"
                            >
                              {project.name}
                            </Link>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASSES[project.status]}`}
                            >
                              {STATUS_LABELS[project.status]}
                            </span>
                            {project.source === "chat" && (
                              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                                dari chat
                              </span>
                            )}
                          </div>
                          {project.description && (
                            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[14px] text-foreground/90">
                              {project.description}
                            </p>
                          )}
                          {project.tech_stack.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {project.tech_stack.map((tech) => (
                                <span
                                  key={tech}
                                  className="rounded-md bg-surface-muted px-2 py-0.5 text-[11px] text-muted"
                                >
                                  {tech}
                                </span>
                              ))}
                            </div>
                          )}
                          {project.repo_url && (
                            <a
                              href={project.repo_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-block text-[12px] text-foreground underline underline-offset-2"
                            >
                              {project.repo_url}
                            </a>
                          )}
                          {project.notes && (
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12px] text-muted">
                              {project.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(project)}
                            className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                          >
                            Ubah
                          </button>
                          <button
                            type="button"
                            aria-label="Hapus proyek"
                            onClick={() => void remove(project)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </div>
                      </div>

                      {project.repo_url && (
                        <div className="mt-3 border-t border-border pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-medium">Analisa repo</span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                              {REPO_STATUS_LABELS[project.repo_index_status]}
                            </span>
                            {project.repo_index_status === "ready" && (
                              <span className="text-[11px] text-muted">
                                {project.repo_file_count} file · {project.repo_chunk_count} chunk
                              </span>
                            )}
                            <div className="flex-1" />
                            <button
                              type="button"
                              disabled={
                                Boolean(repoBusy[project.id]) ||
                                project.repo_index_status === "pending" ||
                                project.repo_index_status === "indexing"
                              }
                              onClick={() => void runIndex(project)}
                              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                            >
                              {project.repo_index_status === "ready" ? "Index ulang" : "Index repo"}
                            </button>
                            <Link
                              href={`/projects/${project.id}`}
                              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                            >
                              Detail
                            </Link>
                          </div>

                          {(project.repo_index_status === "pending" ||
                            project.repo_index_status === "indexing") && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-[11px] text-muted">
                                <span>{project.repo_index_stage ?? "mengindeks"}</span>
                                <span>{project.repo_index_progress}%</span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                                <div
                                  className="h-full rounded-full bg-foreground transition-[width] duration-500"
                                  style={{ width: `${project.repo_index_progress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {project.repo_index_error && (
                            <p
                              role="alert"
                              className="mt-2 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
                            >
                              {project.repo_index_error}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
