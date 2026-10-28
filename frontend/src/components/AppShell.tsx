"use client";

import {
  Brain,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  GraduationCap,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Trash2,
  User,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, deleteConversation, logout } from "@/lib/api";
import { closeTab } from "@/lib/chatStore";
import { CHAT_MODES, getChatMode, isChatMode, type ChatMode } from "@/lib/chatModes";
import { ChatTabs } from "@/components/ChatTabs";
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

const FUTURE_ITEMS = [
  { href: "/projects", label: "Proyek", icon: FolderKanban },
  { href: "/journal", label: "Jurnal", icon: NotebookPen },
  { href: "/mentor", label: "Mentor", icon: GraduationCap },
  { href: "/automations", label: "Otomasi", icon: Workflow },
];

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
  const [search, setSearch] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  // Sidebar sections that the user can collapse. Persisted in localStorage.
  const [modeNavOpen, setModeNavOpen] = useState(false);
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
      const storedModes = window.localStorage.getItem("axtra-mode-nav-open");
      if (storedModes !== null) setModeNavOpen(storedModes === "1");
      const storedUsage = window.localStorage.getItem("axtra-usage-open");
      if (storedUsage !== null) setUsageOpen(storedUsage === "1");
    } catch {
      // Storage may be unavailable; keep defaults.
    }
  }, []);

  const toggleModeNav = useCallback(() => {
    setModeNavOpen((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("axtra-mode-nav-open", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
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

  const filtered = search.trim()
    ? conversations.filter((conversation) =>
        (conversation.title ?? "").toLowerCase().includes(search.trim().toLowerCase()),
      )
    : conversations;

  const chatSegment = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;
  const routeMode = chatSegment && isChatMode(chatSegment) ? chatSegment : null;
  const activeConversationId =
    chatSegment && !isChatMode(chatSegment) ? chatSegment : null;
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeMode: ChatMode | null = routeMode ?? activeConversation?.mode ?? null;
  const visibleConversations = activeMode
    ? filtered.filter((conversation) => conversation.mode === activeMode)
    : [];
  // Mode nav is hidden on the homepage (feature menu + settings).
  const hideModeNav = pathname === "/";
  // History is scoped to the active mode and only shown on a chat route, so a
  // mode's conversations never appear outside its own page.
  const showHistory = pathname.startsWith("/chat/") && activeMode !== null;

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      deletedIds.current.add(conversationId);
      await deleteConversation(conversationId);
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
      activeConversationId={activeConversationId}
      activeMode={activeMode}
      hideModeNav={hideModeNav}
      showHistory={showHistory}
      modeNavOpen={modeNavOpen}
      onToggleModeNav={toggleModeNav}
      usageOpen={usageOpen}
      onToggleUsage={toggleUsage}
      filtered={visibleConversations}
      search={search}
      onSearch={setSearch}
      hasMore={hasMore}
      loading={loadingConversations}
      moreOpen={moreOpen}
      onToggleMore={() => setMoreOpen((value) => !value)}
      onLoadMore={() => void loadConversations(true)}
      onDeleteConversation={handleDeleteConversation}
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
              activeConversationId={activeConversationId}
              activeMode={activeMode}
              hideModeNav={hideModeNav}
              showHistory={showHistory}
              modeNavOpen={modeNavOpen}
              onToggleModeNav={toggleModeNav}
              usageOpen={usageOpen}
              onToggleUsage={toggleUsage}
              filtered={visibleConversations}
              search={search}
              onSearch={setSearch}
              hasMore={hasMore}
              loading={loadingConversations}
              moreOpen={moreOpen}
              onToggleMore={() => setMoreOpen((value) => !value)}
              onLoadMore={() => void loadConversations(true)}
              onDeleteConversation={handleDeleteConversation}
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
          <ThemeToggle />
        </div>

        <main className="flex min-h-0 flex-1 flex-col">
          {pathname.startsWith("/chat/") && <ChatTabs />}
          {children}
        </main>
      </div>
    </div>
  );
}

type SidebarProps = {
  collapsed: boolean;
  pathname: string;
  activeConversationId: string | null;
  activeMode: ChatMode | null;
  hideModeNav: boolean;
  showHistory: boolean;
  modeNavOpen: boolean;
  onToggleModeNav: () => void;
  usageOpen: boolean;
  onToggleUsage: () => void;
  filtered: Conversation[];
  search: string;
  onSearch: (value: string) => void;
  hasMore: boolean;
  loading: boolean;
  moreOpen: boolean;
  onToggleMore: () => void;
  onLoadMore: () => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onNavigate: () => void;
  onToggleCollapse: () => void;
  onSignOut: () => void;
  mobile?: boolean;
};

function SidebarBody({
  collapsed,
  pathname,
  activeConversationId,
  activeMode,
  hideModeNav,
  showHistory,
  modeNavOpen,
  onToggleModeNav,
  usageOpen,
  onToggleUsage,
  filtered,
  search,
  onSearch,
  hasMore,
  loading,
  moreOpen,
  onToggleMore,
  onLoadMore,
  onDeleteConversation,
  onNavigate,
  onToggleCollapse,
  onSignOut,
  mobile = false,
}: SidebarProps) {
  const primaryItems = [
    { href: "/", label: "Beranda", icon: Home },
    { href: "/memory", label: "Memori", icon: Brain },
    { href: "/profile", label: "Profil", icon: User },
    { href: "/settings", label: "Pengaturan", icon: Settings },
  ];
  const rail = collapsed && !mobile;
  // While inside a mode, show only that mode unless the user expands the list.
  const visibleModes =
    rail || modeNavOpen || !activeMode
      ? CHAT_MODES
      : CHAT_MODES.filter((chatMode) => chatMode.id === activeMode);

  // Right-click context menu for a history item (delete with confirmation).
  const [menu, setMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  function openMenu(id: string, title: string, x: number, y: number) {
    setConfirming(false);
    setDeleteError(null);
    setMenu({ id, title, x, y });
  }

  async function confirmDelete() {
    if (!menu) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteConversation(menu.id);
      setMenu(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Gagal menghapus.");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

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

      {!hideModeNav && (
      <nav
        aria-label="Mode chat"
        className={`mt-2 ${rail ? "flex flex-col items-center gap-1 px-2" : "px-2"}`}
      >
        {!rail && (
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <p className="text-[11px] uppercase tracking-wide text-muted">Mode</p>
            {activeMode && (
              <button
                type="button"
                onClick={onToggleModeNav}
                aria-expanded={modeNavOpen}
                aria-label={modeNavOpen ? "Sembunyikan mode lain" : "Tampilkan semua mode"}
                title={modeNavOpen ? "Sembunyikan mode lain" : "Tampilkan semua mode"}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
              >
                {modeNavOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              </button>
            )}
          </div>
        )}
        <ul className={rail ? "space-y-1" : "space-y-0.5"}>
          {visibleModes.map((chatMode) => {
            const Icon = chatMode.icon;
            const active = activeMode === chatMode.id;
            return (
              <li key={chatMode.id}>
                <Link
                  href={`/chat/${chatMode.id}`}
                  onClick={onNavigate}
                  title={chatMode.label}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg text-[13px] transition-colors duration-150 ${
                    rail ? "h-9 w-9 justify-center" : "px-2 py-1.5"
                  } ${
                    active
                      ? "bg-surface-muted text-foreground"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={16} aria-hidden />
                  {!rail && <span>{chatMode.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      )}

      {!rail && showHistory && (
        <div className="px-2 pt-2">
          <label htmlFor="conversation-search" className="sr-only">
            Cari percakapan
          </label>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2">
            <Search size={15} className="shrink-0 text-muted" aria-hidden />
            <input
              id="conversation-search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Cari percakapan"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
          </div>
        </div>
      )}

      {!rail && showHistory && (
        <nav aria-label="Riwayat percakapan" className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 && !loading && (
            <p className="px-2 py-2 text-[13px] text-muted">
              {search.trim() ? "Tidak ada hasil." : "Belum ada riwayat."}
            </p>
          )}
          <ul className="space-y-0.5">
            {filtered.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/chat/${conversation.id}`}
                    onClick={onNavigate}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(
                        conversation.id,
                        conversation.title ?? "Percakapan",
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    aria-current={active ? "page" : undefined}
                    title={conversation.title ?? "Percakapan"}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[13px] transition-colors duration-150 ${
                      active
                        ? "bg-surface-muted text-foreground"
                        : "text-muted hover:bg-surface-muted hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{conversation.title ?? "Percakapan"}</span>
                    {!activeMode && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted">
                        {getChatMode(conversation.mode).label}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? "Memuat…" : "Muat lebih banyak"}
            </button>
          )}
        </nav>
      )}

      {(rail || !showHistory) && <div className="flex-1" />}

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
            {!rail && (
              <>
                <li className="px-2 pt-2 text-[11px] uppercase tracking-wide text-muted">
                  Segera
                </li>
                {FUTURE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <span
                        aria-disabled="true"
                        title="Tersedia pada fase berikutnya"
                        className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-muted opacity-50"
                      >
                        <Icon size={18} aria-hidden />
                        <span>{item.label}</span>
                      </span>
                    </li>
                  );
                })}
              </>
            )}
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

      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Aksi untuk ${menu.title}`}
          style={{
            top: Math.max(8, Math.min(menu.y, (window.innerHeight || 720) - 130)),
            left: Math.max(8, Math.min(menu.x, (window.innerWidth || 1024) - 190)),
          }}
          className="fixed z-[60] w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 text-[13px] shadow-lg"
        >
          <p className="truncate px-3 py-1.5 text-[11px] text-muted">{menu.title}</p>
          {!confirming ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger transition-colors duration-150 hover:bg-surface-muted"
            >
              <Trash2 size={14} aria-hidden />
              Hapus percakapan
            </button>
          ) : (
            <div className="px-3 pb-2 pt-1">
              <p className="text-[12px] text-foreground">Hapus percakapan ini?</p>
              <p className="mt-0.5 text-[11px] text-muted">Tindakan ini permanen.</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="rounded-md bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
                >
                  {deleting ? "Menghapus..." : "Ya, hapus"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setMenu(null);
                  }}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}