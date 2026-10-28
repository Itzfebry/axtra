"use client";

import { ArrowUp, Brain, FileText, Square, Terminal, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fetchChatSettings, type ChatCommand, type ChatModeId } from "@/lib/api";
import {
  openRoute,
  removeAttachment,
  send,
  setDraft,
  setPendingCommand,
  stop,
  uploadAttachment,
  useChatActiveKey,
  useChatSlice,
  visibleContent,
} from "@/lib/chatStore";
import { getChatMode, type ChatMode } from "@/lib/chatModes";

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1).replace(".", ",")} dtk`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatPanel({
  conversationId,
  mode: initialMode = null,
}: {
  conversationId: string | null;
  mode?: ChatMode | null;
}) {
  const routeMode = initialMode ?? "general";

  const [commandsByMode, setCommandsByMode] = useState<
    Partial<Record<ChatModeId, ChatCommand[]>>
  >({});
  const [paletteIndex, setPaletteIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Open (or re-activate) the tab for this route; the store owns the state.
  useEffect(() => {
    openRoute(conversationId, routeMode);
  }, [conversationId, routeMode]);

  const activeKey = useChatActiveKey();
  const slice = useChatSlice(activeKey);

  const mode = slice?.mode ?? routeMode;
  const modeConfig = getChatMode(mode);
  const ModeIcon = modeConfig.icon;

  const modeCommands = useMemo(
    () => commandsByMode[mode as ChatModeId] ?? [],
    [commandsByMode, mode],
  );
  const draft = slice?.draft ?? "";
  const pendingCommand = slice?.pendingCommand ?? null;
  const slashQuery = draft.startsWith("/") ? draft.slice(1).toLowerCase() : null;
  const paletteOpen =
    slashQuery !== null && !slashQuery.includes(" ") && modeCommands.length > 0;
  const paletteCommands = useMemo(
    () =>
      paletteOpen
        ? modeCommands.filter((command) => command.id.startsWith(slashQuery ?? ""))
        : [],
    [paletteOpen, modeCommands, slashQuery],
  );

  // Slash commands per mode are static configuration; load them once.
  useEffect(() => {
    let cancelled = false;
    fetchChatSettings()
      .then((data) => {
        if (!cancelled) {
          setCommandsByMode(data.commands as Partial<Record<ChatModeId, ChatCommand[]>>);
        }
      })
      .catch(() => {
        // Commands are optional; the chat still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPaletteIndex(0);
  }, [slashQuery]);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice?.messages, activeKey]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 80;
  }

  function autoGrow() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  function submit(rawText: string) {
    if (!activeKey) return;
    stickToBottom.current = true;
    void send(activeKey, rawText);
  }

  function handleUpload(file: File) {
    if (!activeKey) return;
    void uploadAttachment(activeKey, file).finally(() => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function chooseCommand(command: ChatCommand) {
    if (!activeKey) return;
    setPendingCommand(activeKey, command.id);
    setPaletteIndex(0);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(draft);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (paletteOpen && paletteCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPaletteIndex((index) => (index + 1) % paletteCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPaletteIndex(
          (index) => (index - 1 + paletteCommands.length) % paletteCommands.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeKey) setDraft(activeKey, "");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (paletteOpen && paletteCommands.length > 0) {
        chooseCommand(paletteCommands[Math.min(paletteIndex, paletteCommands.length - 1)]);
        return;
      }
      submit(draft);
    }
  }

  if (!slice) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-[13px] text-muted">Menyiapkan chat...</p>
      </div>
    );
  }

  const messages = slice.messages;
  const sending = slice.sending;
  const showEmpty = !slice.loading && messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          <ModeIcon size={11} aria-hidden />
          {modeConfig.label}
        </span>
        <h1 className="truncate text-[13px] font-medium text-muted">
          {slice.title ?? (slice.conversationId ? "Percakapan" : `Chat ${modeConfig.label}`)}
        </h1>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {slice.loading && <p className="text-[13px] text-muted">Memuat percakapan...</p>}

          {showEmpty && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
              <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                <ModeIcon size={20} aria-hidden />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">{modeConfig.label}</h2>
              <p className="mt-2 max-w-md text-[13px] text-muted">{modeConfig.description}</p>
              <ul className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {modeConfig.suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => submit(suggestion)}
                      className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-[13px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
              {mode === "document" && (
                <p className="mt-4 text-[12px] text-muted">
                  Unggah dokumen lewat tombol di bawah, lalu ajukan pertanyaan.
                </p>
              )}
            </div>
          )}

          <div className="space-y-5">
            {messages.map((message, index) => (
              <div key={message.id ?? `local-${index}`}>
                {message.role === "user" ? (
                  <div className="flex flex-col items-end gap-1">
                    {message.command && (
                      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                        <Terminal size={11} aria-hidden />/{message.command}
                      </span>
                    )}
                    {message.content && (
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-[14px] text-foreground">
                        {message.content}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-none text-[14px] text-foreground">
                    {visibleContent(message.content) ? (
                      <Markdown content={visibleContent(message.content)} />
                    ) : (
                      <p className="text-[13px] text-muted">
                        Menyusun jawaban...
                        {message.pending ? ` ${formatSeconds(slice.elapsed)}` : ""}
                      </p>
                    )}

                    {message.options && message.options.length > 0 && (
                      <div
                        role="group"
                        aria-label="Pilih jawaban"
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        {message.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={sending}
                            onClick={() => submit(option)}
                            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}

                    {message.elapsedMs != null && (
                      <p className="mt-1.5 text-[11px] text-muted">
                        Dimuat dalam {formatSeconds(message.elapsedMs / 1000)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {slice.memorySaved && slice.memorySaved.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-muted">
              <Brain size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>Disimpan ke memori: {slice.memorySaved.join(" · ")}</span>
            </div>
          )}

          {slice.notice && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
            >
              {slice.notice}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3">
        {mode === "document" && (
          <div className="mx-auto mb-2 w-full max-w-3xl rounded-lg border border-border bg-surface p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] text-muted">
                <FileText size={14} aria-hidden />
                <span>Dokumen konteks</span>
              </div>
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted ${
                  slice.uploading ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <Upload size={13} aria-hidden />
                {slice.uploading ? "Mengunggah..." : "Unggah"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.json,.log,.pdf,text/plain,text/markdown,application/pdf"
                  className="hidden"
                  disabled={slice.uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
              </label>
            </div>

            {slice.documents.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {slice.documents.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-foreground">{document.filename}</p>
                      <p className="text-[10px] text-muted">
                        {formatBytes(document.size_bytes)} · teks tersimpan
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Hapus ${document.filename}`}
                      title="Hapus dokumen"
                      onClick={() => activeKey && void removeAttachment(activeKey, document.id)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-muted">
                TXT, MD, atau PDF. Maksimal 10 MB per file.
              </p>
            )}

            {slice.uploadError && (
              <p role="alert" className="mt-2 text-[11px] text-danger">
                {slice.uploadError}
              </p>
            )}
          </div>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {sending ? "Axtra sedang menjawab." : ""}
        </p>

        {paletteOpen && paletteCommands.length > 0 && (
          <ul
            role="listbox"
            aria-label="Slash command"
            className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-surface"
          >
            {paletteCommands.map((command, index) => (
              <li key={command.id} role="option" aria-selected={index === paletteIndex}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseCommand(command);
                  }}
                  onMouseEnter={() => setPaletteIndex(index)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                    index === paletteIndex
                      ? "bg-surface-muted text-foreground"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  <Terminal size={14} aria-hidden className="shrink-0" />
                  <span className="shrink-0 font-medium">/{command.id}</span>
                  <span className="truncate text-[12px] text-muted">
                    {command.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pendingCommand && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground">
              <Terminal size={12} aria-hidden />/{pendingCommand}
              <button
                type="button"
                onClick={() => activeKey && setPendingCommand(activeKey, null)}
                aria-label="Hapus command"
                title="Hapus command"
                className="text-muted transition-colors duration-150 hover:text-foreground"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <label htmlFor="composer" className="sr-only">
            Tulis pesan
          </label>
          <textarea
            id="composer"
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              if (activeKey) setDraft(activeKey, event.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              mode === "document" && slice.documents.length === 0
                ? "Unggah dokumen dulu, atau tulis pertanyaan..."
                : modeCommands.length > 0
                  ? "Tulis pesan, atau ketik / untuk command..."
                  : "Tulis pesan..."
            }
            className="max-h-[200px] min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40"
          />
          {sending ? (
            <button
              type="button"
              onClick={() => activeKey && stop(activeKey)}
              aria-label="Hentikan jawaban"
              title="Hentikan"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors duration-150 hover:bg-surface-muted"
            >
              <Square size={16} aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() && !pendingCommand}
              aria-label="Kirim pesan"
              title="Kirim"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp size={18} aria-hidden />
            </button>
          )}
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted">
          Enter untuk kirim · Shift+Enter untuk baris baru
        </p>
      </div>
    </div>
  );
}
