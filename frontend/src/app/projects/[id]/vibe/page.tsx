"use client";

import { ChevronLeft, Lightbulb, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  createVibeSession,
  deleteVibeSession,
  getProject,
  listVibeSessions,
  type Project,
  type VibeSession,
} from "@/lib/api";
import { PROJECT_INPUT_CLASS, PROJECT_LABEL_CLASS } from "@/lib/projectMeta";
import { VIBE_STAGE_LABELS } from "@/lib/vibeMeta";

const EMPTY_DRAFT = {
  title: "",
  idea: "",
  problem: "",
  target_users: "",
  constraints: "",
};

function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VibeSessionsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<VibeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectData, sessionData] = await Promise.all([
        getProject(id),
        listVibeSessions(id),
      ]);
      setProject(projectData);
      setSessions(sessionData ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat Vibe Coding.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!draft.idea.trim() && !draft.problem.trim() && !draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await createVibeSession(id, {
        title: draft.title.trim(),
        idea: draft.idea.trim(),
        problem: draft.problem.trim(),
        target_users: draft.target_users.trim(),
        constraints: draft.constraints.trim(),
      });
      setSessions((prev) => [session, ...prev]);
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat workspace.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(session: VibeSession) {
    const confirmed = window.confirm(
      `Hapus workspace "${session.title}"?\n\nPercakapan, dokumen, dan rencana di dalamnya ikut terhapus.`,
    );
    if (!confirmed) return;
    setBusy((prev) => ({ ...prev, [session.id]: true }));
    setError(null);
    try {
      await deleteVibeSession(id, session.id);
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus workspace.");
    } finally {
      setBusy((prev) => ({ ...prev, [session.id]: false }));
    }
  }

  const inputClass = PROJECT_INPUT_CLASS;
  const labelClass = PROJECT_LABEL_CLASS;

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-16 lg:px-8">
          <Link
            href={`/projects/${id}`}
            className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
          >
            <ChevronLeft size={14} aria-hidden />
            {project?.name ?? "Proyek"}
          </Link>

          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight font-brand">Vibe Coding</h1>
              {project && project.labels.length > 0 && (
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
              )}
              <p className="mt-1 max-w-2xl text-[14px] italic text-muted">
                Ubah ide menjadi spesifikasi yang tervalidasi, rencana task, dan
                prompt untuk agen coding eksternal. Setiap workspace bisa dilanjutkan
                kapan saja.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-black transition-opacity duration-150 hover:opacity-90"
            >
              {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {showForm ? "Tutup" : "Ide baru"}
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={create}
              className="mt-5 space-y-3 rounded-lg border border-border bg-surface p-4"
            >
              <p className="text-[12px] text-muted">
                Cukup tulis yang sudah kamu tahu. Semua kolom boleh kosong kecuali
                minimal salah satu dari judul, ide, atau masalah.
              </p>
              <div>
                <label className={labelClass} htmlFor="vibe-title">
                  Judul workspace (opsional)
                </label>
                <input
                  id="vibe-title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Contoh: Fitur reminder tugas"
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="vibe-idea">
                  Apa yang ingin dibangun?
                </label>
                <textarea
                  id="vibe-idea"
                  value={draft.idea}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, idea: event.target.value }))
                  }
                  rows={3}
                  placeholder="Jelaskan ide fitur/produk dengan bahasa sendiri."
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="vibe-problem">
                    Masalah yang ingin dipecahkan
                  </label>
                  <textarea
                    id="vibe-problem"
                    value={draft.problem}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, problem: event.target.value }))
                    }
                    rows={2}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="vibe-users">
                    Target pengguna
                  </label>
                  <textarea
                    id="vibe-users"
                    value={draft.target_users}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, target_users: event.target.value }))
                    }
                    rows={2}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="vibe-constraints">
                  Preferensi, kendala, atau teknologi yang sudah dipilih
                </label>
                <textarea
                  id="vibe-constraints"
                  value={draft.constraints}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, constraints: event.target.value }))
                  }
                  rows={2}
                  placeholder="Contoh: harus jalan di Next.js + FastAPI, tanpa layanan berbayar."
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <button
                type="submit"
                disabled={
                  saving ||
                  (!draft.idea.trim() && !draft.problem.trim() && !draft.title.trim())
                }
                className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-[13px] font-medium text-black transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Membuat..." : "Mulai discovery"}
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
              <LoadingState label="Memuat workspace..." variant="cards" rows={3} />
            ) : sessions.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface px-4 py-6">
                <Lightbulb size={18} className="text-muted" aria-hidden />
                <p className="mt-2 text-[14px] font-medium">Belum ada workspace.</p>
                <p className="mt-1 max-w-xl text-[13px] text-muted">
                  Mulai dari ide mentah. Axtra akan menanyakan hal penting satu per
                  satu, mencatat keputusan vs asumsi, lalu menyusun dokumen secara
                  bertahap.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex h-full flex-col rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/projects/${id}/vibe/${session.id}`}
                        className="min-w-0 text-[15px] font-semibold hover:underline"
                      >
                        {session.title || "Workspace tanpa judul"}
                      </Link>
                      <button
                        type="button"
                        aria-label="Hapus workspace"
                        disabled={Boolean(busy[session.id])}
                        onClick={() => void remove(session)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted">
                      {session.raw_idea.idea || session.raw_idea.problem || "Tanpa deskripsi."}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                        {VIBE_STAGE_LABELS[session.stage]}
                      </span>
                      <span className="text-[11px] text-muted">
                        diperbarui {formatWhen(session.updated_at)}
                      </span>
                      <div className="flex-1" />
                      <Link
                        href={`/projects/${id}/vibe/${session.id}`}
                        className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                      >
                        Lanjutkan
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