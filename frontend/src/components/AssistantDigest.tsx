"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { fetchRecommendations, type Recommendations } from "@/lib/api";

const CACHE_KEY = "axtra-recommendations";

function readCache(): Recommendations | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Recommendations) : null;
  } catch {
    return null;
  }
}

function writeCache(data: Recommendations) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage may be unavailable; caching is best-effort.
  }
}

/**
 * Assistant digest on the homepage: a short greeting plus actionable advice
 * derived from a backend summary of the user's recent interaction history.
 * The result is cached so a page reload shows it without regenerating; only
 * the refresh button asks the backend for a new digest.
 */
export function AssistantDigest({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<Recommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const fresh = await fetchRecommendations();
      setData(fresh);
      writeCache(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat rekomendasi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Rekomendasi Axtra"
      aria-busy={loading}
      className={
        embedded
          ? "p-3"
          : "mt-8 rounded-xl border border-border bg-surface p-4 sm:p-5"
      }
    >
      <div className="flex items-start gap-3">
        <Image
          src="/axtratr.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {!embedded && <p className="text-[12px] text-muted">Axtra · Asisten</p>}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              aria-label="Perbarui rekomendasi"
              title="Perbarui rekomendasi"
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-50 ${
                embedded ? "ml-auto" : ""
              }`}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden />
            </button>
          </div>

          {loading && !data && (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-surface-muted" />
            </div>
          )}

          {error && !data && (
            <div className="mt-3">
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void load(true)}
                className="mt-2 inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
              >
                Coba lagi
              </button>
            </div>
          )}

          {data && (
            <div className="mt-1.5">
              <p className="text-[14px] leading-relaxed text-foreground">{data.greeting}</p>
              {data.items.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {data.items.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex items-start gap-2">
                      <Sparkles size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                      <span className="text-[13px] leading-relaxed text-muted">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-muted">
                Berdasarkan {data.conversation_count} percakapan dan {data.memory_count} memori.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}