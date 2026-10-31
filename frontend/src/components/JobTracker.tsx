"use client";

import Link from "next/link";
import { LoadingState } from "@/components/ui/LoadingState";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createJob,
  deleteJobCv,
  getJobCv,
  listJobs,
  uploadJobCv,
  type JobApplication,
  type JobApplicationInput,
  type JobCv,
  type JobStatus,
} from "@/lib/api";
import { JobProfileLinks } from "@/components/JobProfileLinks";
import {
  OperationStatus,
  type OperationStep,
} from "@/components/ui/OperationStatus";

const CV_UPLOAD_STEPS: OperationStep[] = [
  { label: "Membaca file CV", at: 0 },
  { label: "Mengunggah ke server", at: 1 },
  { label: "Mengekstrak teks CV", at: 3 },
  { label: "Menyimpan CV aktif", at: 8 },
];

export const JOB_STATUSES: JobStatus[] = [
  "draft",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draf",
  applied: "Dilamar",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Ditolak",
  withdrawn: "Ditarik",
};

export function statusChipClass(status: JobStatus): string {
  const base = "border bg-surface-muted";
  if (status === "rejected") {
    return `${base} border-danger/40 text-danger`;
  }
  if (status === "offer") {
    return `${base} border-success/40 text-success`;
  }
  if (status === "interview") {
    return `${base} border-primary/40 text-primary`;
  }
  if (status === "withdrawn" || status === "draft") {
    return "border border-border bg-surface-muted text-muted";
  }
  return "border border-border bg-surface-muted text-foreground";
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ScoreChip({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
        {label} ·
      </span>
    );
  }
  const color =
    value >= 70
      ? "text-success"
      : value >= 40
        ? "text-primary"
        : "text-danger";
  return (
    <span className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
      {label}{" "}
      <span className={color}>{value}%</span>
    </span>
  );
}

type JobForm = Omit<JobApplicationInput, "created_at"> & {
  createdAt: string;
};

const EMPTY_FORM: JobForm = {
  company: "",
  role: "",
  location: "",
  work_type: "",
  salary: "",
  job_url: "",
  status: "applied",
  deadline: "",
  createdAt: "",
  notes: "",
  job_description: "",
};

export function JobTracker() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobApplication[]>([]);
  const [cv, setCv] = useState<JobCv | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [cvUploading, setCvUploading] = useState(false);
  const [cvProgress, setCvProgress] = useState<number | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, cvRow] = await Promise.all([
        listJobs(),
        getJobCv().catch(() => null),
      ]);
      setJobs(rows ?? []);
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = jobs.filter((job) =>
      ["applied", "screening", "interview"].includes(job.status),
    ).length;
    const interview = jobs.filter((job) => job.status === "interview").length;
    const offer = jobs.filter((job) => job.status === "offer").length;
    return { total: jobs.length, active, interview, offer };
  }, [jobs]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (!term) return true;
      return (
        job.company.toLowerCase().includes(term) ||
        job.role.toLowerCase().includes(term) ||
        (job.location || "").toLowerCase().includes(term)
      );
    });
  }, [jobs, search, statusFilter]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!form.company.trim() || !form.role.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { createdAt, ...rest } = form;
      const created = await createJob({
        ...rest,
        company: form.company.trim(),
        role: form.role.trim(),
        job_url: form.job_url?.trim() || null,
        deadline: form.deadline || null,
        created_at: createdAt ? `${createdAt}T00:00:00Z` : null,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      router.push(`/jobs/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah lamaran.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCvUpload(file: File) {
    setCvUploading(true);
    setCvProgress(0);
    setCvError(null);
    try {
      const uploaded = await uploadJobCv(file, setCvProgress);
      setCv(uploaded);
      setNotice("CV tersimpan. Analisa lamaran sekarang bisa dijalankan.");
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Upload CV gagal.");
    } finally {
      setCvUploading(false);
      setCvProgress(null);
      if (cvInputRef.current) cvInputRef.current.value = "";
    }
  }

  async function handleCvDelete() {
    if (!window.confirm("Hapus CV yang tersimpan? Analisa lamaran butuh CV.")) return;
    try {
      await deleteJobCv();
      setCv(null);
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Gagal menghapus CV.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-16">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground font-brand">
              Cari Kerja
            </h1>
            <p className="mt-2 max-w-[560px] text-[15px] italic leading-relaxed text-muted">
              Lacak lamaran, crawl lowongan, cocokkan CV, dan siapkan cover letter
              dalam satu tempat.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
          >
            {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
            {showForm ? "Tutup" : "Tambah lamaran"}
          </button>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total lamaran", value: stats.total },
            { label: "Sedang diproses", value: stats.active },
            { label: "Interview", value: stats.interview },
            { label: "Offer", value: stats.offer },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <p className="text-[11px] uppercase tracking-wide text-muted">
                {item.label}
              </p>
              <p
                className={`mt-0.5 text-2xl font-semibold tabular-nums tracking-tight ${
                  item.label === "Offer"
                    ? "text-warning"
                    : item.label === "Interview"
                      ? "text-primary"
                      : item.label === "Sedang diproses"
                        ? "text-foreground"
                        : "text-muted"
                }`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* CV card */}
        <section className="mt-4 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
                <FileText size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium">CV aktif</p>
                <p className="truncate text-[12px] text-muted">
                  {cv
                    ? `${cv.filename} · ${cv.char_count.toLocaleString("id-ID")} karakter`
                    : "Belum ada CV. Unggah TXT, MD, atau PDF."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted ${
                  cvUploading ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <Upload size={13} aria-hidden />
                {cvUploading ? "Mengunggah..." : cv ? "Ganti CV" : "Unggah CV"}
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
                  aria-label="Hapus CV"
                  title="Hapus CV"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </div>
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
        </section>

        <div className="mt-4">
          <JobProfileLinks cv={cv} onSaved={setCv} />
        </div>

        {/* Create form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="job-company" className="block text-[12px] text-muted">
                  Perusahaan
                </label>
                <input
                  id="job-company"
                  value={form.company}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, company: event.target.value }))
                  }
                  placeholder="Contoh: Tokopedia"
                  className={`mt-1 ${inputClass}`}
                  required
                />
              </div>
              <div>
                <label htmlFor="job-role" className="block text-[12px] text-muted">
                  Posisi
                </label>
                <input
                  id="job-role"
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, role: event.target.value }))
                  }
                  placeholder="Contoh: Frontend Engineer"
                  className={`mt-1 ${inputClass}`}
                  required
                />
              </div>
              <div>
                <label htmlFor="job-location" className="block text-[12px] text-muted">
                  Lokasi
                </label>
                <input
                  id="job-location"
                  value={form.location}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, location: event.target.value }))
                  }
                  placeholder="Jakarta / Remote"
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label htmlFor="job-work-type" className="block text-[12px] text-muted">
                  Tipe kerja
                </label>
                <select
                  id="job-work-type"
                  value={form.work_type}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, work_type: event.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="">Pilih...</option>
                  <option value="Full-time">Full-time</option>
                  <option value="Kontrak">Kontrak</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Magang">Magang</option>
                  <option value="Freelance">Freelance</option>
                </select>
              </div>
              <div>
                <label htmlFor="job-status" className="block text-[12px] text-muted">
                  Status
                </label>
                <select
                  id="job-status"
                  value={form.status}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      status: event.target.value as JobStatus,
                    }))
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  {JOB_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {JOB_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="job-created" className="block text-[12px] text-muted">
                  Tanggal dibuat{" "}
                  <span className="text-[11px] text-muted">(opsional)</span>
                </label>
                <input
                  id="job-created"
                  type="date"
                  value={form.createdAt}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, createdAt: event.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                />
                <p className="mt-1 text-[11px] text-muted">
                  Kosongkan untuk memakai tanggal hari ini.
                </p>
              </div>
              <div>
                <label htmlFor="job-deadline" className="block text-[12px] text-muted">
                  Deadline{" "}
                  <span className="text-[11px] text-muted">(opsional)</span>
                </label>
                <input
                  id="job-deadline"
                  type="date"
                  value={form.deadline ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, deadline: event.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="job-url" className="block text-[12px] text-muted">
                  Link rekrutmen (untuk crawl)
                </label>
                <input
                  id="job-url"
                  type="url"
                  value={form.job_url ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, job_url: event.target.value }))
                  }
                  placeholder="https://perusahaan.com/careers/..."
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="job-description"
                  className="block text-[12px] text-muted"
                >
                  Deskripsi lowongan{" "}
                  <span className="text-[11px] text-muted">
                    (opsional, bisa diisi manual)
                  </span>
                </label>
                <textarea
                  id="job-description"
                  value={form.job_description ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      job_description: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Tanggung jawab, kualifikasi, teknologi, kata kunci. Boleh dikosongkan bila mau crawl dari link."
                  className={`mt-1 resize-y ${inputClass}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="job-notes" className="block text-[12px] text-muted">
                  Catatan (opsional, bukan deskripsi lowongan)
                </label>
                <textarea
                  id="job-notes"
                  value={form.notes}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  rows={2}
                  placeholder="Kontak recruiter, jadwal interview, dsb."
                  className={`mt-1 resize-none ${inputClass}`}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || !form.company.trim() || !form.role.trim()}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
              >
                {saving ? "Menyimpan..." : "Simpan & buka detail"}
              </button>
            </div>
          </form>
        )}

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

        {/* Toolbar */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-2">
            <Search size={15} className="shrink-0 text-muted" aria-hidden />
            <label htmlFor="job-search" className="sr-only">
              Cari lamaran
            </label>
            <input
              id="job-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari perusahaan, posisi, atau lokasi"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter status">
            <button
              type="button"
              onClick={() => setStatusFilter("")}
              aria-pressed={statusFilter === ""}
              className={`h-8 rounded-lg px-2.5 text-[12px] transition-colors duration-150 ${
                statusFilter === ""
                  ? "bg-surface-muted text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Semua
            </button>
            {JOB_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                aria-pressed={statusFilter === status}
                className={`h-8 rounded-lg px-2.5 text-[12px] transition-colors duration-150 ${
                  statusFilter === status
                    ? "bg-surface-muted text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {JOB_STATUS_LABEL[status]}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="mt-4">
          {loading && <LoadingState label="Memuat lamaran..." variant="cards" rows={4} />}

          {!loading && visible.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/30 px-4 py-12 text-center">
              <Briefcase size={24} className="mx-auto text-muted/60" aria-hidden />
              <p className="mt-3 text-[14px] text-muted">
                {jobs.length === 0
                  ? "Belum ada lamaran. Tambahkan lamaran pertamamu."
                  : "Tidak ada lamaran yang cocok dengan filter."}
              </p>
              {jobs.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
                >
                  <Plus size={13} aria-hidden />
                  Tambah lamaran
                </button>
              )}
            </div>
          )}

          {!loading && visible.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visible.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="group flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-all duration-200 hover:border-primary/30 hover:bg-surface-muted hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium">
                          {job.role}
                        </p>
                        <p className="truncate text-[12px] text-muted">
                          {job.company}
                          {job.location ? ` · ${job.location}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${statusChipClass(
                          job.status,
                        )}`}
                      >
                        {JOB_STATUS_LABEL[job.status]}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <ScoreChip label="Match" value={job.match_score} />
                      <ScoreChip label="Peluang" value={job.success_score} />
                      {job.work_type && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                          {job.work_type}
                        </span>
                      )}
                      {job.deadline && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                          DL {formatDate(job.deadline)}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                      <span>
                        {job.applied_at
                          ? `Dilamar ${formatDate(job.applied_at)}`
                          : "Belum ditandai dilamar"}
                      </span>
                      <ArrowRight
                        size={14}
                        aria-hidden
                        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}