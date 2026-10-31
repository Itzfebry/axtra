"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Briefcase, FolderKanban, Globe, MessageSquare, Send } from "lucide-react";

import { AssistantDigest } from "@/components/AssistantDigest";
import {
  createMemory,
  orchestrate,
  type OrchestratorAction,
  type OrchestratorMenuEntry,
} from "@/lib/api";
import { focusMenu, queuePrompt } from "@/lib/orchestratorBridge";
import { CHAT_MODE_IDS } from "@/lib/chatModes";

type ChatLine = { role: "user" | "assistant"; content: string };

const MENU_ACTION_TYPES = new Set([
  "menu_order",
  "menu_visibility",
  "menu_rename",
  "reset_menu",
]);

/** Primary entry points surfaced on the home empty state. */
const SHORTCUTS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Proyek", icon: FolderKanban },
  { href: "/jobs", label: "Cari Kerja", icon: Briefcase },
  { href: "/chat/research", label: "Riset Web", icon: Globe },
];

function chatModeFromHref(href: string): string | null {
  const segment = href.startsWith("/chat/") ? href.slice("/chat/".length) : "";
  return CHAT_MODE_IDS.includes(segment as (typeof CHAT_MODE_IDS)[number])
    ? segment
    : null;
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem("axtra-theme", theme);
  } catch {
    // Storage may be unavailable; theme still applies for this session.
  }
  // Let the theme toggle re-read the new value without a reload.
  window.dispatchEvent(new Event("axtra:theme-changed"));
}

/**
 * GPT-style orchestrator surface: an empty state with suggestions digest,
 * a scrolling message list, and a composer pinned to the bottom.
 */
export function MenuOrchestrator({
  menu,
  onActions,
}: {
  menu: OrchestratorMenuEntry[];
  onActions: (actions: OrchestratorAction[]) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionTimer = useRef<number | null>(null);
  const pendingConfig = useRef<OrchestratorAction[] | null>(null);

  // Apply menu changes a beat after the reply so the sidebar animates smoothly.
  // On unmount (e.g. an action navigates away) flush them instead of dropping.
  useEffect(
    () => () => {
      if (actionTimer.current !== null) {
        window.clearTimeout(actionTimer.current);
        actionTimer.current = null;
        if (pendingConfig.current) onActions(pendingConfig.current);
      }
    },
    [onActions],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending) return;
      setError(null);
      setInput("");
      const history = messages.map((line) => ({ role: line.role, content: line.content }));
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setSending(true);
      try {
        const result = await orchestrate({ message, menu, history });
        setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);

        for (const action of result.actions) {
          if (action.type === "navigate" && action.href) {
            // A prompt only makes sense when the destination is a chat mode.
            const targetMode = chatModeFromHref(action.href);
            if (action.prompt && targetMode) queuePrompt(targetMode, action.prompt);
            router.push(action.href);
          } else if (action.type === "new_conversation") {
            const mode = action.mode ?? "general";
            const prompt = action.prompt ?? action.title ?? null;
            if (prompt) queuePrompt(mode, prompt);
            router.push(`/chat/${mode}`);
          } else if (action.type === "focus_menu" && action.target) {
            focusMenu(action.target);
          } else if (action.type === "set_theme" && action.theme) {
            applyTheme(action.theme);
          } else if (action.type === "save_memory" && action.content) {
            void createMemory({
              content: action.content,
              type: action.memory_type,
            });
          }
        }

        // Apply menu changes a beat after the reply so the sidebar animates.
        const configActions = result.actions.filter((action) =>
          MENU_ACTION_TYPES.has(action.type),
        );
        if (configActions.length > 0) {
          if (actionTimer.current !== null) window.clearTimeout(actionTimer.current);
          pendingConfig.current = configActions;
          actionTimer.current = window.setTimeout(() => {
            actionTimer.current = null;
            pendingConfig.current = null;
            onActions(configActions);
          }, 260);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengirim pesan.");
      } finally {
        setSending(false);
      }
    },
    [messages, menu, onActions, router, sending],
  );

  const empty = messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          {empty ? (
            <>
              <div className="flex items-center gap-2.5">
                <Image
                  src="/axtratr.png"
                  alt=""
                  width={36}
                  height={36}
                  priority
                  className="h-9 w-9 rounded-lg"
                />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight font-brand">Axtra</h1>
                  <p className="text-[13px] text-muted">Agen AI personal</p>
                </div>
              </div>
              <p className="mt-4 max-w-lg text-[14px] italic leading-relaxed text-muted">
                Mulai percakapan, kelola proyek, atau cari kerja. Tulis tujuanmu di kolom
                bawah dan Axtra akan mengarahkan ke tool yang tepat.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {SHORTCUTS.map((shortcut) => {
                  const Icon = shortcut.icon;
                  return (
                    <Link
                      key={shortcut.href}
                      href={shortcut.href}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                    >
                      <Icon size={14} aria-hidden />
                      {shortcut.label}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-6">
                <AssistantDigest embedded />
              </div>
            </>
          ) : (
            <div className="space-y-5">
              {messages.map((line, index) =>
                line.role === "user" ? (
                  <div key={index} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-surface-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">
                      {line.content}
                    </p>
                  </div>
                ) : (
                  <div key={index} className="flex gap-2.5">
                    <Image
                      src="/axtratr.png"
                      alt=""
                      width={24}
                      height={24}
                      className="mt-0.5 h-6 w-6 shrink-0 rounded-md"
                    />
                    <p className="min-w-0 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                      {line.content}
                    </p>
                  </div>
                ),
              )}

              {sending && (
                <div className="flex gap-2.5">
                  <Image
                    src="/axtratr.png"
                    alt=""
                    width={24}
                    height={24}
                    className="mt-0.5 h-6 w-6 shrink-0 rounded-md"
                  />
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                  </span>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="shrink-0 px-4 pb-4 pt-2"
      >
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-sm transition-colors duration-150 focus-within:border-foreground/30">
            <label htmlFor="orchestrator-input" className="sr-only">
              Perintah untuk Axtra
            </label>
            <textarea
              id="orchestrator-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Tulis tujuanmu ke tool atau menu..."
              className="max-h-32 min-h-7 flex-1 resize-none bg-transparent py-1 text-[14px] outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Kirim"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              <Send size={15} aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">
            Axtra mengubah menu atau membuka tool yang tersedia sesuai tujuannya.
          </p>
        </div>
      </form>
    </div>
  );
}
