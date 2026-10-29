"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  FileCode2,
  GripVertical,
  Link2,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  Plus,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { Markdown } from "@/components/Markdown";
import {
  analyzeProjectHealth,
  askProjectRepo,
  clearProjectAsks,
  clearProjectRepo,
  createProjectDocument,
  createProjectTask,
  deleteProjectAsk,
  deleteProjectDocument,
  deleteProjectTask,
  getProject,
  getProjectFile,
  indexProjectRepo,
  listProjectAsks,
  listProjectConversations,
  listProjectDocuments,
  listProjectFiles,
  listProjectTasks,
  reorderProjectTasks,
  updateProject,
  updateProjectDocument,
  updateProjectTask,
  type Project,
  type ProjectAsk,
  type ProjectConversation,
  type ProjectDocument,
  type ProjectDocumentKind,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskPriority,
  type ProjectTaskStatus,
  type RepoFile,
  type RepoFileContent,
} from "@/lib/api";
import {
  PROJECT_INPUT_CLASS,
  PROJECT_LABEL_CLASS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  REPO_STATUS_LABELS,
} from "@/lib/projectMeta";

const STATUSES = PROJECT_STATUSES;
const STATUS_LABELS = PROJECT_STATUS_LABELS;

const PRIORITIES: ProjectTaskPriority[] = ["low", "medium", "high"];

const TASK_COLUMNS: { status: ProjectTaskStatus; label: string }[] = [
  { status: "todo", label: "Todo" },
  { status: "doing", label: "Doing" },
  { status: "done", label: "Selesai" },
];

const PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
};

const PRIORITY_CLASSES: Record<ProjectTaskPriority, string> = {
  low: "border-border text-muted",
  medium: "border-sky-500/40 text-sky-500",
  high: "border-amber-500/50 text-amber-500",
};

function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    status: "idea" as ProjectStatus,
    tech_stack: "",
    repo_url: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const [repoBusy, setRepoBusy] = useState(false);

  // Saved Q&A history for the right sidebar.
  const [asks, setAsks] = useState<ProjectAsk[]>([]);
  const [asksLoading, setAsksLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  // Project tasks.
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState<ProjectTaskPriority>("medium");
  const [addingTask, setAddingTask] = useState(false);
  const [taskBusy, setTaskBusy] = useState<Record<string, boolean>>({});

  // AI health analysis.
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Chat threads linked to this project via @mention.
  const [conversations, setConversations] = useState<ProjectConversation[]>([]);

  // Non-repo project data: notes/pasted text and links.
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState<Record<string, boolean>>({});
  const [savingDoc, setSavingDoc] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState<{
    title: string;
    kind: ProjectDocumentKind;
    url: string;
    content: string;
  }>({ title: "", kind: "note", url: "", content: "" });

  // Focus mode: hide the detail column so "Tanya repo" gets the whole width.
  const [chatFocused, setChatFocused] = useState(false);

  const [files, setFiles] = useState<RepoFile[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [openFile, setOpenFile] = useState<RepoFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const askEndRef = useRef<HTMLDivElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  const applyProject = useCallback((data: Project) => {
    setProject(data);
    setDraft({
      name: data.name,
      description: data.description,
      status: data.status,
      tech_stack: data.tech_stack.join(", "),
      repo_url: data.repo_url ?? "",
      notes: data.notes,
    });
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await getProject(id);
        if (silent) {
          setProject(data);
        } else {
          applyProject(data);
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Gagal memuat proyek.");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id, applyProject],
  );

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  // Silent poll while the repo is queued/indexing.
  const indexing =
    project?.repo_index_status === "pending" ||
    project?.repo_index_status === "indexing";
  useEffect(() => {
    if (!indexing) return;
    const timer = setInterval(() => void load(true), 3000);
    return () => clearInterval(timer);
  }, [indexing, load]);

  const loadAsks = useCallback(async () => {
    setAsksLoading(true);
    try {
      const data = await listProjectAsks(id);
      setAsks(data ?? []);
    } catch {
      // History is non-critical; the ask box still works.
    } finally {
      setAsksLoading(false);
    }
  }, [id]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const data = await listProjectTasks(id);
      setTasks(data ?? []);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [id]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await listProjectConversations(id);
      setConversations(data ?? []);
    } catch {
      // Linked chats are non-critical.
    }
  }, [id]);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const data = await listProjectDocuments(id);
      setDocuments(data ?? []);
    } catch {
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void loadAsks();
    void loadTasks();
    void loadConversations();
    void loadDocuments();
  }, [id, loadAsks, loadTasks, loadConversations, loadDocuments]);

  // While the AI summary is stale, poll until the background refresh lands.
  const healthStale = project?.health_stale ?? false;
  useEffect(() => {
    if (!healthStale) return;
    const timer = setInterval(() => void load(true), 4000);
    return () => clearInterval(timer);
  }, [healthStale, load]);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const data = await listProjectFiles(id);
      setFiles(data ?? []);
      setFilesLoaded(true);
    } catch {
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [id]);

  // File list loads once the repo becomes ready.
  useEffect(() => {
    if (project?.repo_index_status === "ready" && !filesLoaded) {
      void loadFiles();
    }
  }, [project?.repo_index_status, filesLoaded, loadFiles]);

  useEffect(() => {
    askEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [asks, pendingQuestion]);

  async function saveEdits(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject(id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        status: draft.status,
        tech_stack: draft.tech_stack
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        repo_url: draft.repo_url.trim() || null,
        notes: draft.notes.trim(),
      });
      applyProject(updated);
      setEditing(false);
      // A new repo URL invalidates the index; drop cached files.
      setFiles([]);
      setFilesLoaded(false);
      setOpenFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan proyek.");
    } finally {
      setSaving(false);
    }
  }

  async function runIndex() {
    setRepoBusy(true);
    setError(null);
    try {
      const updated = await indexProjectRepo(id);
      setProject(updated);
      setFiles([]);
      setFilesLoaded(false);
      setOpenFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memulai indeks repo.");
    } finally {
      setRepoBusy(false);
    }
  }

  async function runClear() {
    const confirmed = window.confirm(
      "Hapus hasil index repo ini?\n\nChunk kode yang tersimpan akan dihapus.",
    );
    if (!confirmed) return;
    setRepoBusy(true);
    try {
      const updated = await clearProjectRepo(id);
      setProject(updated);
      setFiles([]);
      setFilesLoaded(false);
      setOpenFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus index repo.");
    } finally {
      setRepoBusy(false);
    }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || pendingQuestion) return;
    setQuestion("");
    setAskError(null);
    setPendingQuestion(text);
    try {
      await askProjectRepo(id, text);
    } catch (err) {
      // Keep the typed question so the user can retry instead of retyping.
      setAskError(err instanceof Error ? err.message : "Gagal menjawab.");
      setQuestion(text);
    } finally {
      // The backend persists both successful and failed turns.
      await loadAsks();
      setPendingQuestion(null);
    }
  }

  async function removeAsk(askId: string) {
    try {
      await deleteProjectAsk(id, askId);
      setAsks((prev) => prev.filter((item) => item.id !== askId));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Gagal menghapus riwayat.");
    }
  }

  async function clearAsks() {
    if (!window.confirm("Hapus semua riwayat tanya repo ini?")) return;
    try {
      await clearProjectAsks(id);
      setAsks([]);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Gagal membersihkan riwayat.");
    }
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    const title = newTask.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    setTaskError(null);
    try {
      const task = await createProjectTask(id, {
        title,
        priority: newPriority,
      });
      setTasks((prev) => [...prev, task]);
      setNewTask("");
      setNewPriority("medium");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Gagal menambah tugas.");
    } finally {
      setAddingTask(false);
    }
  }

  async function toggleTask(task: ProjectTask) {
    const next = task.status === "done" ? "todo" : "done";
    setTaskBusy((prev) => ({ ...prev, [task.id]: true }));
    setTaskError(null);
    setTasks((prev) =>
      prev.map((item) =>
        item.id === task.id ? { ...item, status: next } : item,
      ),
    );
    try {
      const updated = await updateProjectTask(id, task.id, { status: next });
      setTasks((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id ? { ...item, status: task.status } : item,
        ),
      );
      setTaskError(err instanceof Error ? err.message : "Gagal memperbarui tugas.");
    } finally {
      setTaskBusy((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  async function removeTask(task: ProjectTask) {
    setTaskBusy((prev) => ({ ...prev, [task.id]: true }));
    try {
      await deleteProjectTask(id, task.id);
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Gagal menghapus tugas.");
    } finally {
      setTaskBusy((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  async function reorderTasks(
    items: { id: string; status: ProjectTaskStatus; position: number }[],
  ) {
    const previous = tasks;
    const byId = new Map(items.map((item) => [item.id, item]));
    setTasks((prev) =>
      prev.map((task) => {
        const item = byId.get(task.id);
        return item
          ? { ...task, status: item.status, position: item.position }
          : task;
      }),
    );
    setTaskError(null);
    try {
      const updated = await reorderProjectTasks(id, items);
      if (updated?.length) setTasks(updated);
    } catch (err) {
      setTasks(previous);
      setTaskError(
        err instanceof Error ? err.message : "Gagal memindahkan tugas.",
      );
    }
  }

  async function regenerateHealth() {
    setHealthBusy(true);
    setHealthError(null);
    try {
      const updated = await analyzeProjectHealth(id);
      setProject(updated);
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : "Gagal menganalisa kesehatan proyek.",
      );
    } finally {
      setHealthBusy(false);
    }
  }

  function resetDocDraft() {
    setEditingDocId(null);
    setDocDraft({ title: "", kind: "note", url: "", content: "" });
  }

  function startEditDocument(document: ProjectDocument) {
    setEditingDocId(document.id);
    setDocError(null);
    setDocDraft({
      title: document.title,
      kind: document.kind,
      url: document.url ?? "",
      content: document.content,
    });
  }

  async function submitDocument(event: React.FormEvent) {
    event.preventDefault();
    if (savingDoc) return;
    const title = docDraft.title.trim();
    const url = docDraft.url.trim();
    const content = docDraft.content.trim();
    const valid = docDraft.kind === "link" ? Boolean(url) : Boolean(title || content);
    if (!valid) return;
    setSavingDoc(true);
    setDocError(null);
    try {
      if (editingDocId) {
        const updated = await updateProjectDocument(id, editingDocId, {
          title,
          kind: docDraft.kind,
          url: url || null,
          content,
        });
        setDocuments((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        const created = await createProjectDocument(id, {
          title,
          kind: docDraft.kind,
          url: url || null,
          content,
        });
        setDocuments((prev) => [created, ...prev]);
      }
      resetDocDraft();
    } catch (err) {
      setDocError(
        err instanceof Error ? err.message : "Gagal menyimpan data proyek.",
      );
    } finally {
      setSavingDoc(false);
    }
  }

  async function removeDocument(document: ProjectDocument) {
    setDocBusy((prev) => ({ ...prev, [document.id]: true }));
    setDocError(null);
    try {
      await deleteProjectDocument(id, document.id);
      setDocuments((prev) => prev.filter((item) => item.id !== document.id));
      if (editingDocId === document.id) resetDocDraft();
    } catch (err) {
      setDocError(
        err instanceof Error ? err.message : "Gagal menghapus data proyek.",
      );
    } finally {
      setDocBusy((prev) => ({ ...prev, [document.id]: false }));
    }
  }

  function handleDocFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setDocDraft((prev) => ({
        ...prev,
        title: prev.title || file.name,
        content: String(reader.result ?? ""),
      }));
    };
    reader.readAsText(file);
  }

  async function viewFile(path: string) {
    setFileLoading(true);
    setOpenFile(null);
    try {
      const content = await getProjectFile(id, path);
      setOpenFile(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat file.");
    } finally {
      setFileLoading(false);
    }
  }

  const inputClass = PROJECT_INPUT_CLASS;
  const labelClass = PROJECT_LABEL_CLASS;

  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  const repoReady = project?.repo_index_status === "ready";

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-16 lg:px-8">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
          >
            <ChevronLeft size={14} aria-hidden />
            Proyek
          </Link>

          {loading ? (
            <LoadingState label="Memuat detail proyek..." variant="detail" rows={6} className="mt-6" />
          ) : !project ? (
            <p className="mt-6 text-[13px] text-danger">
              {error ?? "Proyek tidak ditemukan."}
            </p>
          ) : (
            <div
              className={`mt-3 grid grid-cols-1 gap-6 ${
                chatFocused ? "" : "xl:grid-cols-[minmax(0,1fr)_22rem]"
              }`}
            >
              {/* -------------------------------------------------- main column */}
              {!chatFocused && (
              <div className="min-w-0 space-y-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-semibold tracking-tight">
                        {project.name}
                      </h1>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                        {STATUS_LABELS[project.status]}
                      </span>
                      {openTasks.length > 0 && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                          {openTasks.length} tugas terbuka
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/90">
                        {project.description}
                      </p>
                    )}
                    {project.tech_stack.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {project.tech_stack.map((tech) => (
                          <span
                            key={tech}
                            className="rounded-md bg-surface-muted px-2 py-0.5 text-[11px] text-muted"
                          >
                            {tech}
                          </span>
                        ))}
                      </div>
                    )}
                    {project.repo_url && (
                      <a
                        href={project.repo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[12px] text-foreground underline underline-offset-2"
                      >
                        {project.repo_full_name ?? project.repo_url}
                        <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing((value) => !value)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                  >
                    {editing ? <X size={14} aria-hidden /> : null}
                    {editing ? "Tutup" : "Ubah"}
                  </button>
                </div>

                {editing && (
                  <form
                    onSubmit={saveEdits}
                    className="space-y-3 rounded-lg border border-border bg-surface p-3"
                  >
                    <div>
                      <label className={labelClass}>Nama proyek</label>
                      <input
                        value={draft.name}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, name: event.target.value }))
                        }
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Status</label>
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              status: event.target.value as ProjectStatus,
                            }))
                          }
                          className={`mt-1 ${inputClass}`}
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Tech stack (pisah koma)</label>
                        <input
                          value={draft.tech_stack}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              tech_stack: event.target.value,
                            }))
                          }
                          className={`mt-1 ${inputClass}`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>URL repo (opsional)</label>
                      <input
                        value={draft.repo_url}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, repo_url: event.target.value }))
                        }
                        placeholder="https://github.com/..."
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Deskripsi</label>
                      <textarea
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            description: event.target.value,
                          }))
                        }
                        rows={2}
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Catatan / keputusan teknis</label>
                      <textarea
                        value={draft.notes}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        rows={4}
                        className={`mt-1 ${inputClass}`}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      {saving ? "Menyimpan..." : "Simpan"}
                    </button>
                  </form>
                )}

                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
                  >
                    {error}
                  </p>
                )}

                {project.notes && !editing && (
                  <section>
                    <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                      Catatan
                    </h2>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/90">
                      {project.notes}
                    </p>
                  </section>
                )}

                {/* ---------------------------------------------- AI health */}
                <CollapsibleSection
                  title="Kesehatan proyek"
                  subtitle={
                    project.health_stale ? (
                      <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-500">
                        {project.health_generated_at
                          ? "memperbarui ringkasan..."
                          : "menganalisa..."}
                      </span>
                    ) : project.health_generated_at ? (
                      <span className="text-[11px] text-muted">
                        diperbarui {formatWhen(project.health_generated_at)}
                      </span>
                    ) : null
                  }
                  actions={
                    <button
                      type="button"
                      disabled={healthBusy}
                      onClick={() => void regenerateHealth()}
                      className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      {healthBusy
                        ? "Menganalisa..."
                        : project.health_summary
                          ? "Perbarui analisa"
                          : "Analisa proyek"}
                    </button>
                  }
                >
                  {healthError && (
                    <p role="alert" className="text-[12px] text-danger">
                      {healthError}
                    </p>
                  )}

                  {project.health_summary ? (
                    <Markdown content={project.health_summary} />
                  ) : (
                    <p className="text-[12px] text-muted">
                      Belum ada analisa. Klik “Analisa proyek” untuk melihat
                      kekuatan, risiko, dan langkah berikutnya berdasarkan
                      deskripsi, catatan, repo, dan tugas.
                    </p>
                  )}
                </CollapsibleSection>

                {/* --------------------------------------------------- tasks */}
                <CollapsibleSection
                  title="Tugas"
                  subtitle={
                    <span className="text-[11px] text-muted">
                      {openTasks.length} terbuka · {doneTasks.length} selesai
                    </span>
                  }
                >
                  <form onSubmit={addTask} className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newTask}
                      onChange={(event) => setNewTask(event.target.value)}
                      placeholder="Tambah tugas baru..."
                      className={`flex-1 ${inputClass}`}
                    />
                    <select
                      value={newPriority}
                      onChange={(event) =>
                        setNewPriority(event.target.value as ProjectTaskPriority)
                      }
                      className="h-[38px] shrink-0 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none"
                    >
                      {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={addingTask || !newTask.trim()}
                      className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                    >
                      <Plus size={14} aria-hidden />
                      Tambah
                    </button>
                  </form>

                  {taskError && (
                    <p role="alert" className="mt-2 text-[12px] text-danger">
                      {taskError}
                    </p>
                  )}

                  {tasksLoading ? (
                    <LoadingState label="Memuat tugas..." variant="inline" className="mt-3" />
                  ) : (
                    <div className="mt-3">
                      {tasks.length === 0 && (
                        <p className="mb-2 text-[12px] text-muted">
                          Belum ada tugas. Tambah lewat form di atas, lalu tarik
                          kartu antar kolom Todo / Doing / Selesai.
                        </p>
                      )}
                      <TaskBoard
                        tasks={tasks}
                        busy={taskBusy}
                        onToggle={(task) => void toggleTask(task)}
                        onDelete={(task) => void removeTask(task)}
                        onReorder={(items) => void reorderTasks(items)}
                      />
                    </div>
                  )}
                </CollapsibleSection>

                {/* ---------------------------------------- non-repo data */}
                <CollapsibleSection
                  title="Data proyek (non-repo)"
                  subtitle={
                    <span className="text-[11px] text-muted">
                      ({documents.length}) · ikut ke ringkasan AI
                    </span>
                  }
                >
                  <form onSubmit={submitDocument} className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={docDraft.title}
                        onChange={(event) =>
                          setDocDraft((prev) => ({ ...prev, title: event.target.value }))
                        }
                        placeholder="Judul (mis. Spesifikasi API, Notulen rapat)"
                        className={`flex-1 ${inputClass}`}
                      />
                      <select
                        value={docDraft.kind}
                        onChange={(event) =>
                          setDocDraft((prev) => ({
                            ...prev,
                            kind: event.target.value as ProjectDocumentKind,
                          }))
                        }
                        className="h-[38px] shrink-0 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none"
                      >
                        <option value="note">Catatan/teks</option>
                        <option value="link">Tautan</option>
                      </select>
                    </div>

                    {docDraft.kind === "link" ? (
                      <input
                        value={docDraft.url}
                        onChange={(event) =>
                          setDocDraft((prev) => ({ ...prev, url: event.target.value }))
                        }
                        placeholder="https://..."
                        className={`w-full ${inputClass}`}
                      />
                    ) : (
                      <>
                        <textarea
                          value={docDraft.content}
                          onChange={(event) =>
                            setDocDraft((prev) => ({
                              ...prev,
                              content: event.target.value,
                            }))
                          }
                          rows={4}
                          placeholder={
                            editingDocId
                              ? "Isi catatan..."
                              : "Tempel teks di sini, atau unggah .txt/.md di bawah."
                          }
                          className={`w-full ${inputClass}`}
                        />
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted">
                          <FileCode2 size={13} aria-hidden />
                          Unggah teks
                          <input
                            ref={docFileInputRef}
                            type="file"
                            accept=".txt,.md,.markdown,.csv,.json,.log,text/plain,text/markdown"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) handleDocFile(file);
                              if (docFileInputRef.current) {
                                docFileInputRef.current.value = "";
                              }
                            }}
                          />
                        </label>
                      </>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={
                          savingDoc ||
                          (docDraft.kind === "link"
                            ? !docDraft.url.trim()
                            : !docDraft.title.trim() && !docDraft.content.trim())
                        }
                        className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                      >
                        <Plus size={14} aria-hidden />
                        {editingDocId ? "Simpan perubahan" : "Tambah"}
                      </button>
                      {editingDocId && (
                        <button
                          type="button"
                          onClick={resetDocDraft}
                          className="inline-flex h-[38px] items-center rounded-lg border border-border px-3 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
                        >
                          Batal
                        </button>
                      )}
                      {editingDocId && (
                        <span className="text-[11px] text-muted">
                          mengedit dokumen terpilih
                        </span>
                      )}
                    </div>
                  </form>

                  {docError && (
                    <p role="alert" className="mt-2 text-[12px] text-danger">
                      {docError}
                    </p>
                  )}

                  {documentsLoading ? (
                    <LoadingState label="Memuat data..." variant="inline" className="mt-3" />
                  ) : documents.length === 0 ? (
                    <p className="mt-3 text-[12px] text-muted">
                      Belum ada data non-repo. Tambahkan spesifikasi, notulen,
                      keputusan, atau tautan penting agar masuk ke ringkasan AI dan
                      konteks chat (@mention).
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {documents.map((document) => (
                        <li
                          key={document.id}
                          className="rounded-lg border border-border px-3 py-2"
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-muted">
                              {document.kind === "link" ? (
                                <Link2 size={14} aria-hidden />
                              ) : (
                                <StickyNote size={14} aria-hidden />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-foreground">
                                {document.title || "(tanpa judul)"}
                              </p>
                              {document.kind === "link" ? (
                                document.url ? (
                                  <a
                                    href={document.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="break-all text-[12px] text-foreground underline underline-offset-2"
                                  >
                                    {document.url}
                                  </a>
                                ) : null
                              ) : (
                                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[12px] text-muted">
                                  {document.content}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => startEditDocument(document)}
                                className="inline-flex h-6 items-center rounded-md px-2 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                aria-label="Hapus data"
                                title="Hapus"
                                disabled={Boolean(docBusy[document.id])}
                                onClick={() => void removeDocument(document)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger disabled:opacity-40"
                              >
                                <Trash2 size={12} aria-hidden />
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleSection>

                {/* ------------------------------------------ linked chats */}
                <CollapsibleSection
                  title="Chat terkait"
                  subtitle={
                    <span className="text-[11px] text-muted">
                      ({conversations.length})
                    </span>
                  }
                >
                  {conversations.length === 0 ? (
                    <p className="text-[12px] text-muted">
                      Belum ada chat yang merujuk proyek ini. Di halaman Chat,
                      ketik <span className="font-mono">@</span> lalu pilih
                      &ldquo;{project.name}&rdquo; agar percakapan tertaut ke sini.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {conversations.map((conversation) => (
                        <li key={conversation.conversation_id}>
                          <Link
                            href={`/chat/${conversation.conversation_id}`}
                            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12px] transition-colors duration-150 hover:bg-surface-muted"
                          >
                            <MessagesSquare
                              size={13}
                              className="shrink-0 text-muted"
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-foreground">
                              {conversation.title ?? "Percakapan"}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">
                              {conversation.message_count} pesan ·{" "}
                              {formatWhen(
                                conversation.last_message_at ??
                                  conversation.created_at,
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleSection>

                {/* -------------------------------------------- repo analysis */}
                {project.repo_url && (
                  <CollapsibleSection
                    title="Analisa repo"
                    subtitle={
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                        {REPO_STATUS_LABELS[project.repo_index_status]}
                      </span>
                    }
                    actions={
                      <>
                        <button
                          type="button"
                          disabled={repoBusy || indexing}
                          onClick={() => void runIndex()}
                          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
                        >
                          {project.repo_index_status === "ready"
                            ? "Index ulang"
                            : "Index repo"}
                        </button>
                        {project.repo_index_status !== "none" && (
                          <button
                            type="button"
                            disabled={repoBusy}
                            onClick={() => void runClear()}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 size={13} aria-hidden />
                            Hapus
                          </button>
                        )}
                      </>
                    }
                  >
                    {indexing && (
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-muted">
                          <span>{project.repo_index_stage ?? "mengindeks"}</span>
                          <span>{project.repo_index_progress}%</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full rounded-full bg-foreground transition-[width] duration-500"
                            style={{ width: `${project.repo_index_progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {project.repo_index_status === "ready" && (
                      <p className="mt-2 text-[11px] text-muted">
                        {project.repo_file_count} file · {project.repo_chunk_count} chunk
                        {project.repo_branch ? ` · branch ${project.repo_branch}` : ""}
                        {project.repo_indexed_at
                          ? ` · ${formatWhen(project.repo_indexed_at)}`
                          : ""}
                      </p>
                    )}

                    {project.repo_index_error && (
                      <p
                        role="alert"
                        className="mt-2 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
                      >
                        {project.repo_index_error}
                      </p>
                    )}

                    {project.repo_summary && (
                      <div className="mt-2 border-t border-border pt-3">
                        <Markdown content={project.repo_summary} />
                      </div>
                    )}
                  </CollapsibleSection>
                )}

                {/* ------------------------------------------------ file tree */}
                {repoReady && (
                  <CollapsibleSection
                    title="File ter-index"
                    subtitle={
                      <span className="text-[11px] text-muted">({files.length})</span>
                    }
                  >
                    {filesLoading ? (
                      <LoadingState label="Memuat file..." variant="inline" />
                    ) : files.length === 0 ? (
                      <p className="text-[12px] text-muted">Belum ada file.</p>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <ul className="max-h-80 overflow-y-auto rounded-lg border border-border">
                          {files.map((file) => (
                            <li key={file.path}>
                              <button
                                type="button"
                                onClick={() => void viewFile(file.path)}
                                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-surface-muted ${
                                  openFile?.path === file.path ? "bg-surface-muted" : ""
                                }`}
                              >
                                <FileCode2
                                  size={13}
                                  className="shrink-0 text-muted"
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate font-mono">
                                  {file.path}
                                </span>
                                <span className="shrink-0 text-[11px] text-muted">
                                  {file.chunk_count}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>

                        <div className="min-h-40 rounded-lg border border-border">
                          {fileLoading ? (
                            <LoadingState label="Memuat file..." variant="inline" className="p-3" />
                          ) : openFile ? (
                            <>
                              <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                                <span className="truncate font-mono text-[11px] text-muted">
                                  {openFile.path}
                                </span>
                                <span className="shrink-0 text-[11px] text-muted">
                                  {openFile.language}
                                </span>
                              </div>
                              <pre className="max-h-72 overflow-auto p-3">
                                <code className="font-mono text-[12px] leading-relaxed">
                                  {openFile.content}
                                </code>
                              </pre>
                            </>
                          ) : (
                            <p className="p-3 text-[12px] text-muted">
                              Pilih file untuk melihat isinya.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CollapsibleSection>
                )}
              </div>
              )}

              {/* ------------------------------------------- right: saved chat */}
              <aside
                className={
                  chatFocused
                    ? "min-w-0"
                    : "order-first min-w-0 xl:order-none xl:sticky xl:top-4 xl:self-start"
                }
              >
                <section
                  className={`flex flex-col rounded-lg border border-border bg-surface p-3 ${
                    chatFocused
                      ? "h-[calc(100vh-9rem)]"
                      : "max-h-[70vh] xl:max-h-[calc(100vh-7rem)]"
                  }`}
                >
                  <div className="-mx-3 -mt-3 mb-3 flex flex-wrap items-center gap-2 rounded-t-lg border-b border-border bg-surface-muted/70 px-3 py-2">
                    <MessageSquare size={14} className="shrink-0 text-primary" aria-hidden />
                    <h2 className="text-[13px] font-semibold uppercase tracking-wide text-foreground">
                      Tanya repo
                    </h2>
                    <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                      {REPO_STATUS_LABELS[project.repo_index_status]}
                    </span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setChatFocused((value) => !value)}
                      aria-label={
                        chatFocused ? "Kecilkan panel tanya" : "Perbesar panel tanya"
                      }
                      title={
                        chatFocused ? "Kecilkan panel tanya" : "Perbesar panel tanya"
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground"
                    >
                      {chatFocused ? (
                        <>
                          <Minimize2 size={13} aria-hidden />
                          Kecilkan
                        </>
                      ) : (
                        <>
                          <Maximize2 size={13} aria-hidden />
                          Perbesar
                        </>
                      )}
                    </button>
                    {asks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void clearAsks()}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted transition-colors duration-150 hover:bg-surface hover:text-danger"
                      >
                        <Trash2 size={12} aria-hidden />
                        Bersihkan
                      </button>
                    )}
                  </div>

                  <p className="mb-1 text-[11px] text-muted">
                    Riwayat pertanyaan tersimpan otomatis.
                  </p>

                  <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                    {asksLoading && asks.length === 0 ? (
                      <LoadingState label="Memuat riwayat..." variant="inline" />
                    ) : asks.length === 0 && !pendingQuestion ? (
                      <p className="text-[12px] text-muted">
                        {repoReady
                          ? "Belum ada pertanyaan. Tanyakan struktur, alur, atau bagian kode tertentu."
                          : "Index repo dulu supaya Axtra bisa menjawab berdasarkan kode."}
                      </p>
                    ) : (
                      asks.map((turn) => (
                        <div key={turn.id} className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 text-[13px] font-medium">
                              {turn.question}
                            </p>
                            <span className="shrink-0 text-[11px] text-muted">
                              {formatWhen(turn.created_at)}
                            </span>
                            <button
                              type="button"
                              aria-label="Hapus pertanyaan"
                              onClick={() => void removeAsk(turn.id)}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-danger"
                            >
                              <Trash2 size={12} aria-hidden />
                            </button>
                          </div>

                          {turn.error ? (
                            <p role="alert" className="text-[12px] text-danger">
                              {turn.error}
                            </p>
                          ) : (
                            <div className="rounded-lg border border-border px-3 py-2">
                              <Markdown content={turn.answer} />
                              {turn.sources.length > 0 && (
                                <div className="mt-3 border-t border-border pt-2">
                                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
                                    Sumber
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {turn.sources.map((source, sourceIndex) => (
                                      <button
                                        key={`${turn.id}-${source.path}-${sourceIndex}`}
                                        type="button"
                                        onClick={() => void viewFile(source.path)}
                                        title={source.path}
                                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-primary/50 hover:text-foreground"
                                      >
                                        <FileCode2 size={11} className="shrink-0" aria-hidden />
                                        <span className="truncate">{source.path}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}

                    {pendingQuestion && (
                      <div className="space-y-1.5">
                        <p className="text-[13px] font-medium">{pendingQuestion}</p>
                        <p className="text-[12px] text-muted">Berpikir...</p>
                      </div>
                    )}

                    <div ref={askEndRef} />
                  </div>

                  {askError && (
                    <p role="alert" className="mt-2 text-[12px] text-danger">
                      {askError}
                    </p>
                  )}

                  <form onSubmit={ask} className="mt-3 flex shrink-0 gap-2">
                    <input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder={
                        repoReady ? "Tanya soal kode repo ini..." : "Index repo dulu..."
                      }
                      disabled={!repoReady || Boolean(pendingQuestion)}
                      className={`flex-1 ${inputClass} disabled:opacity-50`}
                    />
                    <button
                      type="submit"
                      disabled={!repoReady || Boolean(pendingQuestion) || !question.trim()}
                      aria-label="Kirim pertanyaan"
                      className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                    >
                      <Send size={15} aria-hidden />
                    </button>
                  </form>
                </section>
              </aside>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function groupTasks(
  tasks: ProjectTask[],
): Record<ProjectTaskStatus, ProjectTask[]> {
  const groups: Record<ProjectTaskStatus, ProjectTask[]> = {
    todo: [],
    doing: [],
    done: [],
  };
  for (const task of tasks) {
    (groups[task.status] ?? groups.todo).push(task);
  }
  for (const key of Object.keys(groups) as ProjectTaskStatus[]) {
    groups[key].sort(
      (a, b) =>
        a.position - b.position ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
  }
  return groups;
}

function TaskCard({
  task,
  busy,
  onToggle,
  onDelete,
  onStatusChange,
}: {
  task: ProjectTask;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onStatusChange: (status: ProjectTaskStatus) => void;
}) {
  const done = task.status === "done";
  return (
    <div className="group flex items-start gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 transition-colors duration-150 hover:border-foreground/25">
      <span
        className="mt-0.5 shrink-0 cursor-grab text-muted active:cursor-grabbing"
        aria-hidden
      >
        <GripVertical size={13} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={done ? "Tandai belum selesai" : "Tandai selesai"}
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 disabled:opacity-40 ${
          done
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
            : "border-border text-transparent hover:border-foreground/40"
        }`}
      >
        <Check size={13} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[13px] leading-snug ${
            done ? "text-muted line-through" : "text-foreground"
          }`}
        >
          {task.title}
        </p>
        {task.detail && !done && (
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted">
            {task.detail}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${PRIORITY_CLASSES[task.priority]}`}
          >
            {PRIORITY_LABELS[task.priority]}
          </span>
          <select
            value={task.status}
            disabled={busy}
            onChange={(event) =>
              onStatusChange(event.target.value as ProjectTaskStatus)
            }
            aria-label="Ubah status tugas"
            className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-muted outline-none disabled:opacity-40"
          >
            {TASK_COLUMNS.map(({ status, label }) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Hapus tugas"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-150 hover:bg-surface-muted hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}

function TaskBoard({
  tasks,
  busy,
  onToggle,
  onDelete,
  onReorder,
}: {
  tasks: ProjectTask[];
  busy: Record<string, boolean>;
  onToggle: (task: ProjectTask) => void;
  onDelete: (task: ProjectTask) => void;
  onReorder: (
    items: { id: string; status: ProjectTaskStatus; position: number }[],
  ) => void;
}) {
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{
    status: ProjectTaskStatus;
    beforeId: string | null;
  } | null>(null);

  function handleDrop(status: ProjectTaskStatus, beforeId: string | null) {
    setOver(null);
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId) return;

    const working = groupTasks(tasks);
    const fromStatus = (Object.keys(working) as ProjectTaskStatus[]).find((key) =>
      working[key].some((task) => task.id === draggedId),
    );
    if (!fromStatus) return;
    const dragged = working[fromStatus].find((task) => task.id === draggedId);
    if (!dragged) return;

    working[fromStatus] = working[fromStatus].filter(
      (task) => task.id !== draggedId,
    );
    const target = working[status];
    let index = beforeId ? target.findIndex((task) => task.id === beforeId) : -1;
    if (index < 0) index = target.length;
    target.splice(index, 0, { ...dragged, status });

    const items: { id: string; status: ProjectTaskStatus; position: number }[] =
      [];
    for (const key of Object.keys(working) as ProjectTaskStatus[]) {
      working[key].forEach((task, position) => {
        items.push({ id: task.id, status: key, position });
      });
    }
    onReorder(items);
  }

  function moveToStatus(task: ProjectTask, status: ProjectTaskStatus) {
    if (task.status === status) return;
    const working = groupTasks(tasks);
    working[task.status] = working[task.status].filter(
      (item) => item.id !== task.id,
    );
    working[status] = [...working[status], { ...task, status }];
    const items: { id: string; status: ProjectTaskStatus; position: number }[] =
      [];
    for (const key of Object.keys(working) as ProjectTaskStatus[]) {
      working[key].forEach((entry, position) => {
        items.push({ id: entry.id, status: key, position });
      });
    }
    onReorder(items);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TASK_COLUMNS.map(({ status, label }) => {
        const columnTasks = groups[status];
        const columnActive = over?.status === status && over.beforeId === null;
        return (
          <div
            key={status}
            onDragOver={(event) => {
              event.preventDefault();
              setOver((prev) =>
                prev?.status === status && prev.beforeId === null
                  ? prev
                  : { status, beforeId: null },
              );
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleDrop(status, null);
            }}
            className={`flex min-h-[140px] flex-col rounded-lg border p-2 transition-colors duration-150 ${
              columnActive ? "border-primary/60 bg-surface-muted/60" : "border-border"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {label}
              </span>
              <span className="text-[11px] text-muted">{columnTasks.length}</span>
            </div>

            <ul className="flex-1 space-y-1.5">
              {columnTasks.map((task) => (
                <li
                  key={task.id}
                  draggable
                  onDragStart={(event) => {
                    setDragId(task.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", task.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOver((prev) =>
                      prev?.status === status && prev.beforeId === task.id
                        ? prev
                        : { status, beforeId: task.id },
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleDrop(status, task.id);
                  }}
                  className={dragId === task.id ? "opacity-40" : ""}
                >
                  <TaskCard
                    task={task}
                    busy={Boolean(busy[task.id])}
                    onToggle={() => onToggle(task)}
                    onDelete={() => onDelete(task)}
                    onStatusChange={(status) => moveToStatus(task, status)}
                  />
                </li>
              ))}
            </ul>

            {columnTasks.length === 0 && (
              <p className="px-1 py-4 text-center text-[11px] text-muted">
                {columnActive ? "Lepaskan di sini" : "Kosong — tarik ke sini"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  actions,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted transition-colors duration-150 hover:text-foreground"
        >
          {open ? (
            <ChevronUp size={14} aria-hidden />
          ) : (
            <ChevronDown size={14} aria-hidden />
          )}
          {title}
        </button>
        {subtitle}
        <div className="flex-1" />
        {actions}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}
