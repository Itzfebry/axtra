/** Thin API client for the Axtra FastAPI backend (single-password session). */

export const API_BASE = process.env.NEXT_PUBLIC_API_PROXY
  ? "/api-proxy"
  : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000") + "/api";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const next = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError(401, "Sesi tidak valid. Silakan login ulang.");
  }
  return response;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail =
      (data as { detail?: string } | null)?.detail ?? `Permintaan gagal (${response.status}).`;
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

/** Exchange the shared password for a session cookie. Does not auto-redirect. */
export async function login(password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  const text = await response.text();
  let data: { detail?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.detail ?? "Login gagal.");
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // Ignore network failures; the client still navigates to /login.
  }
  // Personal caches must not survive a sign-out on a shared browser.
  try {
    window.localStorage.removeItem("axtra-recommendations");
    window.localStorage.removeItem("axtra-menu-config");
    window.sessionStorage.removeItem("axtra-pending-prompt");
  } catch {
    // Storage may be unavailable; nothing to clear.
  }
}

export async function authStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/auth/status`, { credentials: "include" });
    if (!response.ok) return false;
    const data = (await response.json()) as { authenticated?: boolean };
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Documents (Document-mode chat attachments)
// ---------------------------------------------------------------------------
export type DocumentRow = {
  id: string;
  conversation_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string | null;
};

export async function uploadDocument(
  file: File,
  conversationId: string | null,
): Promise<DocumentRow> {
  const form = new FormData();
  form.append("file", file);
  if (conversationId) form.append("conversation_id", conversationId);

  const response = await fetch(`${API_BASE}/documents`, {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError(401, "Sesi tidak valid. Silakan login ulang.");
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail =
      (data as { detail?: string } | null)?.detail ?? `Upload gagal (${response.status}).`;
    throw new ApiError(response.status, detail);
  }
  return data as DocumentRow;
}

export async function listDocuments(conversationId: string): Promise<DocumentRow[]> {
  return apiFetch<DocumentRow[]>(`/documents?conversation_id=${encodeURIComponent(conversationId)}`);
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiFetch<void>(`/documents/${documentId}`, { method: "DELETE" });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiFetch<void>(`/conversations/${conversationId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Chat mode settings (role, behavior, slash commands)
// ---------------------------------------------------------------------------
export type ChatModeId = "general" | "curhat" | "brainstorming" | "document";

export type ModeRolePreset = {
  id: string;
  label: string;
  description: string;
};

export type ModeBehaviorPreset = {
  id: string;
  label: string;
  steps?: string[];
};

export type ModeCatalogEntry = {
  id: ChatModeId;
  roles: ModeRolePreset[];
  behaviors: ModeBehaviorPreset[];
};

export type ChatCommand = {
  id: string;
  label: string;
  description: string;
};

export type ModeSelection = {
  roles: string[];
  role_note: string;
  behavior: string;
};

export type ChatSettings = {
  modes: ModeCatalogEntry[];
  commands: Partial<Record<ChatModeId, ChatCommand[]>>;
  selected: Record<ChatModeId, ModeSelection>;
};

export async function fetchChatSettings(): Promise<ChatSettings> {
  return apiFetch<ChatSettings>("/chat-settings");
}

export async function saveChatSettings(input: {
  mode: ChatModeId;
  roles: string[];
  behavior: string;
  role_note: string;
}): Promise<ChatSettings> {
  return apiFetch<ChatSettings>("/chat-settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Token usage (navbar/sidebar meters)
// ---------------------------------------------------------------------------
export type UsageStats = {
  minute_tokens: number;
  day_tokens: number;
  minute_limit: number;
  day_limit: number;
  model: string;
  timezone: string;
  day_reset_at: string;
};

export async function fetchUsage(): Promise<UsageStats> {
  return apiFetch<UsageStats>("/usage");
}

// ---------------------------------------------------------------------------
// Assistant recommendations (homepage digest of interaction history)
// ---------------------------------------------------------------------------
export type Recommendations = {
  greeting: string;
  items: string[];
  conversation_count: number;
  memory_count: number;
  generated_at: string;
  source: "llm" | "fallback" | "empty";
};

export async function fetchRecommendations(): Promise<Recommendations> {
  return apiFetch<Recommendations>("/recommendations");
}

// ---------------------------------------------------------------------------
// Homepage orchestrator (menu configuration + navigation)
// ---------------------------------------------------------------------------
export type OrchestratorMenuEntry = {
  id: string;
  label: string;
  live: boolean;
  href: string | null;
  visible: boolean;
};

export type OrchestratorAction =
  | { type: "menu_order"; order?: string[] }
  | { type: "menu_visibility"; hidden?: string[] }
  | { type: "menu_rename"; labels?: Record<string, string> }
  | { type: "navigate"; href?: string; prompt?: string }
  | { type: "reset_menu" }
  | { type: "set_theme"; theme?: "light" | "dark" }
  | { type: "save_memory"; content?: string }
  | { type: "new_conversation"; mode?: string; title?: string; prompt?: string }
  | { type: "focus_menu"; target?: string };

export type OrchestratorResponse = {
  reply: string;
  actions: OrchestratorAction[];
};

export async function orchestrate(input: {
  message: string;
  menu: OrchestratorMenuEntry[];
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<OrchestratorResponse> {
  return apiFetch<OrchestratorResponse>("/orchestrator", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Quick manual memory, e.g. from an orchestrator "save_memory" action. */
export async function createMemory(input: {
  content: string;
  type?: string;
  source?: string;
}): Promise<void> {
  await apiFetch<void>("/memories", {
    method: "POST",
    body: JSON.stringify({ type: "semantic", source: "orchestrator", ...input }),
  });
}

// ---------------------------------------------------------------------------
// Memory curation (group same-topic memories, merge into one summary)
// ---------------------------------------------------------------------------
export type MemoryClusterMember = {
  id: string;
  type: string;
  content: string;
  source: string;
  confidence: number;
  status: string;
  created_at: string | null;
};

export type MemoryCluster = {
  key: string;
  memories: MemoryClusterMember[];
};

export async function fetchMemoryClusters(): Promise<MemoryCluster[]> {
  return apiFetch<MemoryCluster[]>("/memories/clusters");
}

export async function mergeMemories(
  ids: string[],
  type?: string,
): Promise<MemoryClusterMember> {
  return apiFetch<MemoryClusterMember>("/memories/merge", {
    method: "POST",
    body: JSON.stringify(type ? { ids, type } : { ids }),
  });
}

/** Streamed chat over SSE. Yields typed events, never throws mid-stream. */
export type ChatServerEvent =
  | { event: "meta"; data: { conversation_id: string; model: string; mode: string } }
  | { event: "token"; data: { t: string } }
  | { event: "memory"; data: { saved: { id: string; type: string; content: string }[] } }
  | { event: "warning"; data: { detail: string } }
  | { event: "error"; data: { detail: string } }
  | { event: "done"; data: { conversation_id: string; elapsed_ms: number; content: string; options: string[]; mode: string } };

export async function* streamChat(
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<ChatServerEvent> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });

  if (response.status === 401) {
    redirectToLogin();
    yield { event: "error", data: { detail: "Sesi tidak valid. Silakan login ulang." } };
    return;
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    yield { event: "error", data: { detail: detail || `HTTP ${response.status}` } };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!event || !dataLine) continue;
      try {
        const data = JSON.parse(dataLine);
        const typedEvent = { event, data } as ChatServerEvent;
        yield typedEvent;
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}
