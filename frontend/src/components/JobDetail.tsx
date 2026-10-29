"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";

import { Markdown } from "@/components/Markdown";
import {
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  statusChipClass,
} from "@/components/JobTracker";
import {
  analyzeJob,
  crawlJob,
  deleteJob,
  deleteJobCv,
  generateCoverLetter,
  getJob,
  getJobCv,
  updateJob,
  uploadJobCv,
  type JobApplication,
  type JobCv,
  type JobStatus,
} from "@/lib/api";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  // Plain dates (e.g. "2024-01-15") carry no timezone; keep them verbatim.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Timestamps: format with local getters so the shown day matches the user's
  // timezone instead of shifting to the UTC day.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium">{title}</h2>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ScoreBar({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {value == null ? "—" : `${value}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-300"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobApplication | null>(null);
  const [cv, setCv] = useState<JobCv | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState<"crawl" | "analyze" | "cover" | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [coverText, setCoverText] = useState("");
  const [coverDirty, setCoverDirty] = useState(false);
  const coverDirtyRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const markCoverDirty = useCallback((dirty: boolean) => {
    coverDirtyRef.current = dirty;
    setCoverDirty(dirty);
  }, []);

  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const toggleEditing = useCallback(() => {
    setEditing((value) => {
      const next = !value;
      editingRef.current = next;
      return next;
    });
  }, []);
  const closeEditing = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
  }, []);
  const [editDraft, setEditDraft] = useState({
    company: "",
    role: "",
    location: "",
    work_type: "",
    salary: "",
    deadline: "",
    createdAt: "",
    appliedAt: "",
    notes: "",
  });

  const [cvUploading, setCvUploading] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement | null>(null);

  const applyJob = useCallback((next: JobApplication) => {
    setJob(next);
    // Keep unsaved edits when another action (status, crawl) refreshes the row.
    if (!coverDirtyRef.current) {
      setCoverText(next.cover_letter ?? "");
    }
    // Do not clobber the edit form while the user is editing it.
    if (!editingRef.current) {
      setEditDraft({
        company: next.company,
        role: next.role,
        location: next.location,
        work_type: next.work_type,
        salary: next.salary,
        deadline: next.deadline ?? "",
        createdAt: toDateInput(next.created_at),
        appliedAt: toDateInput(next.applied_at),
        notes: next.notes,
      });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [row, cvRow] = await Promise.all([
        getJob(jobId),
        getJobCv().catch(() => null),
      ]);
      applyJob(row);
      setUrlInput(row.job_url ?? "");
      setCv(cvRow && cvRow.filename ? cvRow : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat lamaran.");
    } finally {
      setLoading(false);
    }
  }, [applyJob, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePatch(patch: Parameters<typeof updateJob>[1]) {
    if (!job) return;
    setError(null);
    try {
      const updated = await updateJob(job.id, patch);
      applyJob(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      return null;
    }
  }

  async function handleStatus(status: JobStatus) {
    if (!job || status === job.status) return;
    const updated = await savePatch({ status });
    if (updated) setNotice(`Status diubah ke ${JOB_STATUS_LABEL[status]}.`);
  }

  async function handleCrawl() {
    if (!job || busy) return;
    if (!urlInput.trim() && !job.job_url) {
      setError("Isi URL rekrutmen dulu.");
      return;
    }
    setBusy("crawl");
    setError(null);
    setNotice(null);
    try {
      const updated = await crawlJob(job.id, urlInput.trim() || undefined);
      applyJob(updated);
      setUrlInput(updated.job_url ?? "");
      setNotice("Lowongan berhasil di-crawl. Sekarang jalankan analisa CV.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crawl gagal.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAnalyze() {
    if (!job || busy) return;
    setBusy("analyze");
    setError(null);
    setNotice(null);
    try {
      const updated = await analyzeJob(job.id);
      applyJob(updated);
      setNotice("Analisa selesai: kecocokan dan peluang keberhasilan diperbarui.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analisa gagal.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCover() {
    if (!job || busy) return;
    setBusy("cover");
    setError(null);
    setNotice(null);
    try {
      const updated = await generateCoverLetter(job.id);
      markCoverDirty(false);
      applyJob(updated);
      setNotice("Cover letter dibuat. Silakan edit lalu simpan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat cover letter.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCover() {
    if (!job) return;
    const updated = await savePatch({ cover_letter: coverText });
    if (updated) {
      markCoverDirty(false);
      setNotice("Cover letter disimpan.");
    }
  }

  async function copyCover() {
    try {
      await navigator.clipboard.writeText(coverText);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; keep quiet.
    }
  }

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  async function saveEdits(event: React.FormEvent) {
    event.preventDefault();
    const updated = await savePatch({
      company: editDraft.company.trim(),
      role: editDraft.role.trim(),
      location: editDraft.location,
      work_type: editDraft.work_type,
      salary: editDraft.salary,
      deadline: editDraft.deadline || null,
      created_at: editDraft.createdAt
        ? `${editDraft.createdAt}T00:00:00Z`
        : null,
      applied_at: editDraft.appliedAt
        ? `${editDraft.appliedAt}T00:00:00Z`
        : null,
      notes: editDraft.notes,
    });
    if (updated) {
      closeEditing();
      setNotice("Detail lamaran disimpan.");
    }
  }

  async function handleCvUpload(file: File) {
    setCvUploading(true);
    setCvError(null);
    try {
      const uploaded = await uploadJobCv(file);
      setCv(uploaded);
      setNotice("CV tersimpan. Jalankan analisa untuk melihat kecocokan.");
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Upload CV gagal.");
    } finally {
      setCvUploading(false);
      if (cvInputRef.current) cvInputRef.current.value = "";
    }
  }

  async function handleCvDelete() {
    if (!window.confirm("Hapus CV tersimpan? Analisa lamaran butuh CV.")) return;
    try {
      await deleteJobCv();
      setCv(null);
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Gagal menghapus CV.");
    }
  }

  async function handleDelete() {
    if (!job) return;
    if (
      !window.confirm(
        `Hapus lamaran "${job.role} — ${job.company}"?\n\nTindakan ini tidak dapat dibatalkan.`,
      )
    ) {
      return;
    }
    try {
      await deleteJob(job.id);
      router.push("/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus lamaran.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <p className="text-[13px] text-muted">Memuat lamaran...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-foreground"
          >
            <ArrowLeft size={13} aria-hidden /> Cari Kerja
          </Link>
          <p className="mt-4 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger">
            {error ?? "Lamaran tidak ditemukan."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-16">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft size={13} aria-hidden /> Cari Kerja
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">
              {job.role}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] ${statusChipClass(
                  job.status,
                )}`}
              >
                {JOB_STATUS_LABEL[job.status]}
              </span>
              {job.work_type && (
                <span className="text-[11px] text-muted">{job.work_type}</span>
              )}
              {job.salary && (
                <span className="text-[11px] text-muted">· {job.salary}</span>
              )}
              {job.deadline && (
                <span className="text-[11px] text-muted">
                  · Deadline {formatDate(job.deadline)}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="job-status-select" className="sr-only">
              Status lamaran
            </label>
            <select
              id="job-status-select"
              value={job.status}
              onChange={(event) => void handleStatus(event.target.value as JobStatus)}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none focus:border-foreground/40"
            >
              {JOB_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {JOB_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
            >
              <Trash2 size={13} aria-hidden />
              Hapus
            </button>
          </div>
        </div>

        {notice && (
          <p className="mt-3 rounded-lg border border-border px-3 py-2 text-[12px] text-muted">
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {/* Score summary */}
            <Card
              title="Ringkasan kecocokan"
              action={
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={busy !== null || !cv}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "analyze" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles size={13} aria-hidden />
                  )}
                  {busy === "analyze" ? "Menganalisa..." : "Analisa CV"}
                </button>
              }
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <ScoreBar
                  label="Match CV"
                  value={job.match_score}
                  hint="Kecocokan CV dengan kualifikasi lowongan."
                />
                <ScoreBar
                  label="Peluang berhasil"
                  value={job.success_score}
                  hint="Estimasi AI, bukan jaminan. Naikkan dengan melengkapi CV."
                />
              </div>
              {!cv && (
                <p className="mt-2 text-[11px] text-muted">
                  Unggah CV di panel kanan untuk mengaktifkan analisa.
                </p>
              )}
              {job.analyzed_at && (
                <p className="mt-2 text-[10px] text-muted">
                  Terakhir dianalisa {formatDate(job.analyzed_at)}
                </p>
              )}
            </Card>

            {/* Job description */}
            <Card
              title="Deskripsi lowongan"
              action={
                job.job_url ? (
                  <a
                    href={job.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors duration-150 hover:text-foreground"
                  >
                    Buka sumber <ExternalLink size={12} aria-hidden />
                  </a>
                ) : null
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="job-crawl-url" className="sr-only">
                  URL rekrutmen
                </label>
                <input
                  id="job-crawl-url"
                  type="url"
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  placeholder="https://perusahaan.com/careers/..."
                  className={`h-9 min-w-0 flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={() => void handleCrawl()}
                  disabled={busy !== null}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "crawl" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Globe size={13} aria-hidden />
                  )}
                  {busy === "crawl" ? "Crawl..." : "Crawl lowongan"}
                </button>
              </div>

              {job.job_title && (
                <p className="mt-2 text-[11px] text-muted">
                  Judul halaman: {job.job_title}
                </p>
              )}

              {job.job_description ? (
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3">
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                    {job.job_description}
                  </p>
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">
                  Belum ada deskripsi. Tempel URL rekrutmen lalu crawl, atau isi
                  manual lewat tombol edit.
                </p>
              )}
            </Card>

            {/* Predicted jobdesk + analysis */}
            <Card title="Prediksi jobdesk & analisa">
              {job.predicted_jobdesk || job.match_analysis || job.success_analysis ? (
                <div className="space-y-3">
                  {job.predicted_jobdesk && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted">
                        Prediksi isi pekerjaan
                      </p>
                      <div className="mt-1 rounded-lg border border-border bg-background p-3">
                        <Markdown content={job.predicted_jobdesk} />
                      </div>
                    </div>
                  )}
                  {job.match_analysis && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted">
                        Analisa kecocokan
                      </p>
                      <div className="mt-1 rounded-lg border border-border bg-background p-3">
                        <Markdown content={job.match_analysis} />
                      </div>
                    </div>
                  )}
                  {job.success_analysis && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted">
                        Analisa peluang
                      </p>
                      <div className="mt-1 rounded-lg border border-border bg-background p-3">
                        <Markdown content={job.success_analysis} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">
                  Jalankan <strong>Analisa CV</strong> untuk melihat prediksi
                  jobdesk, kecocokan, dan peluang keberhasilan.
                </p>
              )}
            </Card>

            {/* Cover letter */}
            <Card
              title="Cover letter"
              action={
                <button
                  type="button"
                  onClick={() => void handleCover()}
                  disabled={busy !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "cover" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Wand2 size={13} aria-hidden />
                  )}
                  {busy === "cover"
                    ? "Menulis..."
                    : job.cover_letter
                      ? "Buat ulang"
                      : "Generate"}
                </button>
              }
            >
              {coverText ? (
                <>
                  <textarea
                    value={coverText}
                    onChange={(event) => {
                      setCoverText(event.target.value);
                      markCoverDirty(true);
                    }}
                    rows={12}
                    className={`resize-y ${inputClass}`}
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] text-muted">
                      {coverText.trim().split(/\s+/).filter(Boolean).length} kata
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyCover()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                      >
                        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                        {copied ? "Tersalin" : "Salin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCover()}
                        disabled={!coverDirty}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                      >
                        <Save size={13} aria-hidden />
                        Simpan
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">
                  Belum ada cover letter. Klik <strong>Generate</strong> untuk
                  membuatnya dari CV dan detail lowongan.
                </p>
              )}
            </Card>

            {/* Edit details */}
            <Card
              title="Detail lamaran"
              action={
                <button
                  type="button"
                  onClick={toggleEditing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                >
                  <Pencil size={13} aria-hidden />
                  {editing ? "Tutup" : "Edit"}
                </button>
              }
            >
              {editing ? (
                <form onSubmit={saveEdits} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="edit-company" className="block text-[11px] text-muted">
                        Perusahaan
                      </label>
                      <input
                        id="edit-company"
                        value={editDraft.company}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, company: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-role" className="block text-[11px] text-muted">
                        Posisi
                      </label>
                      <input
                        id="edit-role"
                        value={editDraft.role}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, role: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-location" className="block text-[11px] text-muted">
                        Lokasi
                      </label>
                      <input
                        id="edit-location"
                        value={editDraft.location}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, location: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-work-type" className="block text-[11px] text-muted">
                        Tipe kerja
                      </label>
                      <input
                        id="edit-work-type"
                        value={editDraft.work_type}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, work_type: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-salary" className="block text-[11px] text-muted">
                        Gaji
                      </label>
                      <input
                        id="edit-salary"
                        value={editDraft.salary}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, salary: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-deadline" className="block text-[11px] text-muted">
                        Deadline (opsional)
                      </label>
                      <input
                        id="edit-deadline"
                        type="date"
                        value={editDraft.deadline}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, deadline: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-created" className="block text-[11px] text-muted">
                        Tanggal dibuat (opsional)
                      </label>
                      <input
                        id="edit-created"
                        type="date"
                        value={editDraft.createdAt}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, createdAt: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-applied" className="block text-[11px] text-muted">
                        Tanggal dilamar
                      </label>
                      <input
                        id="edit-applied"
                        type="date"
                        value={editDraft.appliedAt}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, appliedAt: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="edit-notes" className="block text-[11px] text-muted">
                      Catatan
                    </label>
                    <textarea
                      id="edit-notes"
                      value={editDraft.notes}
                      onChange={(event) =>
                        setEditDraft((prev) => ({ ...prev, notes: event.target.value }))
                      }
                      rows={3}
                      className={`mt-1 resize-none ${inputClass}`}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
                    >
                      <Save size={13} aria-hidden />
                      Simpan detail
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
                  {[
                    ["Perusahaan", job.company],
                    ["Posisi", job.role],
                    ["Lokasi", job.location || "—"],
                    ["Tipe kerja", job.work_type || "—"],
                    ["Gaji", job.salary || "—"],
                    ["Deadline", formatDate(job.deadline)],
                    ["Dilamar", formatDate(job.applied_at)],
                    ["Sumber", job.source === "crawl" ? "Crawl" : "Manual"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">
                        {label}
                      </dt>
                      <dd className="text-foreground">{value}</dd>
                    </div>
                  ))}
                  {job.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-[10px] uppercase tracking-wide text-muted">
                        Catatan
                      </dt>
                      <dd className="whitespace-pre-wrap text-foreground">{job.notes}</dd>
                    </div>
                  )}
                </dl>
              )}
            </Card>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card title="CV">
              <div className="flex items-start gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                  <FileText size={16} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">
                    {cv ? cv.filename : "Belum ada CV"}
                  </p>
                  <p className="text-[11px] text-muted">
                    {cv
                      ? `${cv.char_count.toLocaleString("id-ID")} karakter`
                      : "TXT, MD, atau PDF"}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <label
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted ${
                    cvUploading ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <Upload size={13} aria-hidden />
                  {cvUploading ? "Mengunggah..." : cv ? "Ganti" : "Unggah CV"}
                  <input
                    ref={cvInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
                    className="hidden"
                    disabled={cvUploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleCvUpload(file);
                    }}
                  />
                </label>
                {cv && (
                  <button
                    type="button"
                    onClick={() => void handleCvDelete()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
                  >
                    <Trash2 size={13} aria-hidden />
                    Hapus
                  </button>
                )}
              </div>
              {cvError && (
                <p role="alert" className="mt-2 text-[11px] text-danger">
                  {cvError}
                </p>
              )}
            </Card>

            <Card title="Aksi cepat">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void handleCrawl()}
                  disabled={busy !== null}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "crawl" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Globe size={14} aria-hidden />
                  )}
                  Crawl ulang lowongan
                </button>
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={busy !== null || !cv}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "analyze" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles size={14} aria-hidden />
                  )}
                  Analisa CV & peluang
                </button>
                <button
                  type="button"
                  onClick={() => void handleCover()}
                  disabled={busy !== null}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "cover" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Wand2 size={14} aria-hidden />
                  )}
                  Generate cover letter
                </button>
              </div>
              <p className="mt-2 text-[10px] text-muted">
                Analisa dan cover letter memakai CV aktif. Perbarui CV bila
                pengalamanmu berubah.
              </p>
            </Card>

            <Card title="Info">
              <dl className="space-y-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Dibuat</dt>
                  <dd>{formatDate(job.created_at)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Diperbarui</dt>
                  <dd>{formatDate(job.updated_at)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Sumber</dt>
                  <dd>{job.source === "crawl" ? "Crawl" : "Manual"}</dd>
                </div>
              </dl>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}