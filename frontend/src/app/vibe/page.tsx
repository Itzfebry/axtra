"use client";

import { Calendar, Code2, GitBranch, Layers, Plus, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TechChip } from "@/components/TechChip";
import { LoadingState } from "@/components/ui/LoadingState";
import { createProject, listProjects, type Project } from "@/lib/api";
import {
  PROJECT_INPUT_CLASS,
  PROJECT_LABEL_CLASS,
  PROJECT_STATUS_CLASSES,
  PROJECT_STATUS_LABELS,
  REPO_STATUS_LABELS,
} from "@/lib/projectMeta";

const EMPTY_DRAFT = { name: "", description: "", labels: "" };

function formatCreated(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function VibeHubPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects((await listProjects()) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat proyek.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    if (!draft.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: draft.name.trim(),
        description: draft.description.trim(),
        labels: draft.labels
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      router.push(`/projects/${project.id}/vibe`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat proyek.");
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-16 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight font-brand">Vibe Coding</h1>
              <p className="mt-1 max-w-2xl text-[14px] italic text-muted">
                Ubah ide menjadi spesifikasi tervalidasi, rencana task, dan prompt
                untuk agen coding eksternal. Pilih proyek, atau buat baru untuk mulai
                dari nol.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-black transition-opacity duration-150 hover:opacity-90"
            >
              {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {showForm ? "Tutup" : "Proyek baru"}
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={create}
              className="mt-5 space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <p className="text-[12px] text-muted">
                Buat proyek kosong, lalu langsung masuk ke workspace Vibe Coding-nya.
              </p>
              <div>
                <label className={PROJECT_LABEL_CLASS} htmlFor="vibe-project-name">
                  Nama proyek
                </label>
                <input
                  id="vibe-project-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Contoh: Aplikasi catatan"
                  className={`mt-1 ${PROJECT_INPUT_CLASS}`}
                />
              </div>
              <div>
                <label className={PROJECT_LABEL_CLASS} htmlFor="vibe-project-desc">
                  Deskripsi (opsional)
                </label>
                <textarea
                  id="vibe-project-desc"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                  rows={2}
                  placeholder="Satu-dua kalimat tentang apa yang ingin dibangun."
                  className={`mt-1 ${PROJECT_INPUT_CLASS}`}
                />
              </div>
              <div>
                <label className={PROJECT_LABEL_CLASS} htmlFor="vibe-project-labels">
                  Label proyek (pisah koma, opsional)
                </label>
                <input
                  id="vibe-project-labels"
                  value={draft.labels}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, labels: event.target.value }))
                  }
                  placeholder="Landing page, CRUD"
                  className={`mt-1 ${PROJECT_INPUT_CLASS}`}
                />
              </div>
              <button
                type="submit"
                disabled={creating || !draft.name.trim()}
                className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-[13px] font-medium text-black transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {creating ? "Membuat..." : "Buat proyek & mulai"}
              </button>
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          )}

          <div className="mt-6">
            {loading ? (
              <LoadingState label="Memuat proyek..." variant="cards" rows={3} />
            ) : projects.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface px-4 py-6">
                <Code2 size={18} className="text-muted" aria-hidden />
                <p className="mt-2 text-[14px] font-medium">Belum ada proyek.</p>
                <p className="mt-1 max-w-xl text-[13px] text-muted">
                  Klik “Proyek baru” di atas untuk membuat proyek kosong dan langsung
                  memulai Vibe Coding.
                </p>
              </div>
            ) : (
              <ul className="grid auto-rows-fr grid-cols-1 gap-3 lg:grid-cols-2">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors duration-150 hover:border-foreground/25"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${project.id}/vibe`}
                          className="block text-[20px] font-semibold leading-tight tracking-tight hover:underline"
                        >
                          {project.name}
                        </Link>
                        {formatCreated(project.created_at) && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                            <Calendar size={11} aria-hidden />
                            Dibuat {formatCreated(project.created_at)}
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${PROJECT_STATUS_CLASSES[project.status]}`}
                      >
                        {PROJECT_STATUS_LABELS[project.status]}
                      </span>
                    </div>
                    {project.description && (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-snug text-muted">
                        {project.description}
                      </p>
                    )}

                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <section>
                        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                          <GitBranch size={12} aria-hidden className="text-muted" />
                          Repo
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {project.repo_full_name || project.repo_url ? (
                            <a
                              href={project.repo_url ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-[12px] font-medium text-foreground underline underline-offset-2"
                            >
                              {project.repo_full_name ?? project.repo_url}
                            </a>
                          ) : (
                            <span className="text-[12px] text-muted">Belum ada repo</span>
                          )}
                          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10px] text-muted">
                            {REPO_STATUS_LABELS[project.repo_index_status]}
                          </span>
                          {project.repo_index_status === "ready" && (
                            <span className="text-[11px] text-muted">
                              {project.repo_file_count} file · {project.repo_chunk_count} chunk
                            </span>
                          )}
                        </div>
                        {project.repo_index_error && (
                          <p className="mt-1.5 rounded-md border border-danger/40 bg-danger/5 px-2 py-1 text-[11px] text-danger">
                            {project.repo_index_error}
                          </p>
                        )}
                      </section>

                      <section>
                        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                          <Layers size={12} aria-hidden className="text-muted" />
                          Tech stack
                        </h3>
                        {project.tech_stack.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {project.tech_stack.map((tech) => (
                              <TechChip key={tech} name={tech} />
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[12px] text-muted">Belum ada data</p>
                        )}
                      </section>

                      <section>
                        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                          <Tag size={12} aria-hidden className="text-muted" />
                          Slug
                        </h3>
                        {project.labels.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {project.labels.map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[12px] text-muted">Belum ada slug</p>
                        )}
                      </section>
                    </div>

                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                      <div className="flex-1" />
                      <Link
                        href={`/projects/${project.id}/vibe`}
                        className="inline-flex h-8 items-center rounded-lg bg-white px-2.5 text-[12px] font-medium text-black transition-opacity duration-150 hover:opacity-90"
                      >
                        Buka workspace
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
