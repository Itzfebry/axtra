"use client";

import Link from "next/link";
import { LoadingState } from "@/components/ui/LoadingState";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Wand2,
} from "lucide-react";

import { Markdown } from "@/components/Markdown";
import { emitUsageChanged } from "@/components/UsageMeter";
import { JobProfileLinks } from "@/components/JobProfileLinks";
import {
  OperationStatus,
  type OperationStep,
} from "@/components/ui/OperationStatus";
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
  type JobProfileSource,
  type JobStatus,
} from "@/lib/api";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

const SOURCE_LABEL: Record<JobProfileSource, string> = {
  cv: "CV",
  portfolio: "Portfolio",
  linkedin: "LinkedIn",
};
const SOURCE_ORDER: JobProfileSource[] = ["cv", "portfolio", "linkedin"];

const CRAWL_STEPS: OperationStep[] = [
  { label: "Menyiapkan URL", at: 0 },
  { label: "Menghubungi halaman lowongan", at: 1 },
  { label: "Mengekstrak konten utama", at: 5 },
  { label: "Menyimpan deskripsi lowongan", at: 20 },
];

const ANALYZE_STEPS: OperationStep[] = [
  { label: "Menyiapkan konteks CV dan lowongan", at: 0 },
  { label: "Mengirim data ke model AI", at: 1 },
  { label: "Menyusun analisa dan skor", at: 5 },
  { label: "Menyimpan hasil analisa", at: 25 },
];

const COVER_STEPS: OperationStep[] = [
  { label: "Menyiapkan konteks dan detail lowongan", at: 0 },
  { label: "Menulis surat lamaran", at: 1 },
  { label: "Menyimpan surat", at: 20 },
];

const CV_UPLOAD_STEPS: OperationStep[] = [
  { label: "Membaca file CV", at: 0 },
  { label: "Mengunggah ke server", at: 1 },
  { label: "Mengekstrak teks CV", at: 3 },
  { label: "Menyimpan CV aktif", at: 8 },
];

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

type ScoreTone = { bar: string; text: string; label: string };

function scoreTone(value: number | null): ScoreTone {
  if (value == null) {
    return { bar: "bg-muted/40", text: "text-muted", label: "Belum dinilai" };
  }
  if (value >= 75) {
    return { bar: "bg-success", text: "text-success", label: "Tinggi" };
  }
  if (value >= 55) {
    return { bar: "bg-primary", text: "text-primary", label: "Sedang" };
  }
  if (value >= 35) {
    return { bar: "bg-warning", text: "text-warning", label: "Cukup rendah" };
  }
  return { bar: "bg-danger", text: "text-danger", label: "Rendah" };
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
  const tone = scoreTone(value);
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {label}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-2xl font-semibold leading-none tabular-nums ${tone.text}`}
          >
            {value == null ? "—" : `${value}%`}
          </p>
          <p className={`mt-1 text-[10px] font-medium ${tone.text}`}>
            {tone.label}
          </p>
        </div>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full ${tone.bar} transition-[width] duration-500`}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function AnalysisBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-primary">
          {icon}
        </span>
        <h3 className="text-[12px] font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="mt-2.5 text-[13px]">{children}</div>
    </div>
  );
}

function TokenUsageNote({
  usage,
}: {
  usage: NonNullable<JobApplication["token_usage"]>;
}) {
  return (
    <p className="mt-2.5 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-[11px] tabular-nums text-muted">
      Token AI terakhir:{" "}
      <span className="text-foreground">
        {usage.prompt_tokens.toLocaleString("id-ID")}
      </span>{" "}
      prompt ·{" "}
      <span className="text-foreground">
        {usage.completion_tokens.toLocaleString("id-ID")}
      </span>{" "}
      output ·{" "}
      <span className="font-medium text-foreground">
        {usage.total_tokens.toLocaleString("id-ID")}
      </span>{" "}
      total
    </p>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobApplication | null>(null);
  const [cv, setCv] = useState<JobCv | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usageNote, setUsageNote] = useState<{
    action: "analyze" | "cover";
    usage: NonNullable<JobApplication["token_usage"]>;
  } | null>(null);

  const [busy, setBusy] = useState<"crawl" | "analyze" | "cover" | null>(null);
  const [sources, setSources] = useState<JobProfileSource[]>([
    "cv",
    "portfolio",
    "linkedin",
  ]);

  const sourceReady: Record<JobProfileSource, boolean> = {
    cv: Boolean(cv?.filename),
    portfolio: Boolean(cv?.portfolio_url || (cv?.portfolio_chars ?? 0) > 0),
    linkedin: Boolean(cv?.linkedin_url || (cv?.linkedin_chars ?? 0) > 0),
  };
  const activeSources = sources.filter((source) => sourceReady[source]);

  function toggleSource(source: JobProfileSource) {
    setSources((prev) =>
      prev.includes(source)
        ? prev.filter((item) => item !== source)
        : [...prev, source],
    );
  }

  const [urlInput, setUrlInput] = useState("");
  const [hasLink, setHasLink] = useState(true);
  const [descDraft, setDescDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const editingDescriptionRef = useRef(false);
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
    jobDescription: "",
  });

  const [cvUploading, setCvUploading] = useState(false);
  const [cvProgress, setCvProgress] = useState<number | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement | null>(null);

  const applyJob = useCallback((next: JobApplication) => {
    setJob(next);
    // Keep unsaved edits when another action (status, crawl) refreshes the row.
    if (!coverDirtyRef.current) {
      setCoverText(next.cover_letter ?? "");
    }
    if (!editingDescriptionRef.current) {
      setDescDraft(next.job_description ?? "");
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
        jobDescription: next.job_description ?? "",
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
      setHasLink(Boolean(row.job_url));
      setCv(
        cvRow && (cvRow.filename || cvRow.linkedin_url || cvRow.portfolio_url)
          ? cvRow
          : null,
      );
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
    }    setBusy("crawl");
    setError(null);
    setNotice(null);
    try {
      const updated = await crawlJob(job.id, urlInput.trim() || undefined);
      applyJob(updated);
      setUrlInput(updated.job_url ?? "");
      setNotice(
        updated.crawl_notice
          ? `${updated.crawl_notice} Deskripsi lowongan diperbarui.`
          : "Lowongan berhasil di-crawl. Sekarang jalankan analisa CV.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crawl gagal.");
    } finally {
      setBusy(null);
    }
  }

  function toggleDescriptionEdit() {
    setEditingDescription((value) => {
      const next = !value;
      editingDescriptionRef.current = next;
      if (next) setDescDraft(job?.job_description ?? "");
      return next;
    });
  }

  async function saveDescription() {
    if (!job) return;
    const updated = await savePatch({ job_description: descDraft.trim() });
    if (updated) {
      editingDescriptionRef.current = false;
      setEditingDescription(false);
      setNotice("Deskripsi lowongan disimpan.");
    }
  }

  async function handleAnalyze() {
    if (!job || busy) return;
    if (!job.job_description.trim()) {
      setError(
        hasLink
          ? "Deskripsi lowongan masih kosong. Crawl link rekrutmen dulu, atau isi deskripsi lowongan secara manual, agar analisa tidak menebak dari judul."
          : "Deskripsi lowongan masih kosong. Isi deskripsi lowongan secara manual dulu.",
      );
      return;
    }
    if (activeSources.length === 0) {
      setError("Pilih minimal satu sumber analisa (CV, Portfolio, atau LinkedIn).");
      return;
    }
    setBusy("analyze");
    setError(null);
    setNotice(null);
    try {
      const updated = await analyzeJob(job.id, activeSources);
      applyJob(updated);
      if (updated.token_usage) {
        setUsageNote({ action: "analyze", usage: updated.token_usage });
      }
      emitUsageChanged();
      const used = activeSources.map((source) => SOURCE_LABEL[source]).join(", ");
      setNotice(`Analisa selesai memakai ${used}. Skor dan rekomendasi diperbarui.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analisa gagal.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCover() {
    if (!job || busy) return;
    if (!job.job_description.trim()) {
      setError(
        hasLink
          ? "Deskripsi lowongan masih kosong. Crawl link rekrutmen dulu, atau isi deskripsi lowongan secara manual, sebelum membuat surat lamaran."
          : "Deskripsi lowongan masih kosong. Isi deskripsi lowongan secara manual dulu sebelum membuat surat lamaran.",
      );
      return;
    }
    if (activeSources.length === 0) {
      setError(
        "Pilih minimal satu sumber (CV, Portfolio, atau LinkedIn) sebelum membuat surat lamaran.",
      );
      return;
    }
    setBusy("cover");
    setError(null);
    setNotice(null);
    try {
      const updated = await generateCoverLetter(job.id, activeSources);
      markCoverDirty(false);
      applyJob(updated);
      if (updated.token_usage) {
        setUsageNote({ action: "cover", usage: updated.token_usage });
      }
      emitUsageChanged();
      const used = activeSources.map((source) => SOURCE_LABEL[source]).join(", ");
      setNotice(`Surat lamaran dibuat memakai ${used}. Silakan edit lalu simpan.`);
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

  function downloadCover() {
    if (!job || !coverText.trim()) return;
    const safeName =
      `${job.role}-${job.company}-surat-lamaran`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "surat-lamaran";
    const blob = new Blob([coverText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
      job_description: editDraft.jobDescription,
    });
    if (updated) {
      closeEditing();
      setNotice("Detail lamaran disimpan.");
    }
  }

  async function handleCvUpload(file: File) {
    setCvUploading(true);
    setCvProgress(0);
    setCvError(null);
    try {
      const uploaded = await uploadJobCv(file, setCvProgress);
      setCv(uploaded);
      setNotice("CV tersimpan. Jalankan analisa untuk melihat kecocokan.");
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Upload CV gagal.");
    } finally {
      setCvUploading(false);
      setCvProgress(null);
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
          <LoadingState label="Memuat detail lamaran..." variant="detail" rows={5} />
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
                className={`rounded border px-1.5 py-0.5 text-[11px] ${statusChipClass(
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
              title="Analisa AI"
              action={
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={busy !== null || activeSources.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "analyze" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles size={13} aria-hidden />
                  )}
                  {busy === "analyze"
                    ? "Menganalisa..."
                    : job.analyzed_at
                      ? "Analisa ulang"
                      : "Analisa"}
                </button>
              }
            >
              <div className="mb-3 rounded-xl border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Sumber analisa
                  </p>
                  <span className="text-[10px] text-muted">
                    Sumber yang siap dipakai otomatis terpilih
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SOURCE_ORDER.map((source) => {
                    const ready = sourceReady[source];
                    const checked = sources.includes(source);
                    return (
                      <label
                        key={source}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                          ready
                            ? "cursor-pointer border-border text-foreground hover:bg-surface-muted"
                            : "cursor-not-allowed border-border text-muted opacity-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!ready}
                          onChange={() => toggleSource(source)}
                          className="accent-foreground"
                        />
                        {SOURCE_LABEL[source]}
                        {!ready && (
                          <span className="text-[10px] text-muted">belum ada</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  Semakin lengkap sumber, semakin tajam analisa. Portfolio bisa
                  ditarik otomatis; LinkedIn memakai ringkasan teks di panel
                  Profil kandidat.
                </p>
              </div>

              {busy === "analyze" && (
                <OperationStatus
                  active
                  title="Menganalisa kecocokan lamaran"
                  steps={ANALYZE_STEPS}
                  note="Model AI menyusun skor, prediksi tanggung jawab, gap, dan saran. Biasanya 15-45 detik."
                />
              )}

              <div className="grid gap-2.5 sm:grid-cols-2">
                <ScoreBar
                  label="Skor kecocokan"
                  value={job.match_score}
                  hint="Keselarasan profil dengan kualifikasi dan tanggung jawab lowongan."
                />
                <ScoreBar
                  label="Estimasi peluang"
                  value={job.success_score}
                  hint="Perkiraan peluang dipanggil interview, bukan jaminan."
                />
              </div>

              {!job.job_description.trim() && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0 text-warning"
                    aria-hidden
                  />
                  <p className="text-[11px] leading-relaxed text-foreground">
                    Deskripsi lowongan masih kosong. Crawl link rekrutmen dulu
                    agar analisa dan surat lamaran tidak sekadar menebak dari
                    judul.
                  </p>
                </div>
              )}

              {activeSources.length === 0 && (
                <p className="mt-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted">
                  Belum ada sumber yang siap. Unggah CV atau isi link profil di
                  panel kanan untuk mengaktifkan analisa.
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>
                  {job.analyzed_at
                    ? `Terakhir dianalisa ${formatDate(job.analyzed_at)}`
                    : "Belum pernah dianalisa."}
                </span>
                {activeSources.length > 0 && (
                  <span>
                    Sumber siap:{" "}
                    {activeSources
                      .map((source) => SOURCE_LABEL[source])
                      .join(", ")}
                  </span>
                )}
              </div>

              {usageNote?.action === "analyze" && (
                <TokenUsageNote usage={usageNote.usage} />
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
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={hasLink}
                  onChange={(event) => setHasLink(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Lowongan ini punya link rekrutmen
              </label>

              {hasLink ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
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
              ) : (
                <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted">
                  Tanpa link, isi deskripsi lowongan secara manual agar analisa
                  dan surat lamaran tetap akurat.
                </p>
              )}

              {busy === "crawl" && (
                <OperationStatus
                  active
                  title="Mengambil deskripsi lowongan"
                  steps={CRAWL_STEPS}
                  note="Firecrawl membaca halaman lalu hanya menyimpan konten utama. Biasanya 5-30 detik."
                />
              )}

              {job.job_title && (
                <p className="mt-2 text-[11px] text-muted">
                  Judul halaman: {job.job_title}
                </p>
              )}

              {editingDescription ? (
                <div className="mt-2">
                  <label htmlFor="job-description" className="sr-only">
                    Deskripsi lowongan
                  </label>
                  <textarea
                    id="job-description"
                    value={descDraft}
                    onChange={(event) => setDescDraft(event.target.value)}
                    rows={10}
                    placeholder="Tempel deskripsi lowongan: tanggung jawab, kualifikasi, teknologi, dan kata kunci penting."
                    className={`resize-y ${inputClass}`}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={toggleDescriptionEdit}
                      className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveDescription()}
                      disabled={busy !== null}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      <Save size={13} aria-hidden />
                      Simpan deskripsi
                    </button>
                  </div>
                </div>
              ) : job.job_description ? (
                <div className="mt-2">
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3">
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                      {job.job_description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleDescriptionEdit}
                    className="mt-2 text-[11px] text-muted transition-colors duration-150 hover:text-foreground"
                  >
                    Ubah manual
                  </button>
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center">
                  <p className="text-[12px] text-muted">
                    Belum ada deskripsi lowongan. Crawl link rekrutmen, atau isi
                    manual.
                  </p>
                  <button
                    type="button"
                    onClick={toggleDescriptionEdit}
                    className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
                  >
                    <Pencil size={13} aria-hidden />
                    Isi manual
                  </button>
                </div>
              )}
            </Card>

            {/* Predicted jobdesk + analysis */}
            <Card title="Hasil analisa">
              {job.predicted_jobdesk || job.match_analysis || job.success_analysis ? (
                <div className="space-y-2.5">
                  {job.predicted_jobdesk && (
                    <AnalysisBlock
                      title="Prediksi tanggung jawab"
                      icon={<ListChecks size={14} aria-hidden />}
                    >
                      <Markdown content={job.predicted_jobdesk} />
                    </AnalysisBlock>
                  )}
                  {job.match_analysis && (
                    <AnalysisBlock
                      title="Analisis kecocokan"
                      icon={<Target size={14} aria-hidden />}
                    >
                      <Markdown content={job.match_analysis} />
                    </AnalysisBlock>
                  )}
                  {job.success_analysis && (
                    <AnalysisBlock
                      title="Analisis peluang"
                      icon={<TrendingUp size={14} aria-hidden />}
                    >
                      <Markdown content={job.success_analysis} />
                    </AnalysisBlock>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                  <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-primary">
                    <Sparkles size={18} aria-hidden />
                  </span>
                  <p className="mt-3 text-[13px] font-medium">
                    Belum ada hasil analisa
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted">
                    Analisa AI menghasilkan skor kecocokan, prediksi tanggung
                    jawab, gap, dan langkah konkret. Ikuti urutan ini untuk hasil
                    terbaik.
                  </p>
                  <ol className="mx-auto mt-3 max-w-md space-y-1.5 text-left text-[11px] text-muted">
                    <li>
                      <span className="font-medium text-foreground">1.</span>{" "}
                      Crawl link rekrutmen agar deskripsi lowongan lengkap.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">2.</span>{" "}
                      Pastikan CV dan profil pendukung sudah siap.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">3.</span>{" "}
                      Klik <strong>Analisa</strong> di ringkasan kecocokan.
                    </li>
                  </ol>
                </div>
              )}
            </Card>

            {/* Cover letter */}
            <Card
              title="Surat lamaran"
              action={
                <button
                  type="button"
                  onClick={() => void handleCover()}
                  disabled={busy !== null || activeSources.length === 0}
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
                      : "Buat surat"}
                </button>
              }
            >
              <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
                Surat dibuat dari{" "}
                {activeSources.length > 0
                  ? activeSources.map((source) => SOURCE_LABEL[source]).join(", ")
                  : "sumber yang dipilih"}{" "}
                dan detail lowongan. Selalu tinjau sebelum dikirim.
              </p>

              {busy === "cover" && (
                <OperationStatus
                  active
                  title="Menulis surat lamaran"
                  steps={COVER_STEPS}
                  note="Model menyusun 280-420 kata dari sumber terpilih. Biasanya 10-30 detik."
                />
              )}

              {coverText ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                    <span>
                      Untuk {job.role} · {job.company}
                    </span>
                    {coverDirty && (
                      <span className="text-warning">Perubahan belum disimpan</span>
                    )}
                  </div>
                  <textarea
                    value={coverText}
                    onChange={(event) => {
                      setCoverText(event.target.value);
                      markCoverDirty(true);
                    }}
                    rows={14}
                    className={`resize-y bg-background ${inputClass}`}
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] tabular-nums text-muted">
                      {coverText.trim().split(/\s+/).filter(Boolean).length} kata
                      {" · "}
                      {coverText.length.toLocaleString("id-ID")} karakter
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={downloadCover}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                      >
                        <Download size={13} aria-hidden />
                        Unduh
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyCover()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                      >
                        {copied ? (
                          <Check size={13} aria-hidden />
                        ) : (
                          <Copy size={13} aria-hidden />
                        )}
                        {copied ? "Tersalin" : "Salin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCover()}
                        disabled={!coverDirty}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                      >
                        <Save size={13} aria-hidden />
                        Simpan
                      </button>
                    </div>
                  </div>
                </>
              ) : busy === "cover" ? null : (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                  <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-primary">
                    <Wand2 size={18} aria-hidden />
                  </span>
                  <p className="mt-3 text-[13px] font-medium">
                    Belum ada surat lamaran
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted">
                    Buat surat siap kirim sepanjang 280-420 kata yang
                    menghubungkan pengalaman nyata dengan kebutuhan lowongan.
                  </p>
                  {activeSources.length === 0 && (
                    <p className="mx-auto mt-2 max-w-md text-[11px] text-warning">
                      Pilih minimal satu sumber (CV, Portfolio, atau LinkedIn)
                      agar surat bisa dibuat.
                    </p>
                  )}
                </div>
              )}

              {usageNote?.action === "cover" && (
                <TokenUsageNote usage={usageNote.usage} />
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
                    <label
                      htmlFor="edit-description"
                      className="block text-[11px] text-muted"
                    >
                      Deskripsi lowongan
                    </label>
                    <textarea
                      id="edit-description"
                      value={editDraft.jobDescription}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          jobDescription: event.target.value,
                        }))
                      }
                      rows={6}
                      placeholder="Tanggung jawab, kualifikasi, teknologi, dan kata kunci penting."
                      className={`mt-1 resize-y ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-notes" className="block text-[11px] text-muted">
                      Catatan (bukan deskripsi lowongan)
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
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
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
                      <dt className="text-[11px] uppercase tracking-wide text-muted">
                        {label}
                      </dt>
                      <dd className="text-foreground">{value}</dd>
                    </div>
                  ))}
                  {job.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] uppercase tracking-wide text-muted">
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
              {cvUploading && (
                <OperationStatus
                  active
                  title="Mengunggah CV"
                  steps={CV_UPLOAD_STEPS}
                  progress={cvProgress}
                  note="Bar menunjukkan transfer file. Ekstraksi teks PDF/TXT berjalan di server setelah unggahan selesai."
                />
              )}
              {cvError && (
                <p role="alert" className="mt-2 text-[11px] text-danger">
                  {cvError}
                </p>
              )}
            </Card>

            <JobProfileLinks cv={cv} onSaved={setCv} />

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
                  disabled={busy !== null || activeSources.length === 0}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "analyze" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles size={14} aria-hidden />
                  )}
                  Analisa profil & peluang
                </button>
                <button
                  type="button"
                  onClick={() => void handleCover()}
                  disabled={busy !== null || activeSources.length === 0}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "cover" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Wand2 size={14} aria-hidden />
                  )}
                  Buat surat lamaran
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Analisa dan surat lamaran memakai sumber yang dipilih
                (CV/Portfolio/LinkedIn).
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