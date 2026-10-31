"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { Markdown } from "@/components/Markdown";
import {
  approveVibeArtifact,
  buildVibeTaskPrompt,
  createVibeDecision,
  deleteVibeDecision,
  generateVibeArtifact,
  generateVibeTasks,
  getProject,
  getVibeSession,
  listVibeArtifactVersions,
  listVibeArtifacts,
  listVibeDecisions,
  listVibeMessages,
  listVibeTasks,
  markVibeArtifactStale,
  saveVibeArtifact,
  sendVibeMessage,
  updateVibeDecision,
  updateVibeVerification,
  type Project,
  type ProjectTask,
  type VibeArtifact,
  type VibeArtifactKind,
  type VibeArtifactVersion,
  type VibeDecision,
  type VibeDecisionStatus,
  type VibeMessage,
  type VibeSession,
  type VibeVerificationStatus,
} from "@/lib/api";
import {
  PROJECT_INPUT_CLASS,
  PROJECT_LABEL_CLASS,
  PROJECT_STATUS_LABELS,
} from "@/lib/projectMeta";
import {
  VIBE_ARTIFACT_HINTS,
  VIBE_ARTIFACT_KINDS,
  VIBE_ARTIFACT_LABELS,
  VIBE_ARTIFACT_STATUS_CLASSES,
  VIBE_DECISION_CLASSES,
  VIBE_DECISION_LABELS,
  VIBE_STAGE_LABELS,
  VIBE_VERIFICATION_CLASSES,
  VIBE_VERIFICATION_LABELS,
} from "@/lib/vibeMeta";

type Tab = "discovery" | "documents" | "plan" | "verify";

const TABS: { id: Tab; label: string }[] = [
  { id: "discovery", label: "Discovery" },
  { id: "documents", label: "Dokumen" },
  { id: "plan", label: "Rencana" },
  { id: "verify", label: "Verifikasi" },
];

const DECISION_STATUSES: VibeDecisionStatus[] = [
  "CONFIRMED",
  "ASSUMED",
  "RESEARCH",
  "NEEDS_DECISION",
  "VALIDATION_REQUIRED",
];

const VERIFICATION_STATUSES: VibeVerificationStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "NEEDS_REVIEW",
  "DONE",
];

const PRIORITY_LABELS: Record<string, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
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

export default function VibeWorkspacePage() {
  const params = useParams<{ id: string; sessionId: string }>();
  const id = params?.id ?? "";
  const sessionId = params?.sessionId ?? "";

  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<VibeSession | null>(null);
  const [messages, setMessages] = useState<VibeMessage[]>([]);
  const [decisions, setDecisions] = useState<VibeDecision[]>([]);
  const [artifacts, setArtifacts] = useState<VibeArtifact[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("discovery");

  // Discovery composer
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  // Selected suggestion options, keyed by a stable per-question id. Selections
  // are held until Send so the user can pick multiple options before sending.
  const [optionSelections, setOptionSelections] = useState<Record<string, string[]>>({});

  // Chat pagination: messages are shown 5 per page in their natural order
  // (page 1 = oldest). The view always snaps to the newest page whenever the
  // message count changes, so replies stay visible without manual paging.
  const CHAT_PAGE_SIZE = 5;
  const [chatPage, setChatPage] = useState(1);

  // Decisions
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionsOpen, setDecisionsOpen] = useState(true);
  const [decisionDraft, setDecisionDraft] = useState<{
    statement: string;
    category: string;
    status: VibeDecisionStatus;
    rationale: string;
  }>({ statement: "", category: "general", status: "NEEDS_DECISION", rationale: "" });
  const [decisionBusy, setDecisionBusy] = useState(false);

  // Artifacts
  const [selectedKind, setSelectedKind] = useState<VibeArtifactKind>("PRD");
  const [draftContent, setDraftContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [artifactInstructions, setArtifactInstructions] = useState("");
  const [versions, setVersions] = useState<VibeArtifactVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Plan + prompt
  const [maxTasks, setMaxTasks] = useState(8);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [prompt, setPrompt] = useState<{ taskId: string; text: string } | null>(null);
  const [promptBusy, setPromptBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Verification drafts keyed by task id
  const [verifyDrafts, setVerifyDrafts] = useState<
    Record<string, { status: VibeVerificationStatus; evidence: string; notes: string }>
  >({});
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const chatTotalPages = Math.max(1, Math.ceil(messages.length / CHAT_PAGE_SIZE));
  const chatCurrentPage = Math.min(Math.max(chatPage, 1), chatTotalPages);
  const chatHasOlder = chatCurrentPage > 1;
  const chatHasNewer = chatCurrentPage < chatTotalPages;
  const chatWindowStart = (chatCurrentPage - 1) * CHAT_PAGE_SIZE;
  const pagedMessages = messages.slice(chatWindowStart, chatWindowStart + CHAT_PAGE_SIZE);

  // Continuous question numbering across the whole conversation (page 1 =
  // oldest), so numbers keep increasing instead of restarting per message.
  const questionBaseById = useMemo(() => {
    const map = new Map<string, number>();
    let running = 0;
    for (const item of messages) {
      map.set(item.id, running);
      running += (item.metadata.questions ?? []).length;
    }
    return map;
  }, [messages]);

  useEffect(() => {
    // Always land on the newest page when the conversation grows (initial
    // load, a sent reply, or a refreshed session).
    setChatPage(Math.max(1, Math.ceil(messages.length / CHAT_PAGE_SIZE)));
  }, [messages.length]);

  // Context-aware scrolling, no smooth animation: a new message lands at the
  // bottom of the newest page, while a manual page change jumps to the top of
  // the list instantly so paging never feels like a jarring timeskip.
  const chatLastLenRef = useRef(0);
  const chatLastPageRef = useRef(1);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      if (messages.length !== chatLastLenRef.current) {
        el.scrollTo({ top: el.scrollHeight });
      } else if (chatCurrentPage !== chatLastPageRef.current) {
        el.scrollTo({ top: 0 });
      }
    }
    chatLastLenRef.current = messages.length;
    chatLastPageRef.current = chatCurrentPage;
  }, [chatCurrentPage, messages.length]);

  const artifactByKind = useMemo(() => {
    const map = new Map<VibeArtifactKind, VibeArtifact>();
    for (const item of artifacts) map.set(item.kind, item);
    return map;
  }, [artifacts]);

  const selectedArtifact = artifactByKind.get(selectedKind) ?? null;
  const approvedCount = artifacts.filter((item) => item.status === "APPROVED").length;
  const openTasks = tasks.filter((task) => task.verification_status !== "DONE").length;

  const selectedOptions = useMemo(
    () => Object.values(optionSelections).flat(),
    [optionSelections],
  );
  const selectedCount = selectedOptions.length;

  function toggleOption(key: string, option: string) {
    setOptionSelections((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
      return { ...prev, [key]: next };
    });
  }

  const applyArtifact = useCallback((artifact: VibeArtifact | null) => {
    setDraftContent(artifact?.content ?? "");
    setEditing(false);
  }, []);

  const load = useCallback(async () => {
    if (!id || !sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const [projectData, sessionData, messageData, decisionData, artifactData, taskData] =
        await Promise.all([
          getProject(id),
          getVibeSession(id, sessionId),
          listVibeMessages(id, sessionId),
          listVibeDecisions(id, sessionId),
          listVibeArtifacts(id, sessionId),
          listVibeTasks(id, sessionId),
        ]);
      setProject(projectData);
      setSession(sessionData);
      setMessages(messageData ?? []);
      setDecisions(decisionData ?? []);
      setArtifacts(artifactData ?? []);
      setTasks(taskData ?? []);
      setVerifyDrafts(
        Object.fromEntries(
          (taskData ?? []).map((task) => [
            task.id,
            {
              status: task.verification_status ?? "TODO",
              evidence: task.verification_evidence ?? "",
              notes: task.verification_notes ?? "",
            },
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat workspace.");
    } finally {
      setLoading(false);
    }
  }, [id, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyArtifact(selectedArtifact);
    setVersions([]);
    setVersionsOpen(false);
  }, [selectedKind, selectedArtifact, applyArtifact]);

  async function refreshMessagesAndDecisions() {
    const [messageData, decisionData] = await Promise.all([
      listVibeMessages(id, sessionId),
      listVibeDecisions(id, sessionId),
    ]);
    setMessages(messageData ?? []);
    setDecisions(decisionData ?? []);
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    const options = Object.values(optionSelections).flat();
    if ((!text && options.length === 0) || sending) return;
    const parts: string[] = [];
    if (options.length > 0) {
      parts.push("Pilihan yang saya pilih:", ...options.map((option) => `- ${option}`));
    }
    if (text) parts.push(text);
    const content = parts.join("\n").trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      await sendVibeMessage(id, sessionId, content);
      setMessage("");
      setOptionSelections({});
      await refreshMessagesAndDecisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim pesan.");
    } finally {
      setSending(false);
    }
  }

  async function addDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!decisionDraft.statement.trim() || decisionBusy) return;
    setDecisionBusy(true);
    setError(null);
    try {
      const created = await createVibeDecision(id, sessionId, {
        category: decisionDraft.category.trim() || "general",
        statement: decisionDraft.statement.trim(),
        status: decisionDraft.status,
        rationale: decisionDraft.rationale.trim(),
      });
      setDecisions((prev) => [...prev, created]);
      setDecisionDraft({
        statement: "",
        category: "general",
        status: "NEEDS_DECISION",
        rationale: "",
      });
      setShowDecisionForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah keputusan.");
    } finally {
      setDecisionBusy(false);
    }
  }

  async function changeDecisionStatus(decision: VibeDecision, status: VibeDecisionStatus) {
    setError(null);
    try {
      const updated = await updateVibeDecision(id, sessionId, decision.id, { status });
      setDecisions((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      // A decision change can mark documents stale server-side.
      setArtifacts(await listVibeArtifacts(id, sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memperbarui keputusan.");
    }
  }

  async function removeDecision(decision: VibeDecision) {
    setError(null);
    try {
      await deleteVibeDecision(id, sessionId, decision.id);
      setDecisions((prev) => prev.filter((item) => item.id !== decision.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus keputusan.");
    }
  }

  async function generate(kind: VibeArtifactKind) {
    setGenerating(true);
    setError(null);
    try {
      const artifact = await generateVibeArtifact(
        id,
        sessionId,
        kind,
        artifactInstructions.trim(),
      );
      setArtifacts((prev) => {
        const rest = prev.filter((item) => item.kind !== artifact.kind);
        return [...rest, artifact];
      });
      applyArtifact(artifact);
      setVersions([]);
      setVersionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghasilkan dokumen.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveArtifact() {
    if (!draftContent.trim() || savingArtifact) return;
    setSavingArtifact(true);
    setError(null);
    try {
      const artifact = await saveVibeArtifact(id, sessionId, selectedKind, draftContent);
      setArtifacts((prev) => {
        const rest = prev.filter((item) => item.kind !== artifact.kind);
        return [...rest, artifact];
      });
      applyArtifact(artifact);
      if (versionsOpen) await loadVersions(artifact.kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan dokumen.");
    } finally {
      setSavingArtifact(false);
    }
  }

  async function approve(kind: VibeArtifactKind) {
    setError(null);
    try {
      const artifact = await approveVibeArtifact(id, sessionId, kind);
      setArtifacts((prev) =>
        prev.map((item) => (item.kind === artifact.kind ? artifact : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyetujui dokumen.");
    }
  }

  async function markStale(kind: VibeArtifactKind) {
    setError(null);
    try {
      const artifact = await markVibeArtifactStale(id, sessionId, kind);
      setArtifacts((prev) =>
        prev.map((item) => (item.kind === artifact.kind ? artifact : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menandai dokumen.");
    }
  }

  async function loadVersions(kind: VibeArtifactKind) {
    setError(null);
    try {
      setVersions(await listVibeArtifactVersions(id, sessionId, kind));
      setVersionsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat versi.");
    }
  }

  async function generateTasks() {
    setGeneratingTasks(true);
    setError(null);
    try {
      const created = await generateVibeTasks(id, sessionId, maxTasks);
      setTasks(created ?? []);
      setVerifyDrafts(
        Object.fromEntries(
          (created ?? []).map((task) => [
            task.id,
            {
              status: task.verification_status ?? "TODO",
              evidence: task.verification_evidence ?? "",
              notes: task.verification_notes ?? "",
            },
          ]),
        ),
      );
      setTab("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat rencana task.");
    } finally {
      setGeneratingTasks(false);
    }
  }

  async function makePrompt(task: ProjectTask) {
    setPromptBusy(task.id);
    setError(null);
    try {
      const result = await buildVibeTaskPrompt(id, sessionId, task.id);
      setPrompt({ taskId: task.id, text: result.prompt });
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat prompt.");
    } finally {
      setPromptBusy(null);
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the textarea stays selectable.
    }
  }

  async function saveVerification(task: ProjectTask) {
    const draft = verifyDrafts[task.id];
    if (!draft) return;
    setVerifyBusy(task.id);
    setError(null);
    try {
      const updated = await updateVibeVerification(id, sessionId, task.id, draft);
      setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan verifikasi.");
    } finally {
      setVerifyBusy(null);
    }
  }

  function setVerifyDraft(
    taskId: string,
    patch: Partial<{ status: VibeVerificationStatus; evidence: string; notes: string }>,
  ) {
    setVerifyDrafts((prev) => ({
      ...prev,
      [taskId]: {
        status: prev[taskId]?.status ?? "TODO",
        evidence: prev[taskId]?.evidence ?? "",
        notes: prev[taskId]?.notes ?? "",
        ...patch,
      },
    }));
  }

  const inputClass = PROJECT_INPUT_CLASS;
  const labelClass = PROJECT_LABEL_CLASS;

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
          <LoadingState label="Memuat Vibe Coding workspace..." variant="detail" rows={8} />
        </div>
      </AppShell>
    );
  }

  if (!session || !project) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-8">
          <p role="alert" className="rounded-lg border border-danger/40 px-3 py-2 text-[13px] text-danger">
            {error ?? "Workspace tidak ditemukan."}
          </p>
          <Link
            href={`/projects/${id}/vibe`}
            className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted hover:text-foreground"
          >
            <ChevronLeft size={14} aria-hidden />
            Kembali ke daftar workspace
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-16 lg:px-8">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <Link
              href={`/projects/${id}`}
              className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground"
            >
              <ChevronLeft size={13} aria-hidden />
              {project.name}
            </Link>
            <span aria-hidden className="text-muted-3">/</span>
            <Link
              href={`/projects/${id}/vibe`}
              className="transition-colors duration-150 hover:text-foreground"
            >
              Vibe Coding
            </Link>
          </div>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight font-brand">
                {session.title}
              </h1>
              {project.labels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.labels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="rounded-full border border-border/70 bg-surface px-2 py-0.5">
                  {VIBE_STAGE_LABELS[session.stage]}
                </span>
                <span>{approvedCount}/7 dokumen disetujui</span>
                <span className="text-muted-3" aria-hidden>·</span>
                <span>{decisions.length} keputusan</span>
                <span className="text-muted-3" aria-hidden>·</span>
                <span>{openTasks} task belum terverifikasi</span>
                <span className="text-muted-3" aria-hidden>·</span>
                <span>{PROJECT_STATUS_LABELS[project.status]}</span>
              </div>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          )}

          <div className="mt-6 flex w-fit flex-wrap gap-1 rounded-xl border border-border/70 bg-surface p-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-medium transition-colors duration-150 ${
                  tab === item.id
                    ? "bg-surface-muted text-foreground shadow-sm"
                    : "text-muted hover:bg-surface-muted/60 hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* ------------------------------------------------------ discovery */}
          {tab === "discovery" && (
            <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <section className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-surface">
                <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  {messages.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border/70 bg-surface-muted/30 p-4">
                      <p className="text-[13px] font-medium">Mulai dari ide mentah.</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">
                        Contoh: “Saya ingin fitur reminder tugas di proyek ini supaya
                        task penting tidak terlewat.” Axtra akan meringkas pemahaman
                        lalu menanyakan satu hingga tiga hal penting.
                      </p>
                    </div>
                  )}

                  {pagedMessages.map((item) => (
                    <article
                      key={item.id}
                      className={
                        item.role === "user"
                          ? "ml-auto max-w-[85%] rounded-2xl border border-border/70 bg-transparent px-3.5 py-2.5 text-foreground"
                          : "max-w-[92%] rounded-2xl bg-surface-muted/40 px-3.5 py-2.5"
                      }
                    >
                      {item.role === "assistant" ? (
                        <>
                          <Markdown content={item.content} />
                          {(item.metadata.questions ?? []).length > 0 && (
                            <div className="mt-5 border-t border-border/60 pt-4">
                              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                Pilih jawaban
                              </p>
                              <div className="space-y-4">
                                {(item.metadata.questions ?? []).map((question, index) => {
                                  const qKey = `${item.id}-q-${index}`;
                                  const chosen = optionSelections[qKey] ?? [];
                                  return (
                                    <div
                                      key={qKey}
                                      className="rounded-xl border border-border/60 bg-surface/60 p-3.5"
                                    >
                                      <div className="flex items-start gap-2.5">
                                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                          {(questionBaseById.get(item.id) ?? 0) + index + 1}
                                        </span>
                                        <p className="text-[13.5px] font-medium leading-relaxed text-foreground">
                                          {question.question}
                                        </p>
                                      </div>
                                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {question.options.map((option) => {
                                          const active = chosen.includes(option);
                                          const recommended = question.recommended === option;
                                          return (
                                            <button
                                              key={option}
                                              type="button"
                                              aria-pressed={active}
                                              onClick={() => toggleOption(qKey, option)}
                                              className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[12.5px] leading-snug transition-colors duration-150 ${
                                                active
                                                  ? "border-emerald-500/50 bg-emerald-500/10 text-foreground"
                                                  : "border-border/70 bg-surface text-foreground hover:border-foreground/25 hover:bg-surface-muted"
                                              }`}
                                            >
                                              <span
                                                aria-hidden
                                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                                                  active
                                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                                    : "border-border bg-transparent group-hover:border-foreground/40"
                                                }`}
                                              >
                                                {active && <Check size={10} strokeWidth={3} />}
                                              </span>
                                              <span className="min-w-0 flex-1">{option}</span>
                                              {recommended && (
                                                <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground">
                                                  Disarankan
                                                </span>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      {question.recommended && (
                                        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-foreground">
                                          <Sparkles size={11} aria-hidden />
                                          Rekomendasi: {question.recommended}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="mt-4 text-[11px] leading-relaxed text-muted">
                                Bisa pilih lebih dari satu opsi, lalu klik Kirim. Opsi terpilih
                                ikut terkirim bersama jawabanmu.
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap text-[13px]">{item.content}</p>
                      )}
                      <p className="mt-1.5 text-[10px] text-muted">
                        {formatWhen(item.created_at)}
                      </p>
                    </article>
                  ))}

                  {sending && (
                    <p className="flex items-center gap-2 text-[12px] text-muted">
                      <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
                      Menganalisis jawaban...
                    </p>
                  )}
                </div>

                {messages.length > CHAT_PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[11px] text-muted">
                    <button
                      type="button"
                      disabled={!chatHasOlder}
                      onClick={() => setChatPage(chatCurrentPage - 1)}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                    >
                      <span className="inline-flex items-center gap-1">
                        <ChevronLeft size={12} aria-hidden />
                        Before
                      </span>
                    </button>
                    <span>
                      Halaman {chatCurrentPage} / {chatTotalPages}
                      <span className="text-muted-3" aria-hidden> · </span>
                      {messages.length} pesan
                    </span>
                    <button
                      type="button"
                      disabled={!chatHasNewer}
                      onClick={() => setChatPage(chatCurrentPage + 1)}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                    >
                      <span className="inline-flex items-center gap-1">
                        After
                        <ChevronRight size={12} aria-hidden />
                      </span>
                    </button>
                  </div>
                )}

                <form onSubmit={sendMessage} className="border-t border-border/60 p-3.5">
                  <label htmlFor="vibe-message" className="sr-only">
                    Jawaban discovery
                  </label>
                  <div className="flex items-end gap-2">
                    <textarea
                      id="vibe-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      rows={4}
                      placeholder="Jawab, tambahkan konteks, atau bilang 'saya belum tahu, pilih yang aman'..."
                      className={`flex-1 resize-none ${inputClass}`}
                    />
                    <button
                      type="submit"
                      disabled={sending || (!message.trim() && selectedCount === 0)}
                      aria-label="Kirim jawaban"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                    >
                      <Send size={15} aria-hidden />
                    </button>
                  </div>
                </form>
              </section>

              <aside className="h-fit rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
                    Keputusan
                  </h2>
                  <div className="flex items-center gap-1">
                    {decisionsOpen && (
                      <button
                        type="button"
                        onClick={() => setShowDecisionForm((value) => !value)}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                      >
                        {showDecisionForm ? <X size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
                        {showDecisionForm ? "Tutup" : "Tambah"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDecisionsOpen((value) => !value)}
                      aria-expanded={decisionsOpen}
                      aria-label={decisionsOpen ? "Minimize keputusan" : "Buka keputusan"}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
                    >
                      <ChevronDown
                        size={14}
                        aria-hidden
                        className={`transition-transform duration-150 ${decisionsOpen ? "" : "-rotate-90"}`}
                      />
                    </button>
                  </div>
                </div>

                {decisionsOpen && (
                  <>
                {showDecisionForm && (
                  <form onSubmit={addDecision} className="mt-3 space-y-2 rounded-lg bg-surface-muted/40 p-2.5">
                    <textarea
                      value={decisionDraft.statement}
                      onChange={(event) =>
                        setDecisionDraft((prev) => ({ ...prev, statement: event.target.value }))
                      }
                      rows={2}
                      placeholder="Keputusan atau asumsi..."
                      className={`w-full ${inputClass}`}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={decisionDraft.category}
                        onChange={(event) =>
                          setDecisionDraft((prev) => ({ ...prev, category: event.target.value }))
                        }
                        placeholder="kategori"
                        className={inputClass}
                      />
                      <select
                        value={decisionDraft.status}
                        onChange={(event) =>
                          setDecisionDraft((prev) => ({
                            ...prev,
                            status: event.target.value as VibeDecisionStatus,
                          }))
                        }
                        className={inputClass}
                      >
                        {DECISION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {VIBE_DECISION_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={decisionBusy || !decisionDraft.statement.trim()}
                      className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground hover:bg-surface-muted disabled:opacity-40"
                    >
                      {decisionBusy ? "Menyimpan..." : "Simpan keputusan"}
                    </button>
                  </form>
                )}

                {decisions.length === 0 ? (
                  <p className="mt-3 text-[12px] text-muted">
                    Belum ada keputusan. Keputusan dari discovery akan muncul di sini
                    dengan status eksplisit.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {decisions.map((decision) => (
                      <li key={decision.id} className="rounded-lg bg-surface-muted/40 px-2.5 py-2">
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] leading-snug text-foreground">{decision.statement}</p>
                            <p className="mt-1 text-[10px] text-muted">
                              {decision.category} · {decision.source}
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label="Hapus keputusan"
                            onClick={() => void removeDecision(decision)}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface hover:text-danger"
                          >
                            <Trash2 size={11} aria-hidden />
                          </button>
                        </div>
                        <select
                          value={decision.status}
                          onChange={(event) =>
                            void changeDecisionStatus(
                              decision,
                              event.target.value as VibeDecisionStatus,
                            )
                          }
                          className={`mt-1.5 rounded-full border bg-surface px-2 py-0.5 text-[10px] outline-none ${VIBE_DECISION_CLASSES[decision.status]}`}
                        >
                          {DECISION_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {VIBE_DECISION_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
                  </>
                )}
              </aside>
            </div>
          )}

          {/* ------------------------------------------------------ documents */}
          {tab === "documents" && (
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <aside className="space-y-1">
                {VIBE_ARTIFACT_KINDS.map((kind) => {
                  const artifact = artifactByKind.get(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setSelectedKind(kind)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ${
                        selectedKind === kind
                          ? "border-foreground/40 bg-surface"
                          : "border-border bg-surface hover:border-foreground/25"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium">
                          {VIBE_ARTIFACT_LABELS[kind]}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${
                            artifact
                              ? VIBE_ARTIFACT_STATUS_CLASSES[artifact.status]
                              : "border-border text-muted"
                          }`}
                        >
                          {artifact ? artifact.status : "BELUM"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted">
                        {VIBE_ARTIFACT_HINTS[kind]}
                      </p>
                    </button>
                  );
                })}
              </aside>

              <section className="min-w-0 rounded-lg border border-border bg-surface">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  <FileText size={14} className="text-muted" aria-hidden />
                  <h2 className="text-[13px] font-semibold">
                    {VIBE_ARTIFACT_LABELS[selectedKind]}
                  </h2>
                  {selectedArtifact && (
                    <>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          VIBE_ARTIFACT_STATUS_CLASSES[selectedArtifact.status]
                        }`}
                      >
                        {selectedArtifact.status}
                      </span>
                      <span className="text-[10px] text-muted">
                        v{selectedArtifact.version} · {selectedArtifact.generated_by}
                      </span>
                    </>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => void generate(selectedKind)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-surface-muted disabled:opacity-40"
                  >
                    <Sparkles size={12} aria-hidden />
                    {generating ? "Membuat..." : selectedArtifact ? "Regenerate" : "Generate"}
                  </button>
                  {selectedArtifact && (
                    <>
                      <button
                        type="button"
                        onClick={() => void approve(selectedKind)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-emerald-500 hover:bg-surface-muted"
                      >
                        <ShieldCheck size={12} aria-hidden />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void markStale(selectedKind)}
                        className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] text-sky-500 hover:bg-surface-muted"
                      >
                        Stale
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadVersions(selectedKind)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted hover:bg-surface-muted hover:text-foreground"
                      >
                        <RefreshCw size={11} aria-hidden />
                        Versi
                      </button>
                    </>
                  )}
                </div>

                <div className="p-3">
                  <label className={labelClass} htmlFor="vibe-artifact-instructions">
                    Instruksi tambahan untuk generate (opsional)
                  </label>
                  <input
                    id="vibe-artifact-instructions"
                    value={artifactInstructions}
                    onChange={(event) => setArtifactInstructions(event.target.value)}
                    placeholder="Contoh: fokus pada MVP, sebutkan trade-off biaya."
                    className={`mt-1 ${inputClass}`}
                  />

                  {!selectedArtifact && !generating ? (
                    <div className="mt-4 rounded-lg border border-dashed border-border p-4">
                      <p className="text-[13px] font-medium">Dokumen belum dibuat.</p>
                      <p className="mt-1 text-[12px] text-muted">
                        Generate dari ide, jawaban discovery, keputusan, dan konteks
                        proyek. Dokumen bisa tetap draft selama discovery berlanjut.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing((value) => !value)}
                          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground hover:bg-surface-muted"
                        >
                          {editing ? "Pratinjau" : "Edit"}
                        </button>
                        {editing && (
                          <button
                            type="button"
                            disabled={savingArtifact || !draftContent.trim()}
                            onClick={() => void saveArtifact()}
                            className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                          >
                            {savingArtifact ? "Menyimpan..." : "Simpan versi baru"}
                          </button>
                        )}
                        {selectedArtifact?.status === "APPROVED" && (
                          <span className="text-[11px] text-muted">
                            Dokumen approved: regenerate/edit membuat versi baru yang
                            perlu review.
                          </span>
                        )}
                      </div>

                      {editing ? (
                        <textarea
                          value={draftContent}
                          onChange={(event) => setDraftContent(event.target.value)}
                          rows={22}
                          aria-label="Isi dokumen Markdown"
                          className={`mt-2 w-full font-mono ${inputClass}`}
                        />
                      ) : (
                        <div className="mt-2 rounded-lg border border-border px-3 py-2">
                          {draftContent ? (
                            <Markdown content={draftContent} />
                          ) : (
                            <p className="text-[12px] text-muted">
                              {generating ? "Membuat dokumen..." : "Dokumen kosong."}
                            </p>
                          )}
                        </div>
                      )}

                      {versionsOpen && (
                        <div className="mt-4 rounded-lg border border-border">
                          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                              Riwayat versi
                            </h3>
                            <button
                              type="button"
                              onClick={() => setVersionsOpen(false)}
                              aria-label="Tutup riwayat versi"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-muted"
                            >
                              <X size={12} aria-hidden />
                            </button>
                          </div>
                          {versions.length === 0 ? (
                            <p className="px-3 py-2 text-[12px] text-muted">Belum ada versi.</p>
                          ) : (
                            <ul className="divide-y divide-border">
                              {versions.map((version) => (
                                <li key={version.id} className="flex items-center gap-2 px-3 py-1.5">
                                  <span className="text-[12px] font-medium">v{version.version}</span>
                                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
                                    {version.status}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                                    {version.note || "—"} · {formatWhen(version.created_at)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDraftContent(version.content);
                                      setEditing(true);
                                    }}
                                    className="inline-flex h-6 items-center rounded-md px-2 text-[11px] text-muted hover:bg-surface-muted hover:text-foreground"
                                  >
                                    Muat
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ----------------------------------------------------------- plan */}
          {tab === "plan" && (
            <div className="mt-5 space-y-4">
              <section className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className={labelClass} htmlFor="vibe-max-tasks">
                      Maksimal task
                    </label>
                    <input
                      id="vibe-max-tasks"
                      type="number"
                      min={1}
                      max={12}
                      value={maxTasks}
                      onChange={(event) =>
                        setMaxTasks(Math.max(1, Math.min(12, Number(event.target.value) || 1)))
                      }
                      className={`mt-1 w-24 ${inputClass}`}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={generatingTasks}
                    onClick={() => void generateTasks()}
                    className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground hover:bg-surface-muted disabled:opacity-40"
                  >
                    <Sparkles size={14} aria-hidden />
                    {generatingTasks ? "Menyusun..." : "Generate rencana task"}
                  </button>
                  <p className="max-w-md text-[11px] text-muted">
                    Task masuk ke papan tugas proyek yang sama (source “vibe”), jadi
                    bisa dicentang di halaman proyek. Prototype boleh dikerjakan
                    sebelum semua dokumen selesai.
                  </p>
                </div>
              </section>

              {tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted">
                  Belum ada task. Generate rencana setelah ada cukup konteks, atau
                  tulis task manual di halaman proyek.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tasks.map((task) => (
                    <li key={task.id} className="rounded-lg border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-muted">
                          {task.vibe_task_key ?? "TASK"}
                        </span>
                        <h3 className="min-w-0 flex-1 text-[13px] font-semibold">
                          {task.title}
                        </h3>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                          {PRIORITY_LABELS[task.priority] ?? task.priority}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            VIBE_VERIFICATION_CLASSES[task.verification_status ?? "TODO"]
                          }`}
                        >
                          {VIBE_VERIFICATION_LABELS[task.verification_status ?? "TODO"]}
                        </span>
                      </div>
                      {task.detail && (
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">
                          {task.detail}
                        </p>
                      )}
                      {(task.acceptance_criteria ?? []).length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted">
                            Acceptance
                          </p>
                          <ul className="mt-0.5 list-inside list-disc text-[12px]">
                            {(task.acceptance_criteria ?? []).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        {(task.dependencies ?? []).length > 0 && (
                          <span>Dep: {(task.dependencies ?? []).join(", ")}</span>
                        )}
                        {(task.affected_modules ?? []).length > 0 && (
                          <span>Modul: {(task.affected_modules ?? []).join(", ")}</span>
                        )}
                        <div className="flex-1" />
                        <button
                          type="button"
                          disabled={promptBusy === task.id}
                          onClick={() => void makePrompt(task)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-surface-muted disabled:opacity-40"
                        >
                          <ClipboardCopy size={11} aria-hidden />
                          {promptBusy === task.id ? "Menyusun..." : "Buat prompt"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {prompt && (
                <section className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[13px] font-semibold">Prompt untuk coding agent</h2>
                    <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-500">
                      rencana, bukan kode terimplementasi
                    </span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => void copyPrompt()}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] text-foreground hover:bg-surface-muted"
                    >
                      {copied ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
                      {copied ? "Tersalin" : "Salin"}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={prompt.text}
                    rows={18}
                    aria-label="Prompt implementasi"
                    className={`mt-2 w-full font-mono text-[11px] ${inputClass}`}
                  />
                </section>
              )}
            </div>
          )}

          {/* --------------------------------------------------------- verify */}
          {tab === "verify" && (
            <div className="mt-5 space-y-3">
              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-muted">
                Verifikasi berbasis bukti. Axtra tidak menandai lulus karena model
                mengatakan lulus. Tempel output test/log dari coding agent, lalu pilih
                status. Status DONE wajib punya bukti.
              </p>
              {tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted">
                  Belum ada task untuk diverifikasi. Buat rencana di tab Rencana.
                </p>
              ) : (
                tasks.map((task) => {
                  const draft = verifyDrafts[task.id] ?? {
                    status: task.verification_status ?? "TODO",
                    evidence: task.verification_evidence ?? "",
                    notes: task.verification_notes ?? "",
                  };
                  return (
                    <section key={task.id} className="rounded-lg border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-muted">
                          {task.vibe_task_key ?? "TASK"}
                        </span>
                        <h3 className="min-w-0 flex-1 text-[13px] font-semibold">
                          {task.title}
                        </h3>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            VIBE_VERIFICATION_CLASSES[draft.status]
                          }`}
                        >
                          {VIBE_VERIFICATION_LABELS[draft.status]}
                        </span>
                      </div>

                      {(task.acceptance_criteria ?? []).length > 0 && (
                        <ul className="mt-1.5 list-inside list-disc text-[12px] text-muted">
                          {(task.acceptance_criteria ?? []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                        <div>
                          <label className={labelClass} htmlFor={`verify-status-${task.id}`}>
                            Status
                          </label>
                          <select
                            id={`verify-status-${task.id}`}
                            value={draft.status}
                            onChange={(event) =>
                              setVerifyDraft(task.id, {
                                status: event.target.value as VibeVerificationStatus,
                              })
                            }
                            className={`mt-1 ${inputClass}`}
                          >
                            {VERIFICATION_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {VIBE_VERIFICATION_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass} htmlFor={`verify-evidence-${task.id}`}>
                            Bukti (output test/log/ringkasan)
                          </label>
                          <textarea
                            id={`verify-evidence-${task.id}`}
                            value={draft.evidence}
                            onChange={(event) =>
                              setVerifyDraft(task.id, { evidence: event.target.value })
                            }
                            rows={3}
                            placeholder="Tempel hasil pytest/npm build, log, atau ringkasan implementasi."
                            className={`mt-1 ${inputClass}`}
                          />
                        </div>
                      </div>
                      <div className="mt-2">
                        <label className={labelClass} htmlFor={`verify-notes-${task.id}`}>
                          Kendala / sisa masalah
                        </label>
                        <input
                          id={`verify-notes-${task.id}`}
                          value={draft.notes}
                          onChange={(event) =>
                            setVerifyDraft(task.id, { notes: event.target.value })
                          }
                          className={`mt-1 ${inputClass}`}
                        />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          disabled={
                            verifyBusy === task.id ||
                            (draft.status === "DONE" && !draft.evidence.trim())
                          }
                          onClick={() => void saveVerification(task)}
                          className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-foreground hover:bg-surface-muted disabled:opacity-40"
                        >
                          {verifyBusy === task.id ? "Menyimpan..." : "Simpan verifikasi"}
                        </button>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}