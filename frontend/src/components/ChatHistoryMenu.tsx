"use client";

import Link from "next/link";
import { History, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getChatMode } from "@/lib/chatModes";

type ConversationRow = {
  id: string;
  title: string | null;
  mode: string;
  message_count: number;
  last_message_at: string | null;
};

/**
 * Header control for chat pages: replaces the theme toggle (which is only
 * available on the menu pages) with a conversation history menu.
 */
export function ChatHistoryMenu({
  conversations,
  activeConversationId,
  hasMore,
  loading,
  onLoadMore,
  onNavigate,
  onDeleteConversation,
}: {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onNavigate: () => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function confirmDelete(conversationId: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteConversation(conversationId);
      setConfirmingId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Gagal menghapus.");
    } finally {
      setDeleting(false);
    }
  }

  const term = search.trim().toLowerCase();
  const rows = term
    ? conversations.filter((conversation) => {
        const modeLabel = getChatMode(conversation.mode).label.toLowerCase();
        return (
          (conversation.title ?? "").toLowerCase().includes(term) ||
          modeLabel.includes(term)
        );
      })
    : conversations;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Riwayat chat"
        title="Riwayat chat"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
      >
        <History size={18} aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="p-2">
            <label htmlFor="chat-history-search" className="sr-only">
              Cari percakapan
            </label>
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2">
              <Search size={15} className="shrink-0 text-muted" aria-hidden />
              <input
                id="chat-history-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari percakapan"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
              />
            </div>
          </div>

          <nav
            aria-label="Riwayat percakapan"
            className="max-h-80 overflow-y-auto px-1 pb-1"
          >
            {rows.length === 0 && !loading && (
              <p className="px-2 py-2 text-[13px] text-muted">
                {term ? "Tidak ada hasil." : "Belum ada riwayat."}
              </p>
            )}
            <ul className="space-y-0.5">
              {rows.map((conversation) => {
                const active = conversation.id === activeConversationId;
                if (confirmingId === conversation.id) {
                  return (
                    <li key={conversation.id} className="px-2 py-2">
                      <p className="text-[12px] text-foreground">
                        Hapus percakapan ini?
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        Tindakan ini permanen.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void confirmDelete(conversation.id)}
                          disabled={deleting}
                          className="rounded-md bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
                        >
                          {deleting ? "Menghapus..." : "Ya, hapus"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={deleting}
                          className="rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-50"
                        >
                          Batal
                        </button>
                      </div>
                      {deleteError && (
                        <p role="alert" className="mt-1.5 text-[11px] text-danger">
                          {deleteError}
                        </p>
                      )}
                    </li>
                  );
                }
                return (
                  <li key={conversation.id} className="group flex items-center">
                    <Link
                      href={`/chat/${conversation.id}`}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={conversation.title ?? "Percakapan"}
                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-[13px] transition-colors duration-150 ${
                        active
                          ? "bg-surface-muted text-foreground"
                          : "text-muted hover:bg-surface-muted hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">
                        {conversation.title ?? "Percakapan"}
                      </span>
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                        {getChatMode(conversation.mode).label}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmingId(conversation.id);
                      }}
                      aria-label={`Hapus ${conversation.title ?? "percakapan"}`}
                      title="Hapus"
                      className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-opacity duration-150 hover:bg-surface-muted hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loading}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
              >
                {loading ? "Memuat..." : "Muat lebih banyak"}
              </button>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
