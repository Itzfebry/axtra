"use client";

/**
 * Persistent, module-level chat store.
 *
 * Chat state and the SSE streaming loop live here instead of inside the React
 * component tree, so replies keep streaming while the user switches tabs or
 * navigates away. Components subscribe to the slices they render.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  apiFetch,
  deleteDocument as apiDeleteDocument,
  listDocuments,
  streamChat,
  uploadDocument as apiUploadDocument,
  type DocumentRow,
} from "@/lib/api";
import type { ChatMode } from "@/lib/chatModes";

const CONVERSATIONS_EVENT = "axtra:conversations-changed";
const USAGE_EVENT = "axtra:usage-changed";
const TABS_STORAGE_KEY = "axtra-chat-tabs";

export const OPTIONS_MARKER = /```\s*options/i;

/** Hide the machine-readable options block while tokens stream in. */
export function visibleContent(content: string): string {
  const index = content.search(OPTIONS_MARKER);
  return (index === -1 ? content : content.slice(0, index)).trimEnd();
}

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id?: string;
  role: ChatRole;
  content: string;
  model?: string | null;
  pending?: boolean;
  elapsedMs?: number;
  options?: string[];
  command?: string | null;
};

export type ChatSlice = {
  key: string;
  conversationId: string | null;
  mode: ChatMode;
  title: string | null;
  messages: ChatMessage[];
  loading: boolean;
  loaded: boolean;
  sending: boolean;
  notice: string | null;
  memorySaved: string[] | null;
  elapsed: number;
  draft: string;
  pendingCommand: string | null;
  documents: DocumentRow[];
  documentsLoaded: boolean;
  uploading: boolean;
  uploadError: string | null;
};

type State = {
  order: string[];
  slices: Record<string, ChatSlice>;
  activeKey: string | null;
};

type MessageRow = {
  id: string;
  role: ChatRole;
  content: string;
  model?: string | null;
  metadata?: { options?: string[]; command?: string };
};

type ConversationMeta = { title: string | null; mode: ChatMode };

const SERVER_STATE: State = { order: [], slices: {}, activeKey: null };
let state: State = { order: [], slices: {}, activeKey: null };

const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const timers = new Map<string, number>();

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: State) {
  state = next;
  emit();
}

function notifyConversations() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONVERSATIONS_EVENT));
}

function notifyUsage() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USAGE_EVENT));
}

function blankSlice(
  key: string,
  conversationId: string | null,
  mode: ChatMode,
  title: string | null = null,
  loading = false,
): ChatSlice {
  return {
    key,
    conversationId,
    mode,
    title,
    messages: [],
    loading,
    loaded: false,
    sending: false,
    notice: null,
    memorySaved: null,
    elapsed: 0,
    draft: "",
    pendingCommand: null,
    documents: [],
    documentsLoaded: false,
    uploading: false,
    uploadError: null,
  };
}

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model ?? null,
    options: row.metadata?.options ?? [],
    command: row.metadata?.command ?? null,
  };
}

function updateSlice(key: string, patch: Partial<ChatSlice>) {
  const current = state.slices[key];
  if (!current) return;
  commit({ ...state, slices: { ...state.slices, [key]: { ...current, ...patch } } });
}

function persistMeta() {
  if (typeof window === "undefined") return;
  try {
    const meta = state.order
      .map((key) => state.slices[key])
      .filter((slice): slice is ChatSlice => Boolean(slice?.conversationId))
      .map((slice) => ({
        key: slice.key,
        conversationId: slice.conversationId,
        mode: slice.mode,
        title: slice.title,
      }));
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Storage is optional.
  }
}

function restore() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return;
    const meta = JSON.parse(raw) as {
      key?: string;
      conversationId: string | null;
      mode: ChatMode;
      title: string | null;
    }[];
    const order: string[] = [];
    const slices: Record<string, ChatSlice> = {};
    for (const item of meta) {
      if (!item.conversationId) continue;
      const key = item.conversationId;
      order.push(key);
      slices[key] = blankSlice(key, key, item.mode, item.title ?? null, true);
    }
    if (order.length > 0) state = { order, slices, activeKey: null };
  } catch {
    // Ignore corrupt storage.
  }
}

function titleHint(text: string, command: string | null): string | null {
  const trimmed = text.trim();
  if (trimmed) return trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed;
  if (command) return `/${command}`;
  return null;
}

async function loadConversation(key: string) {
  const slice = state.slices[key];
  if (!slice?.conversationId || slice.loaded) return;
  const conversationId = slice.conversationId;
  updateSlice(key, { loading: true });
  try {
    const [rows, conversation] = await Promise.all([
      apiFetch<MessageRow[]>(`/conversations/${conversationId}/messages?limit=200`),
      apiFetch<ConversationMeta>(`/conversations/${conversationId}`).catch(() => null),
    ]);
    if (!state.slices[key]) return;
    const resolvedMode = conversation?.mode ?? state.slices[key].mode;
    updateSlice(key, {
      loading: false,
      loaded: true,
      messages: (rows ?? []).filter((row) => row.role !== "system").map(rowToMessage),
      title: conversation?.title ?? state.slices[key].title,
      mode: resolvedMode,
    });
    if (resolvedMode === "document") void loadDocuments(key);
  } catch (error) {
    if (!state.slices[key]) return;
    updateSlice(key, {
      loading: false,
      notice: error instanceof Error ? error.message : "Gagal memuat percakapan.",
    });
  }
}

async function loadDocuments(key: string) {
  const slice = state.slices[key];
  if (!slice?.conversationId || slice.documentsLoaded) return;
  try {
    const rows = await listDocuments(slice.conversationId);
    if (!state.slices[key]) return;
    updateSlice(key, { documents: rows, documentsLoaded: true });
  } catch {
    if (!state.slices[key]) return;
    updateSlice(key, { documentsLoaded: true });
  }
}

function ensureSlice(conversationId: string | null, mode: ChatMode): string {
  const key = conversationId ?? `new:${mode}`;
  if (state.slices[key]) return key;
  const slice = blankSlice(key, conversationId, mode, null, conversationId != null);
  commit({
    ...state,
    order: [...state.order, key],
    slices: { ...state.slices, [key]: slice },
  });
  persistMeta();
  return key;
}

function startTimer(key: string) {
  stopTimer(key);
  const startedAt = performance.now();
  const timer = window.setInterval(() => {
    if (!state.slices[key]) {
      stopTimer(key);
      return;
    }
    updateSlice(key, { elapsed: (performance.now() - startedAt) / 1000 });
  }, 100);
  timers.set(key, timer);
}

function stopTimer(key: string) {
  const timer = timers.get(key);
  if (timer !== undefined) {
    window.clearInterval(timer);
    timers.delete(key);
  }
}

function rekey(oldKey: string, conversationId: string, mode: ChatMode): string {
  if (oldKey === conversationId) return conversationId;
  const slice = state.slices[oldKey];
  if (!slice) return oldKey;
  const slices = { ...state.slices };
  delete slices[oldKey];
  slices[conversationId] = { ...slice, key: conversationId, conversationId, mode };
  const order = state.order.map((key) => (key === oldKey ? conversationId : key));
  const activeKey = state.activeKey === oldKey ? conversationId : state.activeKey;
  commit({ ...state, order, slices, activeKey });
  const controller = controllers.get(oldKey);
  if (controller) {
    controllers.delete(oldKey);
    controllers.set(conversationId, controller);
  }
  const timer = timers.get(oldKey);
  if (timer !== undefined) {
    timers.delete(oldKey);
    timers.set(conversationId, timer);
  }
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", `/chat/${conversationId}`);
  }
  persistMeta();
  return conversationId;
}

/** Ensure a tab for the route exists and is active. Returns its key. */
export function openRoute(conversationId: string | null, mode: ChatMode): string {
  const key = ensureSlice(conversationId, mode);
  if (state.activeKey !== key) {
    commit({ ...state, activeKey: key });
    persistMeta();
  }
  const slice = state.slices[key];
  if (slice?.conversationId && !slice.loaded && !slice.sending) void loadConversation(key);
  if (slice?.conversationId && slice.mode === "document") void loadDocuments(key);
  return key;
}

export function closeTab(key: string): void {
  const slice = state.slices[key];
  if (!slice) return;
  controllers.get(key)?.abort();
  controllers.delete(key);
  stopTimer(key);
  const index = state.order.indexOf(key);
  const order = state.order.filter((orderKey) => orderKey !== key);
  const slices = { ...state.slices };
  delete slices[key];
  let activeKey = state.activeKey;
  if (activeKey === key) {
    activeKey = order[index] ?? order[index - 1] ?? null;
  }
  commit({ ...state, order, slices, activeKey });
  persistMeta();
}

export function setDraft(key: string, value: string) {
  updateSlice(key, { draft: value });
}

export function setPendingCommand(key: string, command: string | null) {
  updateSlice(key, { pendingCommand: command, draft: "" });
}

export function clearNotice(key: string) {
  updateSlice(key, { notice: null, memorySaved: null });
}

export function stop(key: string) {
  controllers.get(key)?.abort();
}

export async function send(key: string, rawText: string) {
  const initial = state.slices[key];
  if (!initial || initial.sending) return;
  const command = initial.pendingCommand;
  const text = rawText.trim();
  if (!text && !command) return;

  const controller = new AbortController();
  controllers.set(key, controller);

  updateSlice(key, {
    draft: "",
    pendingCommand: null,
    notice: null,
    memorySaved: null,
    sending: true,
    elapsed: 0,
    messages: [
      ...initial.messages,
      { role: "user", content: text, command },
      { role: "assistant", content: "", pending: true },
    ],
  });
  startTimer(key);

  let currentKey = key;

  function finalize() {
    const slice = state.slices[currentKey];
    if (!slice) return;
    const messages = [...slice.messages];
    const last = messages[messages.length - 1];
    if (last?.pending) {
      messages[messages.length - 1] = {
        ...last,
        pending: false,
        content: visibleContent(last.content) || "(Tidak ada balasan.)",
      };
    }
    updateSlice(currentKey, { messages, sending: false });
  }

  try {
    for await (const event of streamChat(
      {
        conversation_id: initial.conversationId,
        message: text,
        use_memory: true,
        mode: initial.mode,
        command: command ?? undefined,
      },
      controller.signal,
    )) {
      const slice = state.slices[currentKey];
      if (!slice) return; // tab closed
      if (controllers.get(currentKey) !== controller) return; // superseded

      if (event.event === "meta") {
        if (!slice.conversationId) {
          currentKey = rekey(currentKey, event.data.conversation_id, slice.mode);
        }
      } else if (event.event === "token") {
        const messages = [...slice.messages];
        const last = messages[messages.length - 1];
        if (last?.pending) {
          messages[messages.length - 1] = { ...last, content: last.content + event.data.t };
        }
        updateSlice(currentKey, { messages });
      } else if (event.event === "memory") {
        if (event.data.saved?.length) {
          updateSlice(currentKey, { memorySaved: event.data.saved.map((item) => item.content) });
        }
        notifyUsage();
      } else if (event.event === "warning" || event.event === "error") {
        updateSlice(currentKey, { notice: event.data.detail });
      } else if (event.event === "done") {
        const current = state.slices[currentKey];
        if (current) {
          const messages = [...current.messages];
          const last = messages[messages.length - 1];
          if (last?.pending) {
            messages[messages.length - 1] = {
              ...last,
              pending: false,
              content:
                event.data.content || visibleContent(last.content) || "(Tidak ada balasan.)",
              options: event.data.options ?? [],
              elapsedMs: event.data.elapsed_ms,
            };
          }
          updateSlice(currentKey, {
            messages,
            sending: false,
            title: current.title ?? titleHint(text, command),
          });
        }
        notifyUsage();
      }
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (!aborted && controllers.get(currentKey) === controller) {
      updateSlice(currentKey, {
        notice: error instanceof Error ? error.message : "Koneksi ke server terputus.",
      });
    }
  } finally {
    stopTimer(currentKey);
    if (controllers.get(currentKey) === controller) {
      finalize();
      controllers.delete(currentKey);
    }
    notifyConversations();
    persistMeta();
  }
}

export async function uploadAttachment(key: string, file: File) {
  const slice = state.slices[key];
  if (!slice || slice.uploading) return;
  updateSlice(key, { uploading: true, uploadError: null });
  let targetKey = key;
  try {
    const document = await apiUploadDocument(file, slice.conversationId);
    if (!state.slices[key]) return;
    if (!slice.conversationId) {
      targetKey = rekey(key, document.conversation_id, slice.mode);
    }
    const target = state.slices[targetKey];
    if (target) {
      commit({
        ...state,
        slices: {
          ...state.slices,
          [targetKey]: {
            ...target,
            documents: [...target.documents, document],
            uploading: false,
          },
        },
      });
    }
  } catch (error) {
    if (state.slices[targetKey]) {
      updateSlice(targetKey, {
        uploading: false,
        uploadError: error instanceof Error ? error.message : "Upload gagal.",
      });
    }
  }
}

export async function removeAttachment(key: string, documentId: string) {
  const slice = state.slices[key];
  if (!slice) return;
  const previous = slice.documents;
  updateSlice(key, { documents: previous.filter((item) => item.id !== documentId) });
  try {
    await apiDeleteDocument(documentId);
  } catch (error) {
    if (state.slices[key]) {
      updateSlice(key, {
        documents: previous,
        uploadError: error instanceof Error ? error.message : "Gagal menghapus dokumen.",
      });
    }
  }
}

export function getState(): State {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useStore<T>(
  selector: (snapshot: State) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selector(state);
    if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next };
    return next;
  }, [selector, isEqual]);
  const getServerSnapshot = useCallback(() => selector(SERVER_STATE), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useChatActiveKey(): string | null {
  const selector = useCallback((snapshot: State) => snapshot.activeKey, []);
  return useStore(selector);
}

export function useChatSlice(key: string | null): ChatSlice | undefined {
  const selector = useCallback(
    (snapshot: State) => (key ? snapshot.slices[key] : undefined),
    [key],
  );
  return useStore(selector);
}

export type ChatTabMeta = {
  key: string;
  conversationId: string | null;
  mode: ChatMode;
  title: string | null;
  sending: boolean;
};

function tabsEqual(a: ChatTabMeta[], b: ChatTabMeta[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.key !== right.key ||
      left.conversationId !== right.conversationId ||
      left.mode !== right.mode ||
      left.title !== right.title ||
      left.sending !== right.sending
    ) {
      return false;
    }
  }
  return true;
}

export function useChatTabs(): { tabs: ChatTabMeta[]; activeKey: string | null } {
  const selector = useCallback(
    (snapshot: State) => ({
      tabs: snapshot.order.map((key) => {
        const slice = snapshot.slices[key];
        return {
          key,
          conversationId: slice?.conversationId ?? null,
          mode: slice?.mode ?? "general",
          title: slice?.title ?? null,
          sending: slice?.sending ?? false,
        };
      }),
      activeKey: snapshot.activeKey,
    }),
    [],
  );
  return useStore(selector, (a, b) => a.activeKey === b.activeKey && tabsEqual(a.tabs, b.tabs));
}

restore();
