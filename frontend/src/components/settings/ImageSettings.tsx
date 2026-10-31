"use client";

import {
  Check,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchImageConfig,
  fetchImageModels,
  listProviders,
  saveImageStyle,
  saveProviderImageSelection,
  type ImageConfig,
  type ImageModel,
  type ImageStyle,
  type Provider,
} from "@/lib/api";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-muted/60 outline-none transition-colors duration-150 focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

export function ImageSettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ImageModel[] | null>(null);
  const [config, setConfig] = useState<ImageConfig | null>(null);
  const [styles, setStyles] = useState<ImageStyle[]>([]);
  const [style, setStyle] = useState("none");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const rows = await listProviders();
    setProviders(rows);
    setProviderId((current) => {
      if (current && rows.some((item) => item.id === current)) return current;
      return (
        rows.find((item) => item.active_image)?.id ??
        rows.find((item) => item.id === "openrouter")?.id ??
        rows[0]?.id ??
        ""
      );
    });
    const imageProvider = rows.find((item) => item.active_image);
    if (imageProvider) {
      setModel((current) => current || imageProvider.selected_image_model);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadProviders(), fetchImageConfig()])
      .then(([, result]) => {
        if (cancelled) return;
        setConfig(result);
        setStyles(result.styles);
        setStyle(result.style || "none");
        setModel((current) => current || result.model);
        setProviderId((current) => current || result.provider);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Gagal memuat model gambar.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadProviders]);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    setModels(null);
    fetchImageModels(providerId)
      .then((result) => {
        if (!cancelled) setModels(result.models);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const provider = useMemo(
    () => providers?.find((item) => item.id === providerId) ?? null,
    [providers, providerId],
  );

  async function handleSaveModel() {
    if (!providerId) return;
    setBusy("model");
    setError(null);
    setNotice(null);
    try {
      await saveProviderImageSelection(providerId, model.trim());
      setNotice(
        model.trim()
          ? `Model gambar aktif: ${model.trim()}`
          : "Model gambar dikosongkan; server akan memakai default.",
      );
      await loadProviders();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan model gambar.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveStyle() {
    setBusy("style");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveImageStyle(style);
      setStyle(saved.id);
      setNotice(`Style gambar disimpan: ${saved.label || saved.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan style gambar.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!providers) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Memuat pengaturan gambar...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[12px] text-success">
          {notice}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-muted">
              <ImageIcon size={12} aria-hidden /> Model gambar
            </h2>
            <button
              type="button"
              onClick={() => {
                setModels(null);
                fetchImageModels(providerId)
                  .then((result) => setModels(result.models))
                  .catch(() => setModels([]));
              }}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
            >
              <RefreshCw size={11} aria-hidden />
              Muat ulang katalog
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Slot terpisah dari model teks. Dipakai halaman Gambar lewat Image
            API. Provider harus mendukung Image API (mis. OpenRouter atau
            Cloudflare Workers AI).
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
            <div>
              <label
                htmlFor="image-provider"
                className="block text-[11px] text-muted"
              >
                Provider gambar
              </label>
              <select
                id="image-provider"
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setModel("");
                }}
                className={`${inputClass} mt-1`}
              >
                <option value="">— provider —</option>
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="image-model"
                className="block text-[11px] text-muted"
              >
                Model gambar
              </label>
              <input
                id="image-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                list="image-model-options"
                placeholder="mis. google/gemini-3-pro-image"
                className={`${inputClass} mt-1`}
                autoComplete="off"
              />
              <datalist id="image-model-options">
                {(models ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveModel()}
              disabled={busy !== null || !providerId}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
            >
              {busy === "model" ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Check size={12} aria-hidden />
              )}
              Simpan model gambar
            </button>
            <span className="text-[11px] text-muted">
              Status key:{" "}
              <span
                className={
                  provider && provider.key_source !== "none"
                    ? "text-success"
                    : "text-muted"
                }
              >
                {provider
                  ? provider.key_source === "user"
                    ? "Key kamu"
                    : provider.key_source === "env"
                      ? "Key dari env"
                      : "Belum ada key"
                  : "—"}
              </span>
            </span>
            {config && (
              <span className="text-[11px] text-muted">
                Default server: {config.model || "—"}
              </span>
            )}
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">
                Katalog model gambar{" "}
                {models === null ? "· memuat..." : `· ${models.length} model`}
              </p>
              {model && (
                <button
                  type="button"
                  onClick={() => setModel("")}
                  className="text-[11px] text-muted transition-colors duration-150 hover:text-foreground"
                >
                  Kosongkan pilihan
                </button>
              )}
            </div>
            {models && models.length > 0 ? (
              <ul className="mt-2 grid max-h-80 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 2xl:grid-cols-3">
                {models.map((item) => {
                  const selected = item.id === model;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setModel(item.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${
                          selected
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-background hover:bg-surface-muted"
                        }`}
                      >
                        <span className="block truncate text-[12px] font-medium text-foreground">
                          {item.name || item.id}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                          {item.id}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {item.output_modalities.slice(0, 3).map((modality) => (
                            <span
                              key={modality}
                              className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted"
                            >
                              {modality}
                            </span>
                          ))}
                          {item.supports_streaming && (
                            <span className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted">
                              streaming
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : models === null ? (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                <Loader2 size={12} className="animate-spin" aria-hidden />
                Memuat katalog...
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted">
                Katalog belum tersedia. Isi model secara manual atau cek API key
                provider.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-muted">
              <Sparkles size={12} aria-hidden /> Style default
            </h2>
            <p className="mt-1 text-[11px] text-muted">
              Dipakai halaman Gambar saat prompt tidak menentukan style sendiri.
            </p>
            <label
              htmlFor="image-style"
              className="mt-3 block text-[11px] text-muted"
            >
              Style
            </label>
            <select
              id="image-style"
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              className={`${inputClass} mt-1`}
            >
              {styles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleSaveStyle()}
              disabled={busy !== null || styles.length === 0}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
            >
              {busy === "style" ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={12} aria-hidden />
              )}
              Simpan style
            </button>
          </div>

          {config && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-muted">
                <ShieldCheck size={12} aria-hidden /> Info Image API
              </h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div>
                  <dt className="text-muted">Provider aktif</dt>
                  <dd className="text-foreground">{config.provider_label}</dd>
                </div>
                <div>
                  <dt className="text-muted">Key</dt>
                  <dd className={config.key_ok ? "text-success" : "text-danger"}>
                    {config.key_ok ? "Siap" : "Belum ada"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Batas harian</dt>
                  <dd className="text-foreground">
                    {config.daily_limit > 0 ? config.daily_limit : "Tanpa batas"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Maks gambar</dt>
                  <dd className="text-foreground">{config.max_n}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1">
                {config.aspect_ratios.slice(0, 8).map((ratio) => (
                  <span
                    key={ratio}
                    className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted"
                  >
                    {ratio}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}