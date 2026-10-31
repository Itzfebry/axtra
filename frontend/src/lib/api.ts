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

/** Turn a FastAPI error body into a readable message.
 *  `detail` is a string for our own HTTPExceptions, but a list of
 *  {loc, msg} objects for request-validation (422) errors. */
function formatErrorDetail(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as { msg?: unknown; loc?: unknown };
          const msg = typeof record.msg === "string" ? record.msg : JSON.stringify(item);
          const loc = Array.isArray(record.loc)
            ? record.loc.filter((part) => part !== "body" && part !== "query").join(".")
            : "";
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .filter((line) => Boolean(line && line.trim()));
    if (messages.length) return messages.join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return `Permintaan gagal (${status}).`;
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
    throw new ApiError(response.status, formatErrorDetail(data, response.status));
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
    throw new ApiError(response.status, formatErrorDetail(data, response.status));
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

export async function searchResearch(
  query: string,
  conversationId: string | null,
  limit?: number,
): Promise<ResearchSource[]> {
  return apiFetch<ResearchSource[]>("/research/search", {
    method: "POST",
    body: JSON.stringify({ query, conversation_id: conversationId, limit }),
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
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
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
  linkedin_url: string;
  portfolio_url: string;
  portfolio_chars: number;
  linkedin_chars: number;
  links_updated_at: string | null;
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

export function uploadJobCv(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<JobCv> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/jobs/cv`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "Gagal mengunggah CV. Periksa koneksi."));
    xhr.onabort = () => reject(new ApiError(0, "Unggah CV dibatalkan."));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status === 401) {
        redirectToLogin();
        reject(new ApiError(401, "Sesi tidak valid. Silakan login ulang."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, formatErrorDetail(data, xhr.status)));
        return;
      }
      onProgress?.(100);
      resolve(data as JobCv);
    };

    xhr.send(form);
  });
}

export async function deleteJobCv(): Promise<void> {
  await apiFetch<void>("/jobs/cv", { method: "DELETE" });
}

export type JobProfileSource = "cv" | "portfolio" | "linkedin";

export async function saveJobProfileLinks(input: {
  linkedin_url: string;
  portfolio_url: string;
  portfolio_content?: string;
  linkedin_content?: string;
}): Promise<JobCv> {
  return apiFetch<JobCv>("/jobs/cv/links", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function crawlJobPortfolio(): Promise<JobCv> {
  return apiFetch<JobCv>("/jobs/cv/portfolio/crawl", { method: "POST" });
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

export async function analyzeJob(
  id: string,
  sources: JobProfileSource[] = ["cv"],
): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}/analyze`, {
    method: "POST",
    body: JSON.stringify({ sources }),
  });
}

export async function generateCoverLetter(
  id: string,
  sources: JobProfileSource[] = ["cv"],
): Promise<JobApplication> {
  return apiFetch<JobApplication>(`/jobs/${id}/cover-letter`, {
    method: "POST",
    body: JSON.stringify({ sources }),
  });
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
  labels: string[];
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
  health_history: { summary: string; generated_at: string | null }[];
  created_at: string | null;
  updated_at: string | null;
};

export type ProjectInput = {
  name: string;
  description?: string;
  status?: ProjectStatus;
  tech_stack?: string[];
  labels?: string[];
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

export type RepoAskStreamEvent =
  | { event: "token"; data: { t: string } }
  | { event: "sources"; data: { sources: RepoAskResult["sources"] } }
  | { event: "done"; data: { ask_id: string | null; answer: string } }
  | { event: "error"; data: { detail: string } };

/** Streamed "Tanya proyek" answer over SSE. Yields typed events; never throws mid-stream. */
export async function* streamRepoAsk(
  id: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<RepoAskStreamEvent> {
  const response = await fetch(`${API_BASE}/projects/${id}/repo/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
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
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!event || !dataLine) continue;
      try {
        yield { event, data: JSON.parse(dataLine) } as RepoAskStreamEvent;
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Project asks (persisted "Tanya proyek" history for the right sidebar)
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
  vibe_session_id?: string | null;
  vibe_task_key?: string | null;
  acceptance_criteria?: string[];
  dependencies?: string[];
  affected_modules?: string[];
  doc_refs?: string[];
  testing_notes?: string;
  verification_status?: VibeVerificationStatus;
  verification_evidence?: string;
  verification_notes?: string;
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
// Per-feature roles, skills & instruction (Settings page)
// ---------------------------------------------------------------------------
export type FeatureSelection = {
  roles: string;
  skills: string;
  instruction: string;
  behavior: string;
};

export type FeatureCatalogEntry = {
  id: string;
  group: string;
  label: string;
  description: string;
  role_suggestions: string[];
  skill_suggestions: string[];
  selected: FeatureSelection;
};

export type FeatureSettings = {
  features: FeatureCatalogEntry[];
  commands: Partial<Record<ChatModeId, ChatCommand[]>>;
  skills: SkillSummary[];
  assignments: Record<string, string[]>;
  skill_counts: Record<string, number>;
  crawl?: CrawlSettings;
};

export async function fetchFeatureSettings(): Promise<FeatureSettings> {
  return apiFetch<FeatureSettings>("/feature-settings");
}

export async function saveFeatureSettings(input: {
  feature: string;
  roles: string;
  skills: string;
  instruction: string;
  behavior: string;
  skill_ids: string[];
}): Promise<{ feature: string; selected: FeatureSelection; skill_ids: string[] }> {
  return apiFetch<{
    feature: string;
    selected: FeatureSelection;
    skill_ids: string[];
  }>(`/feature-settings/${encodeURIComponent(input.feature)}`, {
    method: "PUT",
    body: JSON.stringify({
      roles: input.roles,
      skills: input.skills,
      instruction: input.instruction,
      behavior: input.behavior,
      skill_ids: input.skill_ids,
    }),
  });
}

// ---------------------------------------------------------------------------
// AI skills (structured Markdown skills with metadata)
// ---------------------------------------------------------------------------
export type SkillSource = "custom" | "imported" | "ai_generated";
export type SkillStatus = "draft" | "active" | "disabled";

export type SkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  source: SkillSource;
  license: string;
  status: SkillStatus;
  created_at?: string | null;
  updated_at?: string | null;
};

export type Skill = SkillSummary & { content: string };

export type SkillInput = {
  name: string;
  slug?: string | null;
  description?: string;
  category?: string;
  content: string;
  version?: string;
  source?: SkillSource;
  license?: string;
  status?: SkillStatus;
};

export type SkillPatch = Partial<SkillInput>;

export type SkillParseResult = {
  name: string;
  slug: string;
  description: string;
  license: string;
  metadata: Record<string, string>;
  content: string;
};

export async function fetchSkills(params?: {
  search?: string;
  category?: string;
  status?: SkillStatus;
}): Promise<SkillSummary[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.category) query.set("category", params.category);
  if (params?.status) query.set("status", params.status);
  const suffix = query.toString();
  return apiFetch<SkillSummary[]>(`/skills${suffix ? `?${suffix}` : ""}`);
}

export async function fetchSkill(skillId: string): Promise<Skill> {
  return apiFetch<Skill>(`/skills/${encodeURIComponent(skillId)}`);
}

export async function createSkill(input: SkillInput): Promise<Skill> {
  return apiFetch<Skill>("/skills", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSkill(
  skillId: string,
  patch: SkillPatch,
): Promise<Skill> {
  return apiFetch<Skill>(`/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteSkill(skillId: string): Promise<void> {
  await apiFetch(`/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE",
  });
}

export async function parseSkillMd(
  raw: string,
  fallbackName = "",
): Promise<SkillParseResult> {
  return apiFetch<SkillParseResult>("/skills/parse", {
    method: "POST",
    body: JSON.stringify({ raw, fallback_name: fallbackName }),
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
  provider: string;
  by_model: { model: string; tokens: number }[];
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

// ---------------------------------------------------------------------------
// Vibe Coding workspace (idea -> discovery -> specs -> plan -> verification)
// ---------------------------------------------------------------------------
export type VibeArtifactKind =
  | "PRD"
  | "ARCHITECTURE"
  | "ACCEPTANCE_TEST_PLAN"
  | "UI_UX_SPEC"
  | "AGENT_INSTRUCTIONS"
  | "IMPLEMENTATION_PLAN"
  | "DEFINITION_OF_DONE";

export type VibeArtifactStatus = "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "STALE";

export type VibeDecisionStatus =
  | "CONFIRMED"
  | "ASSUMED"
  | "RESEARCH"
  | "NEEDS_DECISION"
  | "VALIDATION_REQUIRED";

export type VibeVerificationStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "NEEDS_REVIEW"
  | "DONE";

export type VibeStage = "discovery" | "specification" | "planning" | "verification";

export type VibeIdea = {
  idea: string;
  problem: string;
  target_users: string;
  constraints: string;
};

export type VibeSession = {
  id: string;
  project_id: string;
  title: string;
  raw_idea: Partial<VibeIdea>;
  stage: VibeStage;
  summary: string;
  created_at: string | null;
  updated_at: string | null;
};

export type VibeQuestion = {
  question: string;
  options: string[];
  recommended: string | null;
};

export type VibeMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: {
    questions?: VibeQuestion[];
    decision_ids?: string[];
  };
  created_at: string | null;
};

export type VibeDecision = {
  id: string;
  session_id: string;
  category: string;
  statement: string;
  status: VibeDecisionStatus;
  rationale: string;
  source: string;
  created_at: string | null;
  updated_at: string | null;
};

export type VibeArtifact = {
  id: string;
  session_id: string;
  project_id: string;
  kind: VibeArtifactKind;
  title: string;
  content: string;
  status: VibeArtifactStatus;
  version: number;
  generated_by: string;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VibeArtifactVersion = {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  status: VibeArtifactStatus;
  note: string;
  created_at: string | null;
};

export type VibeDiscoveryReply = {
  message: VibeMessage;
  decisions: VibeDecision[];
  questions: VibeQuestion[];
};

const vibePath = (projectId: string, sessionId?: string) =>
  `/projects/${projectId}/vibe/sessions${sessionId ? `/${sessionId}` : ""}`;

export async function listVibeSessions(projectId: string): Promise<VibeSession[]> {
  return apiFetch<VibeSession[]>(vibePath(projectId));
}

export async function createVibeSession(
  projectId: string,
  input: VibeIdea & { title?: string },
): Promise<VibeSession> {
  return apiFetch<VibeSession>(vibePath(projectId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getVibeSession(
  projectId: string,
  sessionId: string,
): Promise<VibeSession> {
  return apiFetch<VibeSession>(vibePath(projectId, sessionId));
}

export async function updateVibeSession(
  projectId: string,
  sessionId: string,
  patch: Partial<VibeIdea> & { title?: string; summary?: string; stage?: VibeStage },
): Promise<VibeSession> {
  return apiFetch<VibeSession>(vibePath(projectId, sessionId), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteVibeSession(
  projectId: string,
  sessionId: string,
): Promise<void> {
  await apiFetch<void>(vibePath(projectId, sessionId), { method: "DELETE" });
}

export async function listVibeMessages(
  projectId: string,
  sessionId: string,
): Promise<VibeMessage[]> {
  return apiFetch<VibeMessage[]>(`${vibePath(projectId, sessionId)}/messages`);
}

export async function sendVibeMessage(
  projectId: string,
  sessionId: string,
  content: string,
): Promise<VibeDiscoveryReply> {
  return apiFetch<VibeDiscoveryReply>(`${vibePath(projectId, sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function listVibeDecisions(
  projectId: string,
  sessionId: string,
): Promise<VibeDecision[]> {
  return apiFetch<VibeDecision[]>(`${vibePath(projectId, sessionId)}/decisions`);
}

export async function createVibeDecision(
  projectId: string,
  sessionId: string,
  input: {
    category: string;
    statement: string;
    status: VibeDecisionStatus;
    rationale?: string;
  },
): Promise<VibeDecision> {
  return apiFetch<VibeDecision>(`${vibePath(projectId, sessionId)}/decisions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateVibeDecision(
  projectId: string,
  sessionId: string,
  decisionId: string,
  patch: Partial<{
    category: string;
    statement: string;
    status: VibeDecisionStatus;
    rationale: string;
  }>,
): Promise<VibeDecision> {
  return apiFetch<VibeDecision>(
    `${vibePath(projectId, sessionId)}/decisions/${decisionId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export async function deleteVibeDecision(
  projectId: string,
  sessionId: string,
  decisionId: string,
): Promise<void> {
  await apiFetch<void>(`${vibePath(projectId, sessionId)}/decisions/${decisionId}`, {
    method: "DELETE",
  });
}

export async function listVibeArtifacts(
  projectId: string,
  sessionId: string,
): Promise<VibeArtifact[]> {
  return apiFetch<VibeArtifact[]>(`${vibePath(projectId, sessionId)}/artifacts`);
}

export async function getVibeArtifact(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
): Promise<VibeArtifact> {
  return apiFetch<VibeArtifact>(`${vibePath(projectId, sessionId)}/artifacts/${kind}`);
}

export async function generateVibeArtifact(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
  instructions = "",
): Promise<VibeArtifact> {
  return apiFetch<VibeArtifact>(
    `${vibePath(projectId, sessionId)}/artifacts/${kind}/generate`,
    { method: "POST", body: JSON.stringify({ instructions }) },
  );
}

export async function saveVibeArtifact(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
  content: string,
  note = "",
): Promise<VibeArtifact> {
  return apiFetch<VibeArtifact>(`${vibePath(projectId, sessionId)}/artifacts/${kind}`, {
    method: "PUT",
    body: JSON.stringify({ content, note }),
  });
}

export async function approveVibeArtifact(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
): Promise<VibeArtifact> {
  return apiFetch<VibeArtifact>(
    `${vibePath(projectId, sessionId)}/artifacts/${kind}/approve`,
    { method: "POST" },
  );
}

export async function markVibeArtifactStale(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
): Promise<VibeArtifact> {
  return apiFetch<VibeArtifact>(
    `${vibePath(projectId, sessionId)}/artifacts/${kind}/stale`,
    { method: "POST" },
  );
}

export async function listVibeArtifactVersions(
  projectId: string,
  sessionId: string,
  kind: VibeArtifactKind,
): Promise<VibeArtifactVersion[]> {
  return apiFetch<VibeArtifactVersion[]>(
    `${vibePath(projectId, sessionId)}/artifacts/${kind}/versions`,
  );
}

export async function listVibeTasks(
  projectId: string,
  sessionId: string,
): Promise<ProjectTask[]> {
  return apiFetch<ProjectTask[]>(`${vibePath(projectId, sessionId)}/tasks`);
}

export async function generateVibeTasks(
  projectId: string,
  sessionId: string,
  maxTasks = 8,
): Promise<ProjectTask[]> {
  return apiFetch<ProjectTask[]>(`${vibePath(projectId, sessionId)}/tasks/generate`, {
    method: "POST",
    body: JSON.stringify({ max_tasks: maxTasks }),
  });
}

export async function buildVibeTaskPrompt(
  projectId: string,
  sessionId: string,
  taskId: string,
): Promise<{ task_id: string; prompt: string }> {
  return apiFetch<{ task_id: string; prompt: string }>(
    `${vibePath(projectId, sessionId)}/tasks/${taskId}/prompt`,
    { method: "POST" },
  );
}

export async function updateVibeVerification(
  projectId: string,
  sessionId: string,
  taskId: string,
  input: { status: VibeVerificationStatus; evidence: string; notes: string },
): Promise<ProjectTask> {
  return apiFetch<ProjectTask>(
    `${vibePath(projectId, sessionId)}/tasks/${taskId}/verification`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

// ---------------------------------------------------------------------------
// LLM providers & models (Settings → Provider)
// ---------------------------------------------------------------------------
export type ProviderId = string;

export type Provider = {
  id: ProviderId;
  label: string;
  base_url: string;
  docs_url: string;
  notes: string;
  env_key: boolean;
  user_key: boolean;
  key_source: "user" | "env" | "none";
  key_masked: string;
  rich_metadata: boolean;
  active: boolean;
  selected_model: string;
  custom: boolean;
  active_image: boolean;
  selected_image_model: string;
};

export type ProviderModel = {
  id: string;
  name: string;
  context_window: number | null;
  modalities: string[];
  pricing: Record<string, number> | null;
  free: boolean;
  tags: string[];
};

export type ProviderModels = {
  provider: string;
  label: string;
  cached: boolean;
  count: number;
  models: ProviderModel[];
};

export type ProviderPing = {
  ok: boolean;
  status: number | null;
  latency_ms: number | null;
  detail: string;
};

export type ProviderRecommendation = {
  model: string;
  reason: string;
  free: boolean;
  tags: string[];
};

export type ProviderRecommendations = {
  provider: string;
  label: string;
  recommendations: ProviderRecommendation[];
};

export type ProviderQuota = {
  provider: string;
  model: string;
  minute_tokens: number;
  minute_limit: number;
  day_tokens: number;
  day_limit: number;
  day_reset_at: string | null;
  rate_limit: Record<string, string>;
};

export async function listProviders(): Promise<Provider[]> {
  return apiFetch<Provider[]>("/providers");
}

export async function createProvider(input: {
  label: string;
  base_url: string;
  api_key?: string;
  model?: string;
}): Promise<Provider> {
  return apiFetch<Provider>("/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteProvider(providerId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/providers/${encodeURIComponent(providerId)}`,
    { method: "DELETE" },
  );
}

export async function saveProviderKey(
  providerId: string,
  apiKey: string,
  model = "",
): Promise<Provider> {
  return apiFetch<Provider>(`/providers/${encodeURIComponent(providerId)}/key`, {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey, model }),
  });
}

export async function deleteProviderKey(providerId: string): Promise<Provider> {
  return apiFetch<Provider>(`/providers/${encodeURIComponent(providerId)}/key`, {
    method: "DELETE",
  });
}

export async function saveProviderSelection(
  providerId: string,
  model: string,
): Promise<Provider> {
  return apiFetch<Provider>("/providers/selection", {
    method: "PUT",
    body: JSON.stringify({ provider: providerId, model }),
  });
}

export async function listProviderModels(
  providerId: string,
  force = false,
): Promise<ProviderModels> {
  const suffix = force ? "?force=true" : "";
  return apiFetch<ProviderModels>(
    `/providers/${encodeURIComponent(providerId)}/models${suffix}`,
  );
}

export async function pingProvider(providerId: string): Promise<ProviderPing> {
  return apiFetch<ProviderPing>(
    `/providers/${encodeURIComponent(providerId)}/ping`,
    { method: "POST" },
  );
}

export async function fetchProviderRecommendations(
  providerId: string,
): Promise<ProviderRecommendations> {
  return apiFetch<ProviderRecommendations>(
    `/providers/${encodeURIComponent(providerId)}/recommendations`,
  );
}

export async function fetchProviderQuota(
  providerId: string,
): Promise<ProviderQuota> {
  return apiFetch<ProviderQuota>(
    `/providers/${encodeURIComponent(providerId)}/quota`,
  );
}

export async function saveProviderImageSelection(
  providerId: string,
  model: string,
): Promise<Provider> {
  return apiFetch<Provider>("/providers/image-selection", {
    method: "PUT",
    body: JSON.stringify({ provider: providerId, model }),
  });
}

// ---------------------------------------------------------------------------
// Image generation (OpenRouter-style Image API)
// ---------------------------------------------------------------------------
export type ImageCapabilityDescriptor =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" }
  | Record<string, unknown>;

export type ImageConfig = {
  provider: string;
  provider_label: string;
  model: string;
  key_ok: boolean;
  style: string;
  styles: ImageStyle[];
  aspect_ratios: string[];
  resolutions: string[];
  qualities: string[];
  output_formats: string[];
  backgrounds: string[];
  max_n: number;
  daily_limit: number;
};

export type ImageStyle = {
  id: string;
  label: string;
};

export type ImageModel = {
  id: string;
  name: string;
  capabilities: Record<string, ImageCapabilityDescriptor>;
  supports_streaming: boolean;
  input_modalities: string[];
  output_modalities: string[];
};

export type ImageModels = {
  provider: string;
  count: number;
  models: ImageModel[];
};

export type ImageResult = {
  data_url: string;
  media_type: string;
};

export type ImageGenerateResult = {
  provider: string;
  model: string;
  images: ImageResult[];
  usage: Record<string, unknown>;
};

export type ImageCredits = {
  available: boolean;
  total_credits: number | null;
  total_usage: number | null;
  remaining: number | null;
  detail: string;
};

export type ImageUsage = {
  day_images: number;
  day_cost: number;
  day_limit: number;
  day_reset_at: string | null;
};

export type ImageGenerateInput = {
  prompt: string;
  provider?: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  quality?: string;
  output_format?: string;
  background?: string;
  style?: string;
  output_compression?: number;
  seed?: number;
  steps?: number;
  input_references?: string[];
  provider_only?: string[];
  provider_order?: string[];
  provider_ignore?: string[];
  provider_sort?: string;
  provider_allow_fallbacks?: boolean;
  n?: number;
};

export type ImageEndpoint = {
  provider_name: string;
  provider_slug: string;
  provider_tag: string | null;
  supports_streaming: boolean;
  supported_parameters: Record<string, ImageCapabilityDescriptor>;
  pricing: Record<string, unknown>[];
};

export type ImageEndpoints = {
  provider: string;
  model: string;
  endpoints: ImageEndpoint[];
};

export type ImageStreamEvent =
  | { type: "partial"; data_url: string; index: number }
  | {
      type: "completed";
      provider: string;
      model: string;
      images: ImageResult[];
      usage: Record<string, unknown>;
    }
  | { type: "error"; detail: string; status: number | null };

export async function fetchImageConfig(): Promise<ImageConfig> {
  return apiFetch<ImageConfig>("/images/config");
}

export async function fetchImageModels(provider = ""): Promise<ImageModels> {
  const suffix = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return apiFetch<ImageModels>(`/images/models${suffix}`);
}

export async function fetchImageCredits(provider = ""): Promise<ImageCredits> {
  const suffix = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return apiFetch<ImageCredits>(`/images/credits${suffix}`);
}

export async function fetchImageEndpoints(
  model: string,
  provider = "",
): Promise<ImageEndpoints> {
  const params = new URLSearchParams();
  if (model) params.set("model", model);
  if (provider) params.set("provider", provider);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ImageEndpoints>(`/images/endpoints${suffix}`);
}

export async function fetchImageUsage(): Promise<ImageUsage> {
  return apiFetch<ImageUsage>("/images/usage");
}

export async function saveImageStyle(style: string): Promise<ImageStyle> {
  return apiFetch<ImageStyle>("/images/style", {
    method: "PUT",
    body: JSON.stringify({ style }),
  });
}

export async function generateImage(
  input: ImageGenerateInput,
): Promise<ImageGenerateResult> {
  return apiFetch<ImageGenerateResult>("/images/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Streamed image generation over SSE. Yields typed events. Falls back to a
 * single ``completed`` event when the model emits no partial previews, and an
 * ``error`` event (never throws) when the request itself fails.
 */
export async function* streamImageGeneration(
  input: ImageGenerateInput,
  signal?: AbortSignal,
): AsyncGenerator<ImageStreamEvent> {
  const response = await fetch(`${API_BASE}/images/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
    signal,
  });

  if (response.status === 401) {
    redirectToLogin();
    yield { type: "error", detail: "Sesi tidak valid. Silakan login ulang.", status: 401 };
    return;
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    yield {
      type: "error",
      detail: detail || `HTTP ${response.status}`,
      status: response.status,
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine) as ImageStreamEvent;
        if (parsed && typeof parsed.type === "string") yield parsed;
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}

