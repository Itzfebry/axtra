"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { closeTab, useChatTabs } from "@/lib/chatStore";
import { CHAT_MODES, getChatMode } from "@/lib/chatModes";

/** Horizontal multi-chat tab bar. Tabs map to open conversations. */
export function ChatTabs() {
  const router = useRouter();
  const { tabs, activeKey } = useChatTabs();
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(event.target as Node)) {
        setAddOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);

  function urlFor(conversationId: string | null, mode: string): string {
    return conversationId ? `/chat/${conversationId}` : `/chat/${mode}`;
  }

  function openTab(conversationId: string | null, mode: string) {
    router.push(urlFor(conversationId, mode));
  }

  function handleClose(key: string) {
    const wasActive = key === activeKey;
    const index = tabs.findIndex((tab) => tab.key === key);
    const remaining = tabs.filter((tab) => tab.key !== key);
    closeTab(key);
    if (!wasActive) return;
    const next = remaining[index] ?? remaining[index - 1] ?? null;
    if (next) {
      router.push(urlFor(next.conversationId, next.mode));
    } else {
      router.push("/chat");
    }
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const label = tab.title ?? getChatMode(tab.mode).label;
          return (
            <div
              key={tab.key}
              className={`group flex h-8 max-w-[200px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors duration-150 ${
                active
                  ? "border-border bg-surface-muted text-foreground"
                  : "border-transparent text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => openTab(tab.conversationId, tab.mode)}
                title={label}
                aria-current={active ? "page" : undefined}
                className="flex min-w-0 items-center gap-1.5"
              >
                {tab.sending && (
                  <span
                    aria-label="Sedang menjawab"
                    title="Sedang menjawab"
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-foreground"
                  />
                )}
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                onClick={() => handleClose(tab.key)}
                aria-label={`Tutup ${label}`}
                title="Tutup tab"
                className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-opacity duration-150 hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <div ref={addRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setAddOpen((value) => !value)}
          aria-expanded={addOpen}
          aria-haspopup="menu"
          aria-label="Chat baru"
          title="Chat baru"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
        >
          <Plus size={16} aria-hidden />
        </button>
        {addOpen && (
          <ul
            role="menu"
            aria-label="Pilih mode untuk chat baru"
            className="absolute right-0 top-9 z-50 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 text-[13px] shadow-lg"
          >
            {CHAT_MODES.map((chatMode) => {
              const Icon = chatMode.icon;
              return (
                <li key={chatMode.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAddOpen(false);
                      openTab(null, chatMode.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                  >
                    <Icon size={15} aria-hidden />
                    {chatMode.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
