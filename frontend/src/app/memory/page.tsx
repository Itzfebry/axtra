"use client";

import { Combine, Plus, Search, Trash2, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { useDelayedFlag } from "@/lib/useDelayedFlag";
import { getChatMode } from "@/lib/chatModes";
import {
  apiFetch,
  fetchMemoryClusters,
  mergeMemories,
  type MemoryCluster,
} from "@/lib/api";

export type MemoryType =
  | "identity"
  | "episodic"
  | "semantic"
  | "project"
  | "goal"
  | "skill"
  | "conversation";

type Memory = {
  id: string;
  type: MemoryType;
  content: string;
  source: string;
  source_ref?: Record<string, unknown> | null;
  confidence: number;
  status: "active" | "conflicted" | "archived";
  created_at: string | null;
};

const TYPES: MemoryType[] = [
  "identity",
  "episodic",
  "semantic",
  "project",
  "goal",
  "skill",
  "conversation",
];

const TYPE_LABELS: Record<MemoryType, string> = {
  identity: "Identitas",
  episodic: "Episodik",
  semantic: "Faktual",
  project: "Proyek",
  goal: "Target",
  skill: "Kemampuan",
  conversation: "Percakapan",
};

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<MemoryType | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedFlag(loading);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newType, setNewType] = useState<MemoryType>("semantic");
  const [newContent, setNewContent] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const [clusters, setClusters] = useState<MemoryCluster[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filter) params.set("type_", filter);
      if (search.trim()) params.set("search", search.trim());
      const data = await apiFetch<Memory[]>(`/memories?${params.toString()}`);
      setMemories(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat memori.");
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const loadClusters = useCallback(async () => {
    setClustersLoading(true);
    try {
      const data = await fetchMemoryClusters();
      setClusters(data ?? []);
    } catch {
      setClusters([]);
    } finally {
      setClustersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filter || search.trim()) {
      setClusters([]);
      return;
    }
    const timer = setTimeout(() => void loadClusters(), 400);
    return () => clearTimeout(timer);
  }, [filter, search, loadClusters]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runMerge(ids: string[]) {
    const unique = Array.from(new Set(ids));
    if (unique.length < 2) return;
    const confirmed = window.confirm(
      `Rangkum ${unique.length} memori jadi satu ringkasan?\n\nMemori asal akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`,
    );
    if (!confirmed) return;
    setMerging(true);
    setError(null);
    setNotice(null);
    try {
      await mergeMemories(unique);
      setSelected(new Set());
      setNotice(`Berhasil merangkum ${unique.length} memori jadi satu.`);
      void load();
      void loadClusters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal merangkum memori.");
    } finally {
      setMerging(false);
    }
  }

  async function createMemory(event: React.FormEvent) {
    event.preventDefault();
    if (!newContent.trim()) return;
    try {
      await apiFetch("/memories", {
        method: "POST",
        body: JSON.stringify({ type: newType, content: newContent.trim(), source: "manual" }),
      });
      setNewContent("");
      setShowForm(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan memori.");
    }
  }

  async function saveEdit(id: string) {
    if (!editContent.trim()) return;
    try {
      await apiFetch(`/memories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editContent.trim() }),
      });
      setEditingId(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memperbarui memori.");
    }
  }

  async function deleteMemory(memory: Memory) {
    const confirmed = window.confirm(
      `Hapus memori ini?\n\n"${memory.content}"\n\nTindakan ini tidak dapat dibatalkan.`,
    );
    if (!confirmed) return;
    try {
      await apiFetch(`/memories/${memory.id}`, { method: "DELETE", body: "" });
      setMemories((prev) => prev.filter((item) => item.id !== memory.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(memory.id);
        return next;
      });
      // Drop the deleted memory from any cluster; a cluster with fewer than two
      // members is no longer a merge suggestion.
      setClusters((prev) =>
        prev
          .map((cluster) => ({
            ...cluster,
            memories: cluster.memories.filter((item) => item.id !== memory.id),
          }))
          .filter((cluster) => cluster.memories.length >= 2),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus memori.");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-16">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight font-brand">Memori</h1>
              <p className="mt-1 text-[14px] text-muted">
                Semua fakta yang Axtra ingat. Periksa, koreksi, atau hapus kapan pun.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
            >
              {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {showForm ? "Tutup" : "Tambah"}
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={createMemory}
              className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3"
            >
              <div>
                <label htmlFor="memory-type" className="block text-[12px] text-muted">
                  Jenis
                </label>
                <select
                  id="memory-type"
                  value={newType}
                  onChange={(event) => setNewType(event.target.value as MemoryType)}
                  className={`mt-1 ${inputClass}`}
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="memory-content" className="block text-[12px] text-muted">
                  Isi memori
                </label>
                <textarea
                  id="memory-content"
                  value={newContent}
                  onChange={(event) => setNewContent(event.target.value)}
                  rows={3}
                  placeholder="Contoh: Saya tinggal di Yogyakarta dan sedang belajar Next.js."
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
              >
                Simpan
              </button>
            </form>
          )}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-2">
              <Search size={15} className="shrink-0 text-muted" aria-hidden />
              <label htmlFor="memory-search" className="sr-only">
                Cari memori
              </label>
              <input
                id="memory-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari memori"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter jenis memori">
              <button
                type="button"
                onClick={() => setFilter("")}
                aria-pressed={filter === ""}
                className={`h-8 rounded-lg px-2.5 text-[12px] transition-colors duration-150 ${
                  filter === "" ? "bg-surface-muted text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                Semua
              </button>
              {TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  aria-pressed={filter === type}
                  className={`h-8 rounded-lg px-2.5 text-[12px] transition-colors duration-150 ${
                    filter === type
                      ? "bg-surface-muted text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {(clustersLoading || clusters.length > 0) && !filter && !search.trim() && (
            <section className="mt-5 rounded-lg border border-border bg-surface-muted/40 p-3">
              <div className="flex items-center gap-2">
                <Combine size={15} className="text-muted" aria-hidden />
                <h2 className="text-[13px] font-medium">Topik serupa</h2>
                {clustersLoading && (
                  <span className="text-[12px] text-muted">Memindai...</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted">
                Kelompok memori bertopik sama. Rangkum jadi satu ringkasan, memori asal
                dihapus permanen.
              </p>
              {!clustersLoading && clusters.length === 0 && (
                <p className="mt-2 text-[12px] text-muted">
                  Tidak ada topik serupa yang terdeteksi. Pilih manual di bawah bila perlu.
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {clusters.map((cluster) => (
                  <li
                    key={cluster.key}
                    className="rounded-lg border border-border bg-surface p-3"
                  >
                    <ul className="space-y-1">
                      {cluster.memories.map((item) => (
                        <li key={item.id} className="text-[12px] text-muted">
                          · {item.content}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={merging}
                        onClick={() =>
                          void runMerge(cluster.memories.map((item) => item.id))
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
                      >
                        <Combine size={13} aria-hidden />
                        Rangkum
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected(new Set(cluster.memories.map((item) => item.id)))
                        }
                        className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
                      >
                        Pilih manual
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
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

          {selected.size > 0 && (
            <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
              <span className="text-[12px] text-muted">
                {selected.size} memori dipilih
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={merging || selected.size < 2}
                  onClick={() => void runMerge(Array.from(selected))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
                >
                  <Combine size={13} aria-hidden />
                  Rangkum &amp; gabung
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          <div className="mt-4">
            {showLoading && (
              <LoadingState label="Memuat memori..." variant="list" rows={5} />
            )}

            {!loading && memories.length === 0 && !error && (
              <div className="rounded-lg border border-border px-4 py-6 text-center text-[14px] text-muted">
                Belum ada memori. Mulai dari chat, atau tambah manual.
              </div>
            )}

            {!loading && memories.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {memories.map((memory) => (
                  <li key={memory.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={selected.has(memory.id)}
                        onChange={() => toggleSelect(memory.id)}
                        aria-label="Pilih memori untuk dirangkum"
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-foreground"
                      />
                      <span className="rounded border border-border px-1.5 py-0.5">
                        {TYPE_LABELS[memory.type]}
                      </span>
                      {memory.status !== "active" && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-danger">
                          {memory.status === "conflicted" ? "Konflik" : "Arsip"}
                        </span>
                      )}
                      <span>sumber: {memory.source}</span>
                      {typeof memory.source_ref?.mode === "string" && (
                        <span className="rounded border border-border px-1.5 py-0.5">
                          {getChatMode(memory.source_ref.mode).label}
                        </span>
                      )}
                      {memory.created_at && (
                        <span>· {new Date(memory.created_at).toLocaleString("id-ID")}</span>
                      )}
                    </div>

                    {editingId === memory.id ? (
                      <div className="mt-2 space-y-2">
                        <label htmlFor={`edit-${memory.id}`} className="sr-only">
                          Koreksi isi memori
                        </label>
                        <textarea
                          id={`edit-${memory.id}`}
                          value={editContent}
                          onChange={(event) => setEditContent(event.target.value)}
                          rows={3}
                          className={inputClass}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEdit(memory.id)}
                            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="mt-1.5 whitespace-pre-wrap text-[14px]">{memory.content}</p>
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(memory.id);
                              setEditContent(memory.content);
                            }}
                            className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
                          >
                            <Pencil size={13} aria-hidden />
                            Koreksi
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteMemory(memory)}
                            className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-danger"
                          >
                            <Trash2 size={13} aria-hidden />
                            Hapus
                          </button>
                        </div>
                      </>
                    )}
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