"use client";

import { useEffect, useState } from "react";
import { Check, Globe, Loader2, Save } from "lucide-react";

import {
  crawlJobPortfolio,
  saveJobProfileLinks,
  type JobCv,
} from "@/lib/api";
import {
  OperationStatus,
  type OperationStep,
} from "@/components/ui/OperationStatus";

const PORTFOLIO_STEPS: OperationStep[] = [
  { label: "Menyiapkan link portfolio", at: 0 },
  { label: "Menghubungi halaman portfolio", at: 1 },
  { label: "Mengekstrak konten utama", at: 5 },
  { label: "Menyimpan snapshot portfolio", at: 20 },
];

/**
 * Owner-level candidate links reused by every job application analysis:
 * LinkedIn URL, portfolio URL, and optional text snapshots.
 */
export function JobProfileLinks({
  cv,
  onSaved,
  title = "Profil kandidat",
}: {
  cv: JobCv | null;
  onSaved: (cv: JobCv) => void;
  title?: string;
}) {
  const [linkedin, setLinkedin] = useState(cv?.linkedin_url ?? "");
  const [portfolio, setPortfolio] = useState(cv?.portfolio_url ?? "");
  const [linkedinText, setLinkedinText] = useState("");
  const [portfolioText, setPortfolioText] = useState("");
  const [showText, setShowText] = useState(false);
  const [saving, setSaving] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLinkedin(cv?.linkedin_url ?? "");
    setPortfolio(cv?.portfolio_url ?? "");
  }, [cv?.linkedin_url, cv?.portfolio_url]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Parameters<typeof saveJobProfileLinks>[0] = {
        linkedin_url: linkedin,
        portfolio_url: portfolio,
      };
      // Empty textareas keep the existing snapshot instead of wiping it.
      if (portfolioText.trim()) payload.portfolio_content = portfolioText;
      if (linkedinText.trim()) payload.linkedin_content = linkedinText;
      const saved = await saveJobProfileLinks(payload);
      onSaved(saved);
      setNotice("Link profil tersimpan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan link.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCrawlPortfolio() {
    setCrawling(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await crawlJobPortfolio();
      onSaved(saved);
      setNotice(
        `${saved.portfolio_chars.toLocaleString("id-ID")} karakter portfolio ditarik.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menarik konten portfolio.",
      );
    } finally {
      setCrawling(false);
    }
  }

  const field =
    "mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[12px] font-medium">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        Dipakai saat analisa memilih sumber Portfolio atau LinkedIn.
      </p>

      <div className="mt-2 space-y-2">
        <div>
          <label htmlFor="job-linkedin" className="block text-[11px] text-muted">
            LinkedIn
          </label>
          <input
            id="job-linkedin"
            value={linkedin}
            onChange={(event) => setLinkedin(event.target.value)}
            placeholder="https://www.linkedin.com/in/..."
            className={field}
          />
        </div>
        <div>
          <label htmlFor="job-portfolio" className="block text-[11px] text-muted">
            Portfolio
          </label>
          <input
            id="job-portfolio"
            value={portfolio}
            onChange={(event) => setPortfolio(event.target.value)}
            placeholder="https://nama-domain.com"
            className={field}
          />
          {cv && cv.portfolio_chars > 0 && !showText && (
            <p className="mt-1 text-[10px] text-muted">
              {cv.portfolio_chars.toLocaleString("id-ID")} karakter tersimpan.
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Save size={13} aria-hidden />
          )}
          Simpan link
        </button>
        <button
          type="button"
          onClick={() => void handleCrawlPortfolio()}
          disabled={crawling || !portfolio.trim()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
        >
          {crawling ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Globe size={13} aria-hidden />
          )}
          Tarik portfolio
        </button>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={showText}
            onChange={(event) => setShowText(event.target.checked)}
            className="accent-foreground"
          />
          Isi teks manual
        </label>
      </div>

      {crawling && (
        <OperationStatus
          active
          title="Menarik konten portfolio"
          steps={PORTFOLIO_STEPS}
          note="Konten utama disimpan sebagai snapshot untuk analisa dan surat lamaran."
        />
      )}

      {showText && (
        <div className="mt-2 space-y-2">
          <div>
            <label
              htmlFor="job-portfolio-text"
              className="block text-[11px] text-muted"
            >
              Teks portfolio (opsional, menimpa hasil tarik)
            </label>
            <textarea
              id="job-portfolio-text"
              value={portfolioText}
              onChange={(event) => setPortfolioText(event.target.value)}
              rows={3}
              placeholder="Tempel ringkasan proyek/karya portfolio..."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
            />
          </div>
          <div>
            <label
              htmlFor="job-linkedin-text"
              className="block text-[11px] text-muted"
            >
              Ringkasan LinkedIn (About/Experience)
            </label>
            <textarea
              id="job-linkedin-text"
              value={linkedinText}
              onChange={(event) => setLinkedinText(event.target.value)}
              rows={3}
              placeholder="LinkedIn tidak bisa di-crawl otomatis; tempel ringkasan profil di sini."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
          <Check size={12} aria-hidden />
          {notice}
        </p>
      )}
    </div>
  );
}