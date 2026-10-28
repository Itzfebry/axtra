"use client";

import {
  Brain,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, deleteConversation, logout } from "@/lib/api";
import { closeTab } from "@/lib/chatStore";
import { isChatMode, type ChatMode } from "@/lib/chatModes";
import { ChatTabs } from "@/components/ChatTabs";
import { ChatHistoryMenu } from "@/components/ChatHistoryMenu";
import { FeatureSidebar } from "@/components/FeatureSidebar";
import { PageTransition } from "@/components/PageTransition";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UsageMeter } from "@/components/UsageMeter";

export const CONVERSATIONS_CHANGED = "axtra:conversations-changed";

type Conversation = {
  id: string;
  title: string | null;
  mode: ChatMode;
  message_count: number;
  last_message_at: string | null;
};

const PAGE_SIZE = 30;

export function emitConversationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Sidebar sections that the user can collapse. Persisted in localStorage.
  const [usageOpen, setUsageOpen] = useState(true);
  const loadedCount = useRef(0);
  const loadingRef = useRef(false);
  const reloadTimer = useRef<number | null>(null);
  // A reload requested while one is in flight is coalesced instead of dropped.
  const pendingReload = useRef(false);
  // Conversations deleted this session. A stale in-flight list fetch must never
  // re-add them, so they are filtered out of every response.
  const deletedIds = useRef<Set<string>>(new Set());

  const loadConversations = useCallback(async (append = false) => {
    if (loadingRef.current) {
      pendingReload.current = true;
      return;
    }
    loadingRef.current = true;
    setLoadingConversations(true);
    try {
      const offset = append ? loadedCount.current : 0;
      const data = await apiFetch<Conversation[]>(
        `/conversations?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      const rows = (data ?? []).filter((row) => !deletedIds.current.has(row.id));
      loadedCount.current = offset + rows.length;
      setHasMore(rows.length === PAGE_SIZE);
      setConversations((prev) => (append ? [...prev, ...rows] : rows));
    } catch {
      // Sidebar history is non-critical; chat still works.
    } finally {
      loadingRef.current = false;
      setLoadingConversations(false);
      if (pendingReload.current) {
        pendingReload.current = false;
        void loadConversations();
      }
    }
  }, []);

  // Coalesce the burst of change events emitted during a chat turn.
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void loadConversations();
    }, 400);
  }, [loadConversations]);

  useEffect(() => {
    void loadConversations();
    const onChange = () => scheduleReload();
    window.addEventListener(CONVERSATIONS_CHANGED, onChange);
    return () => {
      window.removeEventListener(CONVERSATIONS_CHANGED, onChange);
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    };
  }, [loadConversations, scheduleReload]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Restore persisted sidebar section states once on mount.
  useEffect(() => {
    try {
      const storedUsage = window.localStorage.getItem("axtra-usage-open");
      if (storedUsage !== null) setUsageOpen(storedUsage === "1");
    } catch {
      // Storage may be unavailable; keep defaults.
    }
  }, []);

  const toggleUsage = useCallback(() => {
    setUsageOpen((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("axtra-usage-open", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  async function handleSignOut() {
    await logout();
    router.replace("/login");
    router.refresh();
  }

  const chatSegment = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;
  const routeMode = chatSegment && isChatMode(chatSegment) ? chatSegment : null;
  const activeConversationId =
    chatSegment && !isChatMode(chatSegment) ? chatSegment : null;
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  // `/chat` (no segment) opens a fresh General chat, so its history is General's.
  const activeMode: ChatMode | null =
    routeMode ?? activeConversation?.mode ?? (pathname === "/chat" ? "general" : null);
  const visibleConversations = activeMode
    ? conversations.filter((conversation) => conversation.mode === activeMode)
    : [];
  // The theme toggle lives only on the menu/preference pages; other pages show
  // the conversation history control in its place.
  const menuPage =
    pathname === "/" ||
    pathname === "/profile" ||
    pathname === "/memory" ||
    pathname === "/settings";

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      await deleteConversation(conversationId);
      // Only hide the row once the server confirmed the delete, so a failed
      // request keeps the conversation visible and retryable.
      deletedIds.current.add(conversationId);
      closeTab(conversationId);
      setConversations((prev) => prev.filter((item) => item.id !== conversationId));
      if (activeConversationId === conversationId) {
        router.push("/chat");
      }
      emitConversationsChanged();
    },
    [activeConversationId, router],
  );

  const sidebarBody = (
    <SidebarBody
      collapsed={collapsed}
      pathname={pathname}
      usageOpen={usageOpen}
      onToggleUsage={toggleUsage}
      moreOpen={moreOpen}
      onToggleMore={() => setMoreOpen((value) => !value)}
      onNavigate={() => setDrawerOpen(false)}
      onToggleCollapse={() => setCollapsed((value) => !value)}
      onSignOut={handleSignOut}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={`hidden shrink-0 border-r border-border bg-surface md:flex md:flex-col ${
          collapsed ? "w-14" : "w-56"
        } transition-[width] duration-150`}
      >
        {sidebarBody}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/60"
          />
          <div className="relative z-50 flex h-full w-64 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <SidebarBody
              collapsed={false}
              pathname={pathname}
              usageOpen={usageOpen}
              onToggleUsage={toggleUsage}
              moreOpen={moreOpen}
              onToggleMore={() => setMoreOpen((value) => !value)}
              onNavigate={() => setDrawerOpen(false)}
              onToggleCollapse={() => setDrawerOpen(false)}
              onSignOut={handleSignOut}
              mobile
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
          <button
            type="button"
            aria-label="Buka menu"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground md:hidden"
          >
            <Menu size={18} aria-hidden />
          </button>
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold tracking-tight md:hidden">
            <Image src="/axtratr.png" alt="" width={22} height={22} priority className="h-[22px] w-[22px] rounded" />
            Axtra
          </Link>
          <div className="flex-1" />
          <UsageMeter />
          {menuPage ? (
            <ThemeToggle />
          ) : (
            <ChatHistoryMenu
              conversations={visibleConversations}
              activeConversationId={activeConversationId}
              showModeLabel={!activeMode}
              hasMore={hasMore}
              loading={loadingConversations}
              onLoadMore={() => void loadConversations(true)}
              onNavigate={() => setDrawerOpen(false)}
              onDeleteConversation={handleDeleteConversation}
            />
          )}
        </div>

        <main className="flex min-h-0 flex-1 flex-col">
          {pathname.startsWith("/chat/") && <ChatTabs />}
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

type SidebarProps = {
  collapsed: boolean;
  pathname: string;
  usageOpen: boolean;
  onToggleUsage: () => void;
  moreOpen: boolean;
  onToggleMore: () => void;
  onNavigate: () => void;
  onToggleCollapse: () => void;
  onSignOut: () => void;
  mobile?: boolean;
};

function SidebarBody({
  collapsed,
  pathname,
  usageOpen,
  onToggleUsage,
  moreOpen,
  onToggleMore,
  onNavigate,
  onToggleCollapse,
  onSignOut,
  mobile = false,
}: SidebarProps) {
  const primaryItems = [
    { href: "/", label: "Beranda", icon: Home },
    { href: "/memory", label: "Memori", icon: Brain },
    { href: "/profile", label: "Profil", icon: User },
  ];
  const rail = collapsed && !mobile;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex h-11 shrink-0 items-center ${rail ? "justify-center" : "justify-between px-3"}`}>
        {!rail && (
          <Link
            href="/"
            onClick={onNavigate}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Image src="/axtratr.png" alt="" width={24} height={24} priority className="h-6 w-6 rounded" />
            Axtra
          </Link>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
          title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        </button>
      </div>

      {!rail && (
        <nav
          aria-label="Menu fitur"
          className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          <FeatureSidebar />
        </nav>
      )}

      {!rail && (
        <div className="shrink-0 px-2 pt-2">
          <UsageMeter variant="sidebar" collapsed={!usageOpen} onToggle={onToggleUsage} />
        </div>
      )}

      <div className={`mt-auto shrink-0 border-t border-border px-2 py-2 ${rail ? "flex flex-col items-center gap-1" : ""}`}>
        <button
          type="button"
          onClick={onToggleMore}
          aria-expanded={moreOpen}
          aria-controls="more-menu"
          title="Lainnya"
          className={`flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground ${
            rail ? "h-10 w-10 justify-center px-0" : "w-full"
          }`}
        >
          <MoreHorizontal size={18} aria-hidden />
          {!rail && <span>Lainnya</span>}
        </button>

        {moreOpen && (
          <ul id="more-menu" className={`space-y-0.5 ${rail ? "mt-1" : "mt-1"}`}>
            {primaryItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={item.label}
                    className={`flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] transition-colors duration-150 ${
                      rail ? "h-10 w-10 justify-center px-0" : "w-full"
                    } ${
                      active
                        ? "bg-surface-muted text-foreground"
                        : "text-muted hover:bg-surface-muted hover:text-foreground"
                    }`}
                  >
                    <Icon size={18} aria-hidden />
                    {!rail && <span>{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className={`mt-1 flex items-center gap-1 ${rail ? "flex-col" : "justify-end"}`}>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Keluar"
            title="Keluar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut size={18} aria-hidden />
          </button>
        </div>
        {!rail && (
          <p className="mt-1 truncate px-1 text-[11px] text-muted">Pemilik</p>
        )}
      </div>
    </div>
  );
}