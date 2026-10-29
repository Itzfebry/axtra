"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FEATURES } from "@/lib/features";
import { CHAT_MODES } from "@/lib/chatModes";
import { MENU_FOCUS_EVENT } from "@/lib/orchestratorBridge";
import {
  DEFAULT_MENU_CONFIG,
  MENU_CONFIG_CHANGED,
  applyMenuConfig,
  loadMenuConfig,
  saveMenuConfig,
  type MenuConfig,
} from "@/lib/menuConfig";

const COLLAPSE_KEY = "axtra-feature-menu-collapsed";

/** Feature menu rendered in the AppShell sidebar, above the token meter. */
export function FeatureSidebar() {
  const pathname = usePathname();
  const [config, setConfig] = useState<MenuConfig>(DEFAULT_MENU_CONFIG);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const refresh = useCallback(() => setConfig(loadMenuConfig()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(MENU_CONFIG_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MENU_CONFIG_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  // Expand the Chat folder by default while inside a chat route.
  useEffect(() => {
    if (pathname.startsWith("/chat")) setChatOpen(true);
  }, [pathname]);

  // Orchestrator can ask the sidebar to reveal and flash a tool.
  useEffect(() => {
    function onFocus(event: Event) {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target;
      if (!target) return;
      setQuery("");
      setCollapsed(false);
      setFocusId(target);
    }
    window.addEventListener(MENU_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(MENU_FOCUS_EVENT, onFocus);
  }, []);

  useEffect(() => {
    if (!focusId) return;
    document
      .getElementById(`feature-item-${focusId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => setFocusId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [focusId]);

  const features = useMemo(() => {
    const visible = applyMenuConfig(FEATURES, config);
    const term = query.trim().toLowerCase();
    if (!term) return visible;
    return visible.filter((feature) => feature.title.toLowerCase().includes(term));
  }, [config, query]);

  // Changing the config remounts the list so its entrance animation replays.
  const listKey = useMemo(
    () => JSON.stringify([config.order, config.hidden, config.labels]),
    [config],
  );

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="feature-menu-list"
        className="flex w-full items-center gap-1 px-2 pb-1.5 pt-0.5 text-[11px] uppercase tracking-wide text-muted transition-colors duration-150 hover:text-foreground"
      >
        <span>Menu</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={`transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <div className="px-1 pb-1.5">
            <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2">
              <Search size={13} className="shrink-0 text-muted" aria-hidden />
              <label htmlFor="feature-menu-search" className="sr-only">
                Cari menu
              </label>
              <input
                id="feature-menu-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari menu"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted"
              />
            </div>
          </div>

          <div id="feature-menu-list">
            {features.length === 0 ? (
              <div className="px-2 py-2">
                <p className="text-[12px] text-muted">
                  {query.trim() ? "Tidak ada hasil." : "Semua menu disembunyikan."}
                </p>
                {!query.trim() && (
                  <button
                    type="button"
                    onClick={() => saveMenuConfig({ order: [], hidden: [], labels: {} })}
                    className="mt-2 inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                  >
                    Reset menu
                  </button>
                )}
              </div>
            ) : (
              <ul key={listKey} className="animate-menu-in space-y-0.5">
                {features.map((feature) => {
                  const Icon = feature.icon;
                  const live = typeof feature.href === "string";
                  const href = feature.href ?? "";
                  const active =
                    live &&
                    (pathname === href ||
                      (href !== "/" && pathname.startsWith(`${href}/`)));
                  const label = live
                    ? feature.title
                    : `${feature.title} · Fase ${feature.phase}`;
                  const className =
                    "flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] transition-colors duration-150";
                  if (feature.id === "chat") {
                    const chatActive = pathname.startsWith("/chat");
                    return (
                      <li
                        key={feature.id}
                        id={`feature-item-${feature.id}`}
                        className={`rounded-lg transition-shadow duration-300 ${
                          focusId === feature.id ? "ring-2 ring-foreground/40" : "ring-0"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setChatOpen((value) => !value)}
                          aria-expanded={chatOpen}
                          aria-controls="feature-chat-modes"
                          className={`w-full ${className} ${
                            chatActive
                              ? "bg-surface-muted font-medium text-foreground"
                              : "text-muted hover:bg-surface-muted hover:text-foreground"
                          }`}
                        >
                          <Icon size={16} className="shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {feature.title}
                          </span>
                          <ChevronDown
                            size={14}
                            aria-hidden
                            className={`shrink-0 text-muted transition-transform duration-150 ${
                              chatOpen ? "" : "-rotate-90"
                            }`}
                          />
                        </button>
                        {chatOpen && (
                          <ul id="feature-chat-modes" className="mt-0.5 space-y-0.5 pl-6">
                            {CHAT_MODES.map((chatMode) => {
                              const ModeIcon = chatMode.icon;
                              const modeActive = pathname === `/chat/${chatMode.id}`;
                              return (
                                <li key={chatMode.id}>
                                  <Link
                                    href={`/chat/${chatMode.id}`}
                                    aria-current={modeActive ? "page" : undefined}
                                    title={chatMode.label}
                                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors duration-150 ${
                                      modeActive
                                        ? "bg-surface-muted font-medium text-foreground"
                                        : "text-muted hover:bg-surface-muted hover:text-foreground"
                                    }`}
                                  >
                                    <ModeIcon size={14} className="shrink-0" aria-hidden />
                                    <span className="truncate">{chatMode.label}</span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  }
                  const body = (
                    <>
                      <Icon size={16} className="shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {feature.title}
                      </span>
                      {!live && (
                        <span
                          className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center"
                          title={`Fase ${feature.phase}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-muted/50" />
                          <span className="sr-only">Fase {feature.phase}</span>
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li
                      key={feature.id}
                      id={`feature-item-${feature.id}`}
                      className={`rounded-lg transition-shadow duration-300 ${
                        focusId === feature.id
                          ? "ring-2 ring-foreground/40"
                          : "ring-0"
                      }`}
                    >
                      {live ? (
                        <Link
                          href={href}
                          title={label}
                          aria-label={label}
                          aria-current={active ? "page" : undefined}
                          className={`${className} ${
                            active
                              ? "bg-surface-muted font-medium text-foreground"
                              : "text-muted hover:bg-surface-muted hover:text-foreground"
                          }`}
                        >
                          {body}
                        </Link>
                      ) : (
                        <span
                          title={label}
                          aria-label={label}
                          aria-disabled="true"
                          className={`${className} cursor-not-allowed text-muted/60`}
                        >
                          {body}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}