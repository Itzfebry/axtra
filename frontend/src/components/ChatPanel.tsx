"use client";

import {
  ArrowUp,
  AtSign,
  Brain,
  Briefcase,
  FileText,
  Globe,
  Link2,
  Loader2,
  Search,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { useDelayedFlag } from "@/lib/useDelayedFlag";
import { Markdown } from "@/components/Markdown";
import {
  fetchChatSettings,
  listJobs,
  listProjects,
  saveResearchSourceToMemory,
  type ChatCommand,
  type ChatModeId,
  type JobApplication,
  type Project,
} from "@/lib/api";
import {
  crawlSource,
  openRoute,
  removeAttachment,
  removeSource,
  searchSources,
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
import { queuePrompt, takePrompt } from "@/lib/orchestratorBridge";

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

  // @mention: projects and job applications whose context is injected.
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<JobApplication[]>([]);
  const [mentions, setMentions] = useState<
    { id: string; name: string; kind: "project" | "job" }[]
  >([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Riset Web: the URL the user wants to crawl next.
  const [urlInput, setUrlInput] = useState("");
  // Riset Web: Firecrawl web-search query.
  const [queryInput, setQueryInput] = useState("");
  // Riset Web: per-source "save to memory" feedback.
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingHandled = useRef(false);

  // Open (or re-activate) the tab for this route; the store owns the state.
  useEffect(() => {
    openRoute(conversationId, routeMode);
  }, [conversationId, routeMode]);

  const activeKey = useChatActiveKey();
  const slice = useChatSlice(activeKey);

  const mode = slice?.mode ?? routeMode;
  const modeConfig = getChatMode(mode);
  const ModeIcon = modeConfig.icon;

  async function handleSaveSource(sourceId: string) {
    setSavingSourceId(sourceId);
    setSourceNotice(null);
    try {
      const saved = await saveResearchSourceToMemory(sourceId);
      setSourceNotice(
        saved.length > 0
          ? `${saved.length} memori disimpan atau diperbarui.`
          : "Tidak ada fakta baru untuk disimpan.",
      );
    } catch (error) {
      setSourceNotice(
        error instanceof Error ? error.message : "Gagal menyimpan ke memori.",
      );
    } finally {
      setSavingSourceId(null);
    }
  }

  // Switching conversations reuses this component (no remount), so drop the
  // per-thread composer state: mention chips and the crawl URL must not leak
  // into the next thread.
  useEffect(() => {
    setMentions([]);
    setUrlInput("");
    setMentionIndex(0);
    pendingHandled.current = false;
  }, [activeKey]);

  const sliceReady = Boolean(slice);
  const sliceLoading = slice?.loading ?? false;
  const showLoading = useDelayedFlag(sliceLoading);
  const sliceSending = slice?.sending ?? false;

  // Auto-send a prompt handed off by the homepage orchestrator.
  useEffect(() => {
    if (pendingHandled.current || !activeKey || !sliceReady) return;
    if (sliceLoading || sliceSending) return;
    const handedOff = takePrompt(mode);
    if (!handedOff) return;
    pendingHandled.current = true;
    stickToBottom.current = true;
    void send(activeKey, handedOff).then((accepted) => {
      // The slice could not accept the send yet; put the prompt back so it is
      // not silently lost.
      if (!accepted) {
        pendingHandled.current = false;
        queuePrompt(mode, handedOff);
      }
    });
  }, [activeKey, mode, sliceReady, sliceLoading, sliceSending]);

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

  // Projects can be referenced with @name; their context grounds the reply.
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch(() => {
        // Mentions are optional; plain chat still works.
      });
    listJobs()
      .then((rows) => {
        if (!cancelled) setJobs(rows);
      })
      .catch(() => {
        // Job mentions are optional too.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mentionTargets = useMemo(
    () => [
      ...projects.map((project) => ({
        kind: "project" as const,
        id: project.id,
        name: project.name,
        detail: project.description || project.status,
      })),
      ...jobs.map((job) => ({
        kind: "job" as const,
        id: job.id,
        name: `${job.role} — ${job.company}`,
        detail: `${job.status}${job.location ? ` · ${job.location}` : ""}`,
      })),
    ],
    [projects, jobs],
  );

  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionOpen =
    mentionQuery !== null && mentionTargets.length > 0 && !pendingCommand;
  const mentionResults = useMemo(
    () =>
      mentionOpen
        ? mentionTargets
            .filter((target) =>
              target.name.toLowerCase().includes(mentionQuery ?? ""),
            )
            .slice(0, 6)
        : [],
    [mentionOpen, mentionQuery, mentionTargets],
  );

  useEffect(() => {
    setPaletteIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
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

  function submit(rawText: string, includeMentions = false) {
    if (!activeKey) return;
    const text = rawText.trim();
    // `/crawl <url>` (or the /crawl palette chip + a URL) crawls right away.
    if (mode === "research") {
      const crawlMatch = /^\/crawl\s+(\S+)$/i.exec(text);
      const commandUrl =
        pendingCommand === "crawl" && /^https?:\/\//i.test(text) ? text : null;
      const url = crawlMatch?.[1] ?? commandUrl;
      if (url) {
        setDraft(activeKey, "");
        setPendingCommand(activeKey, null);
        void crawlSource(activeKey, url);
        return;
      }
    }
    stickToBottom.current = true;
    const projectIds = includeMentions
      ? mentions.filter((mention) => mention.kind === "project").map((mention) => mention.id)
      : [];
    const jobIds = includeMentions
      ? mentions.filter((mention) => mention.kind === "job").map((mention) => mention.id)
      : [];
    if (includeMentions) setMentions([]);
    void send(activeKey, rawText, projectIds, jobIds);
  }

  function chooseMention(target: (typeof mentionTargets)[number]) {
    if (!activeKey) return;
    setDraft(
      activeKey,
      draft.replace(/(^|\s)@([^\s@]*)$/, (_match, prefix: string) => `${prefix}@${target.name} `),
    );
    setMentions((previous) =>
      previous.some(
        (mention) => mention.id === target.id && mention.kind === target.kind,
      )
        ? previous
        : [...previous, { id: target.id, name: target.name, kind: target.kind }],
    );
    setMentionIndex(0);
    textareaRef.current?.focus();
  }

  function handleUpload(file: File) {
    if (!activeKey) return;
    void uploadAttachment(activeKey, file).finally(() => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleCrawl(event: React.FormEvent) {
    event.preventDefault();
    if (!activeKey || !urlInput.trim()) return;
    const url = urlInput.trim();
    setUrlInput("");
    void crawlSource(activeKey, url);
  }

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!activeKey || !queryInput.trim()) return;
    const query = queryInput.trim();
    setQueryInput("");
    void searchSources(activeKey, query);
  }

  function chooseCommand(command: ChatCommand) {
    if (!activeKey) return;
    setPendingCommand(activeKey, command.id);
    setPaletteIndex(0);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(draft, true);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && mentionResults.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (index) => (index - 1 + mentionResults.length) % mentionResults.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeKey) {
          setDraft(activeKey, draft.replace(/(^|\s)@([^\s@]*)$/, ""));
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chooseMention(mentionResults[Math.min(mentionIndex, mentionResults.length - 1)]);
        return;
      }
    }
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
      submit(draft, true);
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
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted">
          <ModeIcon size={11} aria-hidden />
          {modeConfig.label}
        </span>
        <h1 className="truncate text-[13px] font-medium text-muted">
          {slice.title ?? (slice.conversationId ? "Percakapan" : `Chat ${modeConfig.label}`)}
        </h1>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {showLoading && (
            <LoadingState label="Memuat percakapan..." variant="chat" />
          )}

          {showEmpty && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
              <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                <ModeIcon size={20} aria-hidden />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">{modeConfig.label}</h2>
              <p className="mt-2 max-w-md text-[14px] text-muted">{modeConfig.description}</p>
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
              {mode === "research" && (
                <p className="mt-4 text-[12px] text-muted">
                  Tempel URL halaman web di bawah, crawl, lalu ajukan pertanyaan.
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
                      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
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
              <span>
                Disimpan ke memori dari{" "}
                <span className="font-medium text-foreground">
                  Chat · {modeConfig.label}
                </span>
                : {slice.memorySaved.join(" · ")}
              </span>
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
                      <p className="text-[11px] text-muted">
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

        {mode === "research" && (
          <div className="mx-auto mb-2 w-full max-w-3xl rounded-lg border border-border bg-surface p-2.5">
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <Globe size={14} aria-hidden />
              <span>Sumber web</span>
            </div>
            <form onSubmit={handleSearch} className="mt-2 flex items-center gap-1.5">
              <label htmlFor="search-query" className="sr-only">
                Kata kunci pencarian web
              </label>
              <input
                id="search-query"
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Cari di web: mis. berita AI terbaru"
                disabled={slice.searching}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!queryInput.trim() || slice.searching}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {slice.searching ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Search size={14} aria-hidden />
                )}
                {slice.searching ? "Mencari..." : "Cari"}
              </button>
            </form>
            <form onSubmit={handleCrawl} className="mt-1.5 flex items-center gap-1.5">
              <label htmlFor="crawl-url" className="sr-only">
                URL halaman web
              </label>
              <input
                id="crawl-url"
                type="url"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="atau crawl URL: https://contoh.com/artikel"
                disabled={slice.crawling}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!urlInput.trim() || slice.crawling}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
              >
                {slice.crawling ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Link2 size={14} aria-hidden />
                )}
                {slice.crawling ? "Crawl..." : "Crawl"}
              </button>
            </form>

            {slice.sources.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {slice.sources.map((source) => (
                  <li
                    key={source.id}
                    className="flex items-start justify-between gap-2 rounded border border-border px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-foreground">
                        {source.title || source.url}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {source.site} · {source.char_count} karakter
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Simpan memori dari ${source.title || source.url}`}
                        title="Simpan ke memori"
                        disabled={savingSourceId === source.id}
                        onClick={() => void handleSaveSource(source.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                      >
                        {savingSourceId === source.id ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : (
                          <Brain size={14} aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Hapus sumber ${source.title || source.url}`}
                        title="Hapus sumber"
                        onClick={() => activeKey && void removeSource(activeKey, source.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-muted">
                Cari di web atau crawl URL. Sumber dipakai sebagai konteks jawaban.
              </p>
            )}

            {sourceNotice && (
              <p role="status" className="mt-2 text-[11px] text-muted">
                {sourceNotice}
              </p>
            )}

            {slice.crawlError && (
              <p role="alert" className="mt-2 text-[11px] text-danger">
                {slice.crawlError}
              </p>
            )}

            {!slice.crawlError && slice.crawlNotice && (
              <p role="status" className="mt-2 text-[11px] text-muted">
                {slice.crawlNotice}
              </p>
            )}
          </div>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {sending ? "Axtra sedang menjawab." : ""}
        </p>

        {mentionOpen && mentionResults.length > 0 && (
          <ul
            role="listbox"
            aria-label="Rujuk proyek atau lamaran"
            className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-surface"
          >
            {mentionResults.map((target, index) => (
              <li
                key={`${target.kind}-${target.id}`}
                role="option"
                aria-selected={index === mentionIndex}
              >
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseMention(target);
                  }}
                  onMouseEnter={() => setMentionIndex(index)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                    index === mentionIndex
                      ? "bg-surface-muted text-foreground"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  {target.kind === "job" ? (
                    <Briefcase size={14} aria-hidden className="shrink-0" />
                  ) : (
                    <AtSign size={14} aria-hidden className="shrink-0" />
                  )}
                  <span className="shrink-0 font-medium">{target.name}</span>
                  <span className="truncate text-[12px] text-muted">
                    {target.detail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

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

        {mentions.length > 0 && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap gap-1.5">
            {mentions.map((mention) => (
              <span
                key={`${mention.kind}-${mention.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
              >
                {mention.kind === "job" ? (
                  <Briefcase size={12} aria-hidden />
                ) : (
                  <AtSign size={12} aria-hidden />
                )}
                {mention.name}
                <button
                  type="button"
                  onClick={() =>
                    setMentions((previous) =>
                      previous.filter(
                        (item) =>
                          item.id !== mention.id || item.kind !== mention.kind,
                      ),
                    )
                  }
                  aria-label={`Hapus rujukan ${mention.name}`}
                  title="Hapus rujukan"
                  className="text-muted transition-colors duration-150 hover:text-foreground"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
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
                : mode === "research" && slice.sources.length === 0
                  ? "Masukkan URL di atas lalu crawl, atau tulis pertanyaan..."
                  : modeCommands.length > 0
                  ? "Tulis pesan, / untuk command, @ untuk rujuk proyek..."
                  : "Tulis pesan, atau ketik @ untuk rujuk proyek..."
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
