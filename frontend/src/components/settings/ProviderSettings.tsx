"use client";

import {
  AlertTriangle,
  Check,
  Cpu,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Modal, type ModalTone } from "@/components/ui/Modal";
import {
  createProvider,
  deleteProvider,
  deleteProviderKey,
  fetchProviderQuota,
  fetchProviderRecommendations,
  listProviders,
  listProviderModels,
  pingProvider,
  saveProviderImageSelection,
  saveProviderKey,
  saveProviderSelection,
  type Provider,
  type ProviderModel,
  type ProviderModels,
  type ProviderPing,
  type ProviderQuota,
  type ProviderRecommendation,
} from "@/lib/api";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-muted/60 outline-none transition-colors duration-150 focus:border-primary/60 focus:ring-2 focus:ring-primary/15";

function formatContext(value: number | null): string {
  if (!value) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}jt`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}rb`;
  return String(value);
}

function priceLabel(model: ProviderModel): string {
  if (model.free) return "Gratis";
  if (!model.pricing) return "Harga tidak tersedia";
  const prompt = model.pricing.prompt;
  const completion = model.pricing.completion;
  if (prompt == null && completion == null) return "Harga tidak tersedia";
  return `$${prompt ?? "?"} / $${completion ?? "?"} per 1M`;
}

function statusLabel(provider: Provider): { text: string; className: string } {
  if (provider.key_source === "user") {
    return { text: "Key kamu", className: "text-success" };
  }
  if (provider.key_source === "env") {
    return { text: "Key dari env", className: "text-primary" };
  }
  return { text: "Belum ada key", className: "text-muted" };
}

export function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [activeId, setActiveId] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ping, setPing] = useState<ProviderPing | null>(null);
  const [quota, setQuota] = useState<ProviderQuota | null>(null);
  const [catalog, setCatalog] = useState<ProviderModels | null>(null);
  const [recs, setRecs] = useState<ProviderRecommendation[]>([]);
  const [search, setSearch] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addBaseUrl, setAddBaseUrl] = useState("");
  const [addKey, setAddKey] = useState("");
  const [addModel, setAddModel] = useState("");
  const [modal, setModal] = useState<{
    tone: ModalTone;
    title: string;
    message?: string;
  } | null>(null);
  const [imageProviderId, setImageProviderId] = useState("");
  const [imageModel, setImageModel] = useState("");

  const provider = useMemo(
    () => providers?.find((item) => item.id === activeId) ?? null,
    [providers, activeId],
  );

  const load = useCallback(async () => {
    setError(null);
    const rows = await listProviders();
    setProviders(rows);
    setActiveId((current) => {
      if (current && rows.some((item) => item.id === current)) return current;
      return rows.find((item) => item.active)?.id ?? rows[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Gagal memuat provider."),
    );
  }, [load]);

  useEffect(() => {
    if (!providers) return;
    const imageProvider = providers.find((item) => item.active_image);
    if (imageProvider) {
      setImageProviderId((current) => current || imageProvider.id);
      setImageModel((current) => current || imageProvider.selected_image_model);
    } else {
      setImageProviderId(
        (current) =>
          current ||
          providers.find((item) => item.id === "openrouter")?.id ||
          providers[0]?.id ||
          "",
      );
    }
  }, [providers]);

  const loadQuota = useCallback(async (providerId: string) => {
    try {
      setQuota(await fetchProviderQuota(providerId));
    } catch {
      setQuota(null);
    }
  }, []);

  const keySource = provider?.key_source ?? "none";

  useEffect(() => {
    setPing(null);
    setCatalog(null);
    setRecs([]);
    setSearch("");
    if (!activeId) return;
    void loadQuota(activeId);
    if (keySource !== "none") {
      fetchProviderRecommendations(activeId)
        .then((result) => setRecs(result.recommendations))
        .catch(() => setRecs([]));
    }
  }, [activeId, keySource, loadQuota]);

  async function handleSaveKey(event: React.FormEvent) {
    event.preventDefault();
    if (!provider || !keyInput.trim()) return;
    setBusy("key");
    setError(null);
    setNotice(null);
    try {
      await saveProviderKey(provider.id, keyInput.trim(), provider.selected_model);
      setKeyInput("");
      setNotice(`API key ${provider.label} tersimpan terenkripsi di server.`);
      await load();
      await loadQuota(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan key.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteKey() {
    if (!provider) return;
    if (!window.confirm(`Hapus API key ${provider.label} milikmu?`)) return;
    setBusy("key");
    setError(null);
    try {
      await deleteProviderKey(provider.id);
      setNotice(`API key ${provider.label} dihapus.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus key.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePing() {
    if (!provider) return;
    setBusy("ping");
    setError(null);
    try {
      setPing(await pingProvider(provider.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ping gagal.");
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadModels(force = false) {
    if (!provider) return;
    setBusy("models");
    setError(null);
    try {
      setCatalog(await listProviderModels(provider.id, force));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat model.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectModel(modelId: string) {
    if (!provider) return;
    setBusy("select");
    setError(null);
    try {
      await saveProviderSelection(provider.id, modelId);
      setModal({
        tone: "success",
        title: "Model berhasil dipakai",
        message: modelId,
      });
      await load();
    } catch (err) {
      setModal({
        tone: "error",
        title: "Gagal memakai model",
        message: err instanceof Error ? err.message : "Terjadi kesalahan.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!addLabel.trim() || !addBaseUrl.trim()) return;
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      const created = await createProvider({
        label: addLabel.trim(),
        base_url: addBaseUrl.trim(),
        api_key: addKey.trim(),
        model: addModel.trim(),
      });
      setAddLabel("");
      setAddBaseUrl("");
      setAddKey("");
      setAddModel("");
      setShowAdd(false);
      setNotice(`Provider ${created.label} ditambahkan.`);
      await load();
      setActiveId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah provider.");
    } finally {
      setBusy(null);
    }
  }

  async function handleActivate(target: Provider) {
    if (!target) return;
    setBusy(`activate:${target.id}`);
    setError(null);
    try {
      await saveProviderSelection(
        target.id,
        target.active ? target.selected_model : "",
      );
      setModal({
        tone: "success",
        title: "Provider berhasil dipakai",
        message: target.label,
      });
      await load();
      setActiveId(target.id);
    } catch (err) {
      setModal({
        tone: "error",
        title: "Gagal memakai provider",
        message: err instanceof Error ? err.message : "Terjadi kesalahan.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveImageModel() {
    if (!imageProviderId) return;
    setBusy("image");
    setError(null);
    try {
      await saveProviderImageSelection(imageProviderId, imageModel.trim());
      setModal({
        tone: "success",
        title: "Model gambar disimpan",
        message: imageModel.trim() || "(kosong)",
      });
      await load();
    } catch (err) {
      setModal({
        tone: "error",
        title: "Gagal menyimpan model gambar",
        message: err instanceof Error ? err.message : "Terjadi kesalahan.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteProvider() {
    if (!provider) return;
    if (
      !window.confirm(
        `Hapus provider ${provider.label} beserta API key-nya?`,
      )
    )
      return;
    setBusy("delete");
    setError(null);
    try {
      await deleteProvider(provider.id);
      setNotice(`Provider ${provider.label} dihapus.`);
      setActiveId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus provider.");
    } finally {
      setBusy(null);
    }
  }

  const visibleModels = useMemo(() => {
    const list = catalog?.models ?? [];
    const query = search.trim().toLowerCase();
    return list.filter((model) => {
      if (freeOnly && !model.free) return false;
      if (!query) return true;
      return (
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query)
      );
    });
  }, [catalog, search, freeOnly]);

  if (!providers) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Memuat provider...
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

      {/* Provider selector */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[12px] uppercase tracking-wide text-muted">
            Provider
          </h2>
          <button
            type="button"
            onClick={() => setShowAdd((value) => !value)}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
          >
            <Plus size={11} aria-hidden />
            Tambah provider
          </button>
        </div>

        {showAdd && (
          <form
            onSubmit={handleCreateProvider}
            className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3"
          >
            <p className="text-[11px] text-muted">
              Provider OpenAI-compatible sendiri (endpoint <code>/chat/completions</code>).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={addLabel}
                onChange={(event) => setAddLabel(event.target.value)}
                placeholder="Nama (mis. Lokal LM Studio)"
                className={inputClass}
                autoComplete="off"
              />
              <input
                value={addBaseUrl}
                onChange={(event) => setAddBaseUrl(event.target.value)}
                placeholder="Base URL (mis. http://localhost:1234/v1)"
                className={inputClass}
                autoComplete="off"
              />
              <input
                type="password"
                value={addKey}
                onChange={(event) => setAddKey(event.target.value)}
                placeholder="API key (opsional)"
                className={inputClass}
                autoComplete="off"
              />
              <input
                value={addModel}
                onChange={(event) => setAddModel(event.target.value)}
                placeholder="Model awal (opsional)"
                className={inputClass}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy !== null || !addLabel.trim() || !addBaseUrl.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
              >
                {busy === "add" ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                ) : (
                  <Plus size={12} aria-hidden />
                )}
                Simpan provider
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted"
              >
                Batal
              </button>
            </div>
          </form>
        )}

        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {providers.map((item) => {
            const status = statusLabel(item);
            const selected = item.id === activeId;
            return (
              <li
                key={item.id}
                className={`flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 ${
                  selected ? "bg-primary/5" : "bg-background"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {item.label}
                    </span>
                    {item.custom && <Tag label="custom" />}
                    {item.active && (
                      <span className="rounded border border-primary/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary">
                        aktif
                      </span>
                    )}
                  </span>
                  <span className={`mt-0.5 block text-[11px] ${status.className}`}>
                    {status.text}
                  </span>
                </button>
                {!item.active && (
                  <button
                    type="button"
                    onClick={() => void handleActivate(item)}
                    disabled={busy !== null}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                  >
                    {busy === `activate:${item.id}` ? (
                      <Loader2 size={11} className="animate-spin" aria-hidden />
                    ) : (
                      <Zap size={11} aria-hidden />
                    )}
                    Pakai
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {provider && (
        <>
          {/* Key + connection */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-medium text-foreground">
                  {provider.label}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted">{provider.notes}</p>
              </div>
              <a
                href={provider.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors duration-150 hover:text-foreground"
              >
                Dokumentasi <ExternalLink size={11} aria-hidden />
              </a>
            </div>

            <p className="mt-2 truncate text-[11px] text-muted">
              Base URL: <span className="text-foreground/80">{provider.base_url}</span>
            </p>

            <form onSubmit={handleSaveKey} className="mt-3 space-y-2">
              <label htmlFor="provider-key" className="block text-[11px] text-muted">
                API key (disimpan terenkripsi, tidak pernah dikirim balik ke browser)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <KeyRound
                    size={13}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <input
                    id="provider-key"
                    type="password"
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                    placeholder={
                      provider.user_key
                        ? `Tersimpan: ${provider.key_masked}`
                        : provider.env_key
                          ? "Key server sudah aktif; isi untuk menimpa"
                          : "Tempel API key provider di sini"
                    }
                    className={`${inputClass} pl-8`}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy !== null || !keyInput.trim()}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "key" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck size={13} aria-hidden />
                  )}
                  Simpan key
                </button>
                {provider.user_key && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteKey()}
                    disabled={busy !== null}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-danger transition-colors duration-150 hover:bg-danger/5 disabled:opacity-40"
                  >
                    <Trash2 size={13} aria-hidden />
                    Hapus
                  </button>
                )}
              </div>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePing()}
                disabled={busy !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
              >
                {busy === "ping" ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                ) : (
                  <Wifi size={12} aria-hidden />
                )}
                Cek koneksi
              </button>
              {ping && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${
                    ping.ok
                      ? "border-success/30 bg-success/5 text-success"
                      : "border-danger/30 bg-danger/5 text-danger"
                  }`}
                >
                  {ping.ok ? (
                    <Check size={11} aria-hidden />
                  ) : (
                    <AlertTriangle size={11} aria-hidden />
                  )}
                  {ping.detail}
                  {ping.latency_ms != null && ` · ${ping.latency_ms} ms`}
                </span>
              )}
              <span className="text-[11px] text-muted">
                Status key: {statusLabel(provider).text}
                {provider.key_masked ? ` (${provider.key_masked})` : ""}
              </span>
              {provider.custom && (
                <button
                  type="button"
                  onClick={() => void handleDeleteProvider()}
                  disabled={busy !== null}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-danger transition-colors duration-150 hover:bg-danger/5 disabled:opacity-40"
                >
                  <Trash2 size={12} aria-hidden />
                  Hapus provider
                </button>
              )}
            </div>
          </div>

          {/* Quota */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-[12px] uppercase tracking-wide text-muted">
              Kuota token
            </h2>
            <p className="mt-1 text-[11px] text-muted">
              Angka dari pemakaian Axtra (rolling 1 menit) dan batas yang diatur
              di server. Tidak semua provider membocorkan kuota asli lewat API.
            </p>
            {quota ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <QuotaBar
                  label="Token per menit"
                  used={quota.minute_tokens}
                  limit={quota.minute_limit}
                />
                <QuotaBar
                  label="Token hari ini"
                  used={quota.day_tokens}
                  limit={quota.day_limit}
                />
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted">Memuat kuota...</p>
            )}
            {quota?.model && (
              <p className="mt-2 text-[11px] text-muted">
                Model aktif: <span className="text-foreground">{quota.model}</span>
              </p>
            )}
            {quota && Object.keys(quota.rate_limit).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(quota.rate_limit).map(([key, value]) => (
                  <Tag
                    key={key}
                    label={`${key.replace(/^x-ratelimit-/, "")}: ${value}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Image generation slot */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-muted">
              <ImageIcon size={12} aria-hidden /> Model gambar
            </h2>
            <p className="mt-1 text-[11px] text-muted">
              Dipakai halaman Generated Image lewat Image API. Harus provider yang
              mendukung Image API (saat ini OpenRouter). Tidak ada model gambar gratis;
              butuh kredit.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <select
                value={imageProviderId}
                onChange={(event) => setImageProviderId(event.target.value)}
                aria-label="Provider gambar"
                className={inputClass}
              >
                <option value="">— provider —</option>
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <input
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value)}
                placeholder="mis. google/gemini-3-pro-image"
                aria-label="Model gambar"
                className={inputClass}
                autoComplete="off"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveImageModel()}
                disabled={busy !== null || !imageProviderId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
              >
                {busy === "image" ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                ) : (
                  <ImageIcon size={12} aria-hidden />
                )}
                Simpan model gambar
              </button>
            </div>
          </div>

          {/* Recommendations */}
          {recs.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-muted">
                <Sparkles size={12} aria-hidden /> Rekomendasi
              </h2>
              <ul className="mt-3 space-y-2">
                {recs.map((rec) => (
                  <li
                    key={rec.model}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-foreground">
                        {rec.model}
                      </span>
                      {rec.free && <Tag label="free" tone="success" />}
                      {rec.tags
                        .filter((tag) => tag !== "free")
                        .map((tag) => (
                          <Tag key={tag} label={tag} />
                        ))}
                      <span className="text-[11px] text-muted">{rec.reason}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSelectModel(rec.model)}
                      disabled={busy !== null}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      <Zap size={11} aria-hidden />
                      Pakai
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Models */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[12px] uppercase tracking-wide text-muted">
                Model tersedia
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLoadModels(catalog === null)}
                  disabled={busy !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                >
                  {busy === "models" ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw size={12} aria-hidden />
                  )}
                  {catalog ? "Muat ulang" : "Muat model"}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari model..."
                  className={`${inputClass} pl-8`}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  checked={freeOnly}
                  onChange={(event) => setFreeOnly(event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Hanya gratis
              </label>
            </div>

            {catalog === null ? (
              <p className="mt-3 text-[12px] text-muted">
                Muat model untuk melihat daftar live dari provider.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[11px] text-muted">
                  {visibleModels.length} dari {catalog.count} model
                  {catalog.cached ? " · cache" : ""}
                </p>
                <ul className="mt-2 max-h-96 space-y-1.5 overflow-y-auto pr-1">
                  {visibleModels.map((model) => {
                    const selected = provider.selected_model === model.id;
                    return (
                      <li
                        key={model.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                          selected
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-foreground">
                            {model.id}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {model.free && <Tag label="free" tone="success" />}
                            {model.modalities.map((modality) => (
                              <Tag key={modality} label={modality} />
                            ))}
                            <span className="text-[10px] text-muted">
                              ctx {formatContext(model.context_window)} ·{" "}
                              {priceLabel(model)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSelectModel(model.id)}
                          disabled={busy !== null || selected}
                          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors duration-150 disabled:opacity-60 ${
                            selected
                              ? "border-primary/50 text-primary"
                              : "border-border text-foreground hover:bg-surface-muted"
                          }`}
                        >
                          {selected ? (
                            <>
                              <Check size={11} aria-hidden /> Aktif
                            </>
                          ) : (
                            <>
                              <Cpu size={11} aria-hidden /> Pakai
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      <Modal
        open={modal !== null}
        tone={modal?.tone ?? "info"}
        title={modal?.title ?? ""}
        message={modal?.message}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function Tag({ label, tone }: { label: string; tone?: "success" }) {
  const className =
    tone === "success"
      ? "border-success/30 bg-success/5 text-success"
      : "border-border bg-surface text-muted";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${className}`}
    >
      {label}
    </span>
  );
}

function QuotaBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-foreground">
          {used.toLocaleString("id-ID")}
          {limit > 0 ? ` / ${limit.toLocaleString("id-ID")}` : ""}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            percent >= 85 ? "bg-danger" : percent >= 60 ? "bg-warning" : "bg-primary"
          }`}
          style={{ width: `${limit > 0 ? percent : 0}%` }}
        />
      </div>
    </div>
  );
}