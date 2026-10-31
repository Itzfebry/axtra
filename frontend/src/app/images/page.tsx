"use client";

import {
  Ban,
  Check,
  Download,
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { OperationStatus } from "@/components/ui/OperationStatus";
import {
  fetchImageConfig,
  fetchImageCredits,
  fetchImageEndpoints,
  fetchImageModels,
  fetchImageUsage,
  generateImage,
  saveProviderImageSelection,
  streamImageGeneration,
  type ImageCapabilityDescriptor,
  type ImageConfig,
  type ImageCredits,
  type ImageEndpoint,
  type ImageGenerateInput,
  type ImageModel,
  type ImageResult,
  type ImageUsage,
} from "@/lib/api";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted/60 transition-colors duration-150 focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

const STEPS = [
  { label: "Menyiapkan permintaan", at: 0 },
  { label: "Model membuat gambar", at: 1 },
  { label: "Menyusun hasil", at: 8 },
];

type ReferenceImage = { id: string; dataUrl: string; name: string };

type HistoryEntry = {
  id: string;
  prompt: string;
  model: string;
  images: ImageResult[];
  cost: number | null;
  createdAt: number;
};

function capsOf(model: ImageModel | null): Record<string, ImageCapabilityDescriptor> | null {
  if (!model) return null;
  return model.capabilities ?? {};
}

/** Options for a parameter, restricted by the model's capability descriptor. */
function optionsFor(
  caps: Record<string, ImageCapabilityDescriptor> | null,
  param: string,
  all: string[],
): string[] {
  if (!caps) return all;
  const descriptor = caps[param];
  if (!descriptor) return [];
  const typed = descriptor as { type?: string; values?: unknown };
  if (typed.type === "enum" && Array.isArray(typed.values)) {
    return typed.values.map((value) => String(value));
  }
  return all;
}

function supported(
  caps: Record<string, ImageCapabilityDescriptor> | null,
  param: string,
): boolean {
  if (!caps) return true;
  return param in caps;
}

function maxImages(
  caps: Record<string, ImageCapabilityDescriptor> | null,
  ceiling: number,
): number {
  if (!caps) return ceiling;
  const descriptor = caps["n"] as { type?: string; max?: number } | undefined;
  if (!descriptor) return 1;
  if (descriptor.type === "range" && typeof descriptor.max === "number") {
    return Math.max(1, Math.min(ceiling, descriptor.max));
  }
  return Math.max(ceiling, 1);
}

function rangeBounds(
  caps: Record<string, ImageCapabilityDescriptor> | null,
  param: string,
  fallbackMin: number,
  fallbackMax: number,
): { min: number; max: number } {
  if (!caps) return { min: fallbackMin, max: fallbackMax };
  const descriptor = caps[param] as { type?: string; min?: number; max?: number } | undefined;
  if (!descriptor) return { min: fallbackMin, max: fallbackMax };
  return {
    min: typeof descriptor.min === "number" ? descriptor.min : fallbackMin,
    max: typeof descriptor.max === "number" ? descriptor.max : fallbackMax,
  };
}

function formatCost(value: number | null): string | null {
  if (value === null) return null;
  return `$${value.toFixed(4)}`;
}

/** The value actually sent/selected: first allowed option when current is invalid. */
function pick(options: string[], current: string): string {
  if (options.length === 0) return "";
  return options.includes(current) ? current : options[0];
}

export default function ImagesPage() {
  const [config, setConfig] = useState<ImageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [quality, setQuality] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("png");
  const [background, setBackground] = useState("auto");
  const [seed, setSeed] = useState("");
  const [steps, setSteps] = useState("");
  const [count, setCount] = useState(1);

  const [model, setModel] = useState("");
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);

  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState<string | null>(null);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [credits, setCredits] = useState<ImageCredits | null>(null);
  const [usage, setUsage] = useState<ImageUsage | null>(null);
  const [savedDefault, setSavedDefault] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [endpoints, setEndpoints] = useState<ImageEndpoint[]>([]);
  const [endpointsBusy, setEndpointsBusy] = useState(false);
  const [onlySlugs, setOnlySlugs] = useState<string[]>([]);
  const [routingSort, setRoutingSort] = useState("");
  const [allowFallbacks, setAllowFallbacks] = useState(true);

  const loadSideInfo = useCallback(async () => {
    fetchImageUsage()
      .then(setUsage)
      .catch(() => undefined);
    fetchImageCredits()
      .then(setCredits)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchImageConfig()
      .then((data) => {
        setConfig(data);
        setModel(data.model);
        setCount(1);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Gagal memuat konfigurasi."),
      );
    void loadSideInfo();
  }, [loadSideInfo]);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === model) ?? null,
    [models, model],
  );
  const caps = useMemo(() => capsOf(selectedModel), [selectedModel]);

  const ratioOptions = optionsFor(caps, "aspect_ratio", config?.aspect_ratios ?? []);
  const resolutionOptions = optionsFor(caps, "resolution", config?.resolutions ?? []);
  const qualityOptions = optionsFor(caps, "quality", config?.qualities ?? []);
  const formatOptions = optionsFor(caps, "output_format", config?.output_formats ?? []);
  const backgroundOptions = optionsFor(caps, "background", config?.backgrounds ?? []);
  const nMax = maxImages(caps, config?.max_n ?? 4);
  const refsAllowed =
    supported(caps, "input_references") &&
    (selectedModel === null || selectedModel.input_modalities.includes("image") ||
      selectedModel.input_modalities.length === 0);
  const seedAllowed = supported(caps, "seed");
  const stepsAllowed = supported(caps, "steps");
  const stepsBounds = rangeBounds(caps, "steps", 1, 20);
  const streaming = selectedModel?.supports_streaming ?? false;

  const ratioValue = pick(ratioOptions, aspectRatio);
  const resolutionValue = pick(resolutionOptions, resolution);
  const qualityValue = pick(qualityOptions, quality);
  const formatValue = pick(formatOptions, outputFormat);
  const backgroundValue = pick(backgroundOptions, background);

  const budgetReached =
    usage !== null && usage.day_limit > 0 && usage.day_images >= usage.day_limit;
  const lowBalance =
    credits?.available === true &&
    credits.remaining !== null &&
    credits.remaining <= 1;

  // Keep count within the model's allowed maximum.
  useEffect(() => {
    setCount((current) => Math.min(current, Math.max(1, nMax)));
  }, [nMax]);

  const loadModels = useCallback(async () => {
    setModelsBusy(true);
    setError(null);
    try {
      const data = await fetchImageModels();
      setModels(data.models);
      if (data.models.length === 0) setNotice("Provider tidak melaporkan model gambar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat model gambar.");
    } finally {
      setModelsBusy(false);
    }
  }, []);

  const loadEndpoints = useCallback(async () => {
    if (!model.trim()) return;
    setEndpointsBusy(true);
    setError(null);
    try {
      const data = await fetchImageEndpoints(model.trim());
      setEndpoints(data.endpoints);
      if (data.endpoints.length === 0) {
        setNotice("Provider tidak melaporkan endpoint untuk model ini.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat endpoint.");
    } finally {
      setEndpointsBusy(false);
    }
  }, [model]);

  function addReferenceFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 4 - references.length)) {
      if (file.size > 6 * 1024 * 1024) {
        setError(`"${file.name}" lebih dari 6 MB, dilewati.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) return;
        setReferences((current) => [
          ...current.slice(0, 7),
          { id: `${Date.now()}-${current.length}`, dataUrl, name: file.name },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }

  async function handleSaveDefault() {
    if (!config || !model.trim()) return;
    setError(null);
    try {
      await saveProviderImageSelection(config.provider, model.trim());
      setSavedDefault(true);
      setNotice("Model gambar dijadikan default.");
      window.setTimeout(() => setSavedDefault(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan default.");
    }
  }

  function pushHistory(entry: Omit<HistoryEntry, "id" | "createdAt">) {
    setHistory((current) =>
      [
        { ...entry, id: `${Date.now()}`, createdAt: Date.now() },
        ...current,
      ].slice(0, 12),
    );
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;
    if (quality === "high" && !window.confirm("Kualitas high lebih mahal. Lanjutkan?")) {
      return;
    }
    const input: ImageGenerateInput = {
      prompt: prompt.trim(),
      model: model.trim(),
      aspect_ratio: ratioValue,
      resolution: resolutionValue,
      quality: qualityValue,
      output_format: formatValue,
      background: backgroundValue,
      input_references: refsAllowed
        ? references.map((ref) => ref.dataUrl)
        : [],
      n: count,
    };
    const parsedSeed = Number(seed);
    if (seed.trim() && Number.isFinite(parsedSeed) && parsedSeed >= 0) {
      input.seed = Math.floor(parsedSeed);
    }
    const parsedSteps = Number(steps);
    if (stepsAllowed && steps.trim() && Number.isFinite(parsedSteps)) {
      input.steps = Math.max(
        stepsBounds.min,
        Math.min(stepsBounds.max, Math.floor(parsedSteps)),
      );
    }
    if (showAdvanced) {
      if (onlySlugs.length > 0) input.provider_only = onlySlugs;
      if (routingSort) input.provider_sort = routingSort;
      input.provider_allow_fallbacks = allowFallbacks;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setResults([]);
    setPartial(null);
    setCost(null);

    try {
      if (streaming) {
        for await (const event of streamImageGeneration(input)) {
          if (event.type === "partial") {
            setPartial(event.data_url);
          } else if (event.type === "completed") {
            setResults(event.images);
            const usageCost = (event.usage as { cost?: number } | undefined)?.cost;
            const value = typeof usageCost === "number" ? usageCost : null;
            setCost(value);
            pushHistory({
              prompt: input.prompt,
              model: event.model,
              images: event.images,
              cost: value,
            });
          } else if (event.type === "error") {
            setError(event.detail);
          }
        }
      } else {
        const data = await generateImage(input);
        setResults(data.images);
        const usageCost = (data.usage as { cost?: number } | undefined)?.cost;
        const value = typeof usageCost === "number" ? usageCost : null;
        setCost(value);
        pushHistory({
          prompt: input.prompt,
          model: data.model,
          images: data.images,
          cost: value,
        });
      }
      await loadSideInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat gambar.");
    } finally {
      setBusy(false);
      setPartial(null);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-16">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Kreator</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight font-brand">
                Generated Image
              </h1>
              <p className="mt-1 max-w-2xl text-[14px] text-muted">
                Buat gambar dari deskripsi teks, lengkap dengan gambar referensi,
                streaming pratinjau, dan riwayat sesi.
              </p>
            </div>
          </header>

          {config && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              <span>
                Model aktif:{" "}
                <span className="text-foreground">
                  {config.provider_label} · {model || config.model || "belum dipilih"}
                </span>
              </span>
              {!config.key_ok && (
                <span className="text-danger">· API key provider gambar belum diatur</span>
              )}
              {usage && (
                <span className="inline-flex items-center gap-1">
                  <Wallet size={11} aria-hidden />
                  Hari ini: {usage.day_images} gambar
                  {usage.day_limit > 0 && ` / ${usage.day_limit}`}
                  {usage.day_cost > 0 && ` · $${usage.day_cost.toFixed(4)}`}
                </span>
              )}
              {credits?.available && credits.remaining !== null && (
                <span className={lowBalance ? "text-danger" : undefined}>
                  · Saldo ~${credits.remaining.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {credits && !credits.available && credits.detail && (
            <p className="mt-2 text-[11px] text-muted">{credits.detail}</p>
          )}
          {budgetReached && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              Batas harian {usage?.day_limit} gambar tercapai. Coba lagi besok.
            </p>
          )}
          {lowBalance && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              Saldo OpenRouter ≤ $1. Image API menolak request (402); isi saldo dulu.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-3 rounded-lg border border-border px-3 py-2 text-[12px] text-muted">
              {notice}
            </p>
          )}

          <form
            onSubmit={handleGenerate}
            className="mt-5 space-y-3 rounded-xl border border-border bg-surface p-4"
          >
            <div>
              <label htmlFor="image-prompt" className="block text-[12px] text-muted">
                Deskripsi gambar
              </label>
              <textarea
                id="image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder="Contoh: Hero shot produk kopi di permukaan hitam mengilap, cahaya rim lembut, palet teal."
                className={`mt-1 ${inputClass}`}
              />
            </div>

            <div>
              <label htmlFor="image-model" className="block text-[12px] text-muted">
                Model gambar
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id="image-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="mis. google/gemini-3-pro-image"
                  className={inputClass}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => void loadModels()}
                  disabled={modelsBusy}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {modelsBusy ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw size={13} aria-hidden />
                  )}
                  Muat model
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDefault()}
                  disabled={!model.trim() || savedDefault}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {savedDefault ? <Check size={13} aria-hidden /> : <Star size={13} aria-hidden />}
                  Jadikan default
                </button>
              </div>
              {models.length > 0 && (
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className={`mt-2 ${inputClass}`}
                  aria-label="Pilih model gambar"
                >
                  <option value="">— pilih model —</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.supports_streaming ? " ⚡" : ""}
                    </option>
                  ))}
                </select>
              )}
              {selectedModel && (
                <p className="mt-1 text-[11px] text-muted">
                  Parameter yang tak didukung model ini disembunyikan otomatis.
                  {selectedModel.supports_streaming && " Streaming pratinjau aktif."}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {ratioOptions.length > 0 && (
                <div>
                  <label htmlFor="image-ratio" className="block text-[12px] text-muted">
                    Rasio
                  </label>
                  <select
                    id="image-ratio"
                    value={ratioOptions.includes(aspectRatio) ? aspectRatio : ratioOptions[0]}
                    onChange={(event) => setAspectRatio(event.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    {ratioOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {resolutionOptions.length > 0 && (
                <div>
                  <label htmlFor="image-res" className="block text-[12px] text-muted">
                    Resolusi
                  </label>
                  <select
                    id="image-res"
                    value={resolutionOptions.includes(resolution) ? resolution : resolutionOptions[0]}
                    onChange={(event) => setResolution(event.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    {resolutionOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {qualityOptions.length > 0 && (
                <div>
                  <label htmlFor="image-quality" className="block text-[12px] text-muted">
                    Kualitas
                  </label>
                  <select
                    id="image-quality"
                    value={qualityOptions.includes(quality) ? quality : qualityOptions[0]}
                    onChange={(event) => setQuality(event.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    {qualityOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {formatOptions.length > 0 && (
                <div>
                  <label htmlFor="image-format" className="block text-[12px] text-muted">
                    Format
                  </label>
                  <select
                    id="image-format"
                    value={formatOptions.includes(outputFormat) ? outputFormat : formatOptions[0]}
                    onChange={(event) => setOutputFormat(event.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    {formatOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {backgroundOptions.length > 0 && (
                <div>
                  <label htmlFor="image-bg" className="block text-[12px] text-muted">
                    Latar
                  </label>
                  <select
                    id="image-bg"
                    value={backgroundOptions.includes(background) ? background : backgroundOptions[0]}
                    onChange={(event) => setBackground(event.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    {backgroundOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {seedAllowed && (
                <div>
                  <label htmlFor="image-seed" className="block text-[12px] text-muted">
                    Seed (opsional)
                  </label>
                  <input
                    id="image-seed"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="angka"
                    inputMode="numeric"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              )}
              {stepsAllowed && (
                <div>
                  <label htmlFor="image-steps" className="block text-[12px] text-muted">
                    Langkah (opsional)
                  </label>
                  <input
                    id="image-steps"
                    value={steps}
                    onChange={(event) => setSteps(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={`${stepsBounds.min}–${stepsBounds.max}`}
                    inputMode="numeric"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              )}
            </div>

            {refsAllowed && (
              <div>
                <label className="block text-[12px] text-muted">
                  Gambar referensi (image-to-image)
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {references.map((ref) => (
                    <span
                      key={ref.id}
                      className="relative inline-flex h-14 w-14 overflow-hidden rounded-lg border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ref.dataUrl} alt={ref.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setReferences((current) => current.filter((item) => item.id !== ref.id))
                        }
                        className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-bl bg-black/60 text-white"
                        aria-label="Hapus referensi"
                      >
                        <X size={7} aria-hidden />
                      </button>
                    </span>
                  ))}
                  {references.length < 4 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border text-[10px] text-muted transition-colors duration-150 hover:bg-surface-muted"
                    >
                      <Upload size={13} aria-hidden />
                      Tambah
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(event) => {
                      addReferenceFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/70 bg-surface-muted/40 p-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
                className="flex w-full items-center justify-between text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
              >
                <span>Routing provider (opsional)</span>
                <span>{showAdvanced ? "−" : "+"}</span>
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadEndpoints()}
                      disabled={endpointsBusy || !model.trim()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      {endpointsBusy ? (
                        <Loader2 size={12} className="animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw size={12} aria-hidden />
                      )}
                      Muat endpoint
                    </button>
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">
                      Urutkan
                      <select
                        value={routingSort}
                        onChange={(event) => setRoutingSort(event.target.value)}
                        className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none"
                      >
                        <option value="">default</option>
                        <option value="price">price</option>
                        <option value="throughput">throughput</option>
                        <option value="latency">latency</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        checked={allowFallbacks}
                        onChange={(event) => setAllowFallbacks(event.target.checked)}
                      />
                      Izinkan fallback
                    </label>
                  </div>
                  {endpoints.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted">
                        Batasi ke provider (kosong = otomatis):
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {endpoints.map((endpoint) => {
                          const slug = endpoint.provider_tag || endpoint.provider_slug;
                          const active = onlySlugs.includes(slug);
                          return (
                            <button
                              key={`${endpoint.provider_slug}-${slug}`}
                              type="button"
                              onClick={() =>
                                setOnlySlugs((current) =>
                                  active
                                    ? current.filter((item) => item !== slug)
                                    : [...current, slug],
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-150 ${
                                active
                                  ? "border-primary/60 bg-primary/10 text-foreground"
                                  : "border-border text-muted hover:bg-surface-muted"
                              }`}
                            >
                              {active && <Check size={10} aria-hidden />}
                              {endpoint.provider_name || endpoint.provider_slug}
                              {endpoint.supports_streaming && " ⚡"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              {nMax > 1 && (
                <label className="flex items-center gap-2 text-[12px] text-muted">
                  Jumlah
                  <input
                    type="number"
                    min={1}
                    max={nMax}
                    value={count}
                    onChange={(event) =>
                      setCount(
                        Math.max(1, Math.min(nMax, Number(event.target.value) || 1)),
                      )
                    }
                    className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={busy || !prompt.trim() || !config?.key_ok || budgetReached}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Sparkles size={14} aria-hidden />
                )}
                Buat gambar
              </button>
            </div>

            <OperationStatus
              active={busy}
              title={streaming ? "Membuat gambar (streaming)" : "Membuat gambar"}
              steps={STEPS}
              note={
                streaming
                  ? "Pratinjau muncul bertahap sampai gambar final siap."
                  : "Model gambar bisa butuh 10-60 detik."
              }
            />
          </form>

          {busy && partial && (
            <section className="mt-5">
              <h2 className="text-[13px] font-medium">Pratinjau</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={partial}
                alt="Pratinjau sebagian"
                className="mt-2 w-full max-w-md rounded-xl border border-border"
              />
            </section>
          )}

          {results.length > 0 && (
            <section className="mt-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-medium">Hasil</h2>
                {formatCost(cost) && (
                  <span className="text-[11px] text-muted">Biaya: {formatCost(cost)}</span>
                )}
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {results.map((item, index) => (
                  <li
                    key={`${item.media_type}-${index}`}
                    className="overflow-hidden rounded-xl border border-border bg-surface"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.data_url}
                      alt={`Hasil gambar ${index + 1}`}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                        <ImageIcon size={11} aria-hidden />
                        {item.media_type}
                      </span>
                      <a
                        href={item.data_url}
                        download={`axtra-image-${index + 1}.${
                          item.media_type.split("/")[1] || "png"
                        }`}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                      >
                        <Download size={11} aria-hidden />
                        Unduh
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">
                Hasil tidak disimpan di server. Unduh untuk menyimpannya.
              </p>
            </section>
          )}

          {history.length > 0 && (
            <section className="mt-7">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-medium">Riwayat sesi</h2>
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors duration-150 hover:text-foreground"
                >
                  <Ban size={11} aria-hidden /> Bersihkan
                </button>
              </div>
              <ul className="mt-3 space-y-2">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2"
                  >
                    <div className="flex shrink-0 gap-1">
                      {entry.images.slice(0, 2).map((image, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={index}
                          src={image.data_url}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-foreground">{entry.prompt}</p>
                      <p className="truncate text-[11px] text-muted">
                        {entry.model} · {entry.images.length} gambar
                        {formatCost(entry.cost) && ` · ${formatCost(entry.cost)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(entry.prompt);
                        setResults(entry.images);
                        setCost(entry.cost);
                      }}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                    >
                      <Plus size={11} aria-hidden /> Muat
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
