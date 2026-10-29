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
// Web research (Riset Web chat mode: crawl a URL into the conversation context)
// ---------------------------------------------------------------------------
export type ResearchSource = {
  id: string;
  conversation_id: string;
  url: string;
  title: string;
  site: string;
  excerpt: string;
  char_count: number;
  provider?: string;
  notice?: string | null;
  created_at: string | null;
};

export async function crawlUrl(
  url: string,
  conversationId: string | null,
): Promise<ResearchSource> {
  return apiFetch<ResearchSource>("/research/crawl", {
    method: "POST",
    body: JSON.stringify({ url, conversation_id: conversationId }),
  });
}

export async function listResearchSources(
  conversationId: string,
): Promise<ResearchSource[]> {
  return apiFetch<ResearchSource[]>(
    `/research/sources?conversation_id=${encodeURIComponent(conversationId)}`,
  );
}

export async function deleteResearchSource(sourceId: string): Promise<void> {
  await apiFetch<void>(`/research/sources/${sourceId}`, { method: "DELETE" });
}

/** Extract durable facts from a crawled source and store them as memories. */
export async function saveResearchSourceToMemory(
  sourceId: string,
): Promise<{ id: string; type: string; content: string }[]> {
  return apiFetch(`/research/sources/${sourceId}/memory`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Cari Kerja (job application tracker + CV matching)
// ---------------------------------------------------------------------------
export type JobStatus =
  | "draft"
  | "applied"
  | "screening"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export type JobApplication = {
  id: string;
  company: string;
  role: string;
  location: string;
  work_type: string;
  salary: string;
  job_url: string | null;
  source: string;
  status: JobStatus;
  applied_at: string | null;
  deadline: string | null;
  notes: string;
  job_description: string;
  job_title: string;
  predicted_jobdesk: string;
  match_score: number | null;
  match_analysis: string;
  success_score: number | null;
  success_analysis: string;
  cover_letter: string;
  analyzed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  crawl_notice?: string | null;
};

export type JobApplicationInput = {
  company: string;
  role: string;
  location?: string;
  work_type?: string;
  salary?: string;
  job_url?: string | null;
  status?: JobStatus;
  applied_at?: string | null;
  deadline?: string | null;
  created_at?: string | null;
  notes?: string;
  job_description?: string;
};

export type JobCv = {
  filename: string;
  summary: string;
  char_count: number;
  updated_at: string | null;
};

export async function listJobs(params?: {
  status?: JobStatus;
  search?: string;
}): Promise<JobApplication[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.search?.trim()) query.set("search", params.search.trim());
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<JobApplication[]>(`/jobs${suffix}`);
}

export async function getJob(id: string): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}`);
}

export async function createJob(
  input: JobApplicationInput,
): Promise<JobApplication> {
  return apiFetch<JobApplication>("/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateJob(
  id: string,
  patch: Partial<JobApplicationInput> & { cover_letter?: string },
): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteJob(id: string): Promise<void> {
  await apiFetch<void>(`/jobs/${id}`, { method: "DELETE" });
}

export async function getJobCv(): Promise<JobCv> {
  return apiFetch<JobCv>("/jobs/cv");
}

export async function uploadJobCv(file: File): Promise<JobCv> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}/jobs/cv`, {
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
      (data as { detail?: string } | null)?.detail ??
      `Upload CV gagal (${response.status}).`;
    throw new ApiError(response.status, detail);
  }
  return data as JobCv;
}

export async function deleteJobCv(): Promise<void> {
  await apiFetch<void>("/jobs/cv", { method: "DELETE" });
}

export async function crawlJob(
  id: string,
  url?: string,
): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}/crawl`, {
    method: "POST",
    body: JSON.stringify({ url: url?.trim() || null }),
  });
}

export async function analyzeJob(id: string): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}/analyze`, { method: "POST" });
}

export async function generateCoverLetter(id: string): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}/cover-letter`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Projects (Phase 2 project registry)
// ---------------------------------------------------------------------------
export type ProjectStatus = "idea" | "active" | "paused" | "done";

export type Project = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  tech_stack: string[];
  repo_url: string | null;
  notes: string;
  source: string;
  source_ref: Record<string, unknown>;
  repo_full_name: string | null;
  repo_branch: string | null;
  repo_index_status: "none" | "pending" | "indexing" | "ready" | "error";
  repo_file_count: number;
  repo_chunk_count: number;
  repo_summary: string | null;
  repo_index_error: string | null;
  repo_index_progress: number;
  repo_index_stage: string | null;
  repo_indexed_at: string | null;
  health_summary: string | null;
  health_generated_at: string | null;
  health_stale: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type ProjectInput = {
  name: string;
  description?: string;
  status?: ProjectStatus;
  tech_stack?: string[];
  repo_url?: string | null;
  notes?: string;
};

export async function listProjects(params?: {
  status?: ProjectStatus;
  search?: string;
}): Promise<Project[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status_", params.status);
  if (params?.search?.trim()) query.set("search", params.search.trim());
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<Project[]>(`/projects${suffix}`);
}

export async function createProject(input: ProjectInput): Promise<Project> {
  return apiFetch<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(
  id: string,
  patch: Partial<ProjectInput>,
): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/projects/${id}`, { method: "DELETE" });
}

export async function getProject(id: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}`);
}

export type RepoFile = {
  path: string;
  language: string;
  chunk_count: number;
};

export type RepoFileContent = {
  path: string;
  language: string;
  content: string;
};

export async function listProjectFiles(id: string): Promise<RepoFile[]> {
  return apiFetch<RepoFile[]>(`/projects/${id}/files`);
}

export async function getProjectFile(
  id: string,
  path: string,
): Promise<RepoFileContent> {
  return apiFetch<RepoFileContent>(
    `/projects/${id}/files/content?path=${encodeURIComponent(path)}`,
  );
}

export type RepoAskResult = {
  answer: string;
  sources: { path: string; language: string; snippet: string; score: number | null }[];
  ask_id?: string | null;
};

export async function indexProjectRepo(id: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}/repo/index`, { method: "POST" });
}

export async function clearProjectRepo(id: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}/repo`, { method: "DELETE" });
}

export async function askProjectRepo(
  id: string,
  question: string,
): Promise<RepoAskResult> {
  return apiFetch<RepoAskResult>(`/projects/${id}/repo/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

// ---------------------------------------------------------------------------
// Project asks (persisted "Tanya repo" history for the right sidebar)
// ---------------------------------------------------------------------------
export type ProjectAsk = {
  id: string;
  project_id: string;
  question: string;
  answer: string;
  sources: { path: string; language: string; snippet: string; score: number | null }[];
  error: string | null;
  created_at: string | null;
};

export async function listProjectAsks(id: string): Promise<ProjectAsk[]> {
  return apiFetch<ProjectAsk[]>(`/projects/${id}/asks`);
}

export async function deleteProjectAsk(id: string, askId: string): Promise<void> {
  await apiFetch<void>(`/projects/${id}/asks/${askId}`, { method: "DELETE" });
}

export async function clearProjectAsks(id: string): Promise<void> {
  await apiFetch<void>(`/projects/${id}/asks`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Project tasks (per-project todos)
// ---------------------------------------------------------------------------
export type ProjectTaskStatus = "todo" | "doing" | "done";
export type ProjectTaskPriority = "low" | "medium" | "high";

export type ProjectTask = {
  id: string;
  project_id: string;
  title: string;
  detail: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  source: string;
  position: number;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

export async function listProjectTasks(id: string): Promise<ProjectTask[]> {
  return apiFetch<ProjectTask[]>(`/projects/${id}/tasks`);
}

export async function createProjectTask(
  id: string,
  input: {
    title: string;
    detail?: string;
    status?: ProjectTaskStatus;
    priority?: ProjectTaskPriority;
  },
): Promise<ProjectTask> {
  return apiFetch<ProjectTask>(`/projects/${id}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProjectTask(
  id: string,
  taskId: string,
  patch: Partial<{
    title: string;
    detail: string;
    status: ProjectTaskStatus;
    priority: ProjectTaskPriority;
  }>,
): Promise<ProjectTask> {
  return apiFetch<ProjectTask>(`/projects/${id}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteProjectTask(id: string, taskId: string): Promise<void> {
  await apiFetch<void>(`/projects/${id}/tasks/${taskId}`, { method: "DELETE" });
}

export async function reorderProjectTasks(
  id: string,
  items: { id: string; status: ProjectTaskStatus; position: number }[],
): Promise<ProjectTask[]> {
  return apiFetch<ProjectTask[]>(`/projects/${id}/tasks/reorder`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

// ---------------------------------------------------------------------------
// Project health (AI review cached on the project)
// ---------------------------------------------------------------------------
export async function analyzeProjectHealth(id: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${id}/health`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Project conversations (chat threads linked to a project via @mention)
// ---------------------------------------------------------------------------
export type ProjectConversation = {
  conversation_id: string;
  title: string | null;
  mode: string;
  message_count: number;
  created_at: string | null;
  last_message_at: string | null;
  linked_at: string | null;
};

export async function listProjectConversations(
  id: string,
): Promise<ProjectConversation[]> {
  return apiFetch<ProjectConversation[]>(`/projects/${id}/conversations`);
}

// ---------------------------------------------------------------------------
// Project documents & links (non-repo project data)
// ---------------------------------------------------------------------------
export type ProjectDocumentKind = "note" | "link";

export type ProjectDocument = {
  id: string;
  project_id: string;
  title: string;
  kind: ProjectDocumentKind;
  url: string | null;
  content: string;
  source: string;
  created_at: string | null;
  updated_at: string | null;
};

export async function listProjectDocuments(
  id: string,
): Promise<ProjectDocument[]> {
  return apiFetch<ProjectDocument[]>(`/projects/${id}/documents`);
}

export async function createProjectDocument(
  id: string,
  input: {
    title?: string;
    kind?: ProjectDocumentKind;
    url?: string | null;
    content?: string;
  },
): Promise<ProjectDocument> {
  return apiFetch<ProjectDocument>(`/projects/${id}/documents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProjectDocument(
  id: string,
  documentId: string,
  patch: Partial<{
    title: string;
    kind: ProjectDocumentKind;
    url: string | null;
    content: string;
  }>,
): Promise<ProjectDocument> {
  return apiFetch<ProjectDocument>(`/projects/${id}/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteProjectDocument(
  id: string,
  documentId: string,
): Promise<void> {
  await apiFetch<void>(`/projects/${id}/documents/${documentId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Chat mode settings (role, behavior, slash commands)
// ---------------------------------------------------------------------------
export type ChatModeId =
  | "general"
  | "curhat"
  | "brainstorming"
  | "document"
  | "research";

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

export type CrawlProviderId = "httpx" | "firecrawl";

export type CrawlSettings = {
  provider: CrawlProviderId;
  firecrawl_ready: boolean;
  firecrawl_key_configured: boolean;
  firecrawl_base_url: string;
  daily_limit: number;
  monthly_limit: number;
  daily_used: number;
  monthly_used: number;
};

export type ChatSettings = {
  modes: ModeCatalogEntry[];
  commands: Partial<Record<ChatModeId, ChatCommand[]>>;
  selected: Record<ChatModeId, ModeSelection>;
  crawl?: CrawlSettings;
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

export async function saveCrawlSettings(input: {
  provider: CrawlProviderId;
}): Promise<CrawlSettings> {
  return apiFetch<CrawlSettings>("/chat-settings/crawl", {
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
  | { type: "save_memory"; content?: string; memory_type?: string }
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
