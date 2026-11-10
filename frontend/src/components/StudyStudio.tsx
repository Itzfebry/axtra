"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Check,
  History,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LoadingState } from "@/components/ui/LoadingState";
import { Markdown, MathText } from "@/components/Markdown";
import {
  createStudyTopic,
  deleteStudyQuizHistory,
  deleteStudyTopic,
  explainStudyQuestion,
  generateStudyMaterial,
  generateStudyPlan,
  generateStudyQuiz,
  gradeStudyQuiz,
  importStudyMaterial,
  linkStudyGoal,
  listStudyTopics,
  scheduleStudyReview,
  updateStudyTopic,
  type StudyGradeResult,
  type StudyQuizLevel,
  type StudyStatus,
  type StudyTopic,
} from "@/lib/api";
import { useDelayedFlag } from "@/lib/useDelayedFlag";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

const chipClass =
  "inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground disabled:opacity-40";

const primaryButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

function statusLabel(status: StudyStatus): string {
  if (status === "done") return "Selesai";
  if (status === "archived") return "Diarsipkan";
  return "Aktif";
}

const QUIZ_LEVEL_OPTIONS: { value: StudyQuizLevel; label: string }[] = [
  { value: "campuran", label: "Campuran" },
  { value: "mudah", label: "Mudah" },
  { value: "sedang", label: "Sedang" },
  { value: "sulit", label: "Sulit" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function todayIndex(topic: StudyTopic): number {
  if (!topic.created_at) return 1;
  const start = new Date(topic.created_at);
  const now = new Date();
  const diff = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86400000,
  );
  return Math.max(1, diff + 1);
}

export function StudyStudio() {
  const [topics, setTopics] = useState<StudyTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedFlag(loading);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<number[]>([]);
  const [grade, setGrade] = useState<StudyGradeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTopics(await listStudyTopics());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat topik belajar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = topics.find((topic) => topic.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setNotes(selected.notes);
    setAnswers([]);
    setGrade(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function replaceTopic(updated: StudyTopic) {
    setTopics((prev) =>
      prev.map((topic) => (topic.id === updated.id ? updated : topic)),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const created = await createStudyTopic({
        title: title.trim(),
        subject: subject.trim(),
        goal: goal.trim(),
        target_date: targetDate || null,
      });
      setTopics((prev) => [created, ...prev]);
      setTitle("");
      setSubject("");
      setGoal("");
      setTargetDate("");
      setShowForm(false);
      setSelectedId(created.id);
      setNotice("Topik dibuat. Impor materi atau buat materi untuk mulai.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat topik.");
    }
  }

  async function run(
    key: string,
    action: () => Promise<StudyTopic>,
    message: string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      replaceTopic(await action());
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aksi gagal.");
    } finally {
      setBusy(null);
    }
  }

  async function submitQuiz(topic: StudyTopic) {
    setBusy("grade");
    setError(null);
    setNotice(null);
    try {
      const result = await gradeStudyQuiz(topic.id, answers);
      setGrade(result);
      const refreshed = await listStudyTopics();
      setTopics(refreshed);
      setNotice(`Skor kuis: ${result.score}% (${result.correct}/${result.total}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menilai kuis.");
    } finally {
      setBusy(null);
    }
  }

  async function explain(topic: StudyTopic, index: number) {
    if (topic.quiz[index]?.detail) return;
    setBusy("explain");
    setError(null);
    setNotice(null);
    try {
      const { explanation } = await explainStudyQuestion(topic.id, index);
      replaceTopic({
        ...topic,
        quiz: topic.quiz.map((question, qIndex) =>
          qIndex === index ? { ...question, detail: explanation } : question,
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat penjelasan.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(topic: StudyTopic) {
    const ok = window.confirm(
      `Hapus topik "${topic.title}" beserta materi, kuis, dan rencananya?\n\nTindakan ini tidak dapat dibatalkan.`,
    );
    if (!ok) return;
    setError(null);
    setNotice(null);
    try {
      await deleteStudyTopic(topic.id);
      setTopics((prev) => prev.filter((item) => item.id !== topic.id));
      if (selectedId === topic.id) setSelectedId(null);
      setNotice("Topik dihapus.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus topik.");
    }
  }

  const active = topics.filter((topic) => topic.status === "active");
  const other = topics.filter((topic) => topic.status !== "active");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-16 md:px-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight font-brand">
              Belajar
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Impor materi, susun ringkasan, kuis, rencana harian, review, dan
              target. Cocok untuk CPNS atau topik lain.
            </p>
          </div>
          {!selected && (
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
            >
              {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {showForm ? "Tutup" : "Tambah"}
            </button>
          )}
        </div>

        {showForm && !selected && (
          <form
            onSubmit={submit}
            className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3"
          >
            <div>
              <label htmlFor="study-title" className="block text-[12px] text-muted">
                Topik
              </label>
              <input
                id="study-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Contoh: CPNS - TWK Pancasila"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="study-subject" className="block text-[12px] text-muted">
                  Kategori (opsional)
                </label>
                <input
                  id="study-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="CPNS / Kursus Python"
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label htmlFor="study-target" className="block text-[12px] text-muted">
                  Tanggal target (opsional)
                </label>
                <input
                  id="study-target"
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
            </div>
            <div>
              <label htmlFor="study-goal" className="block text-[12px] text-muted">
                Target belajar (opsional)
              </label>
              <textarea
                id="study-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={2}
                placeholder="Contoh: lulus SKD, paham dasar, siap ujian"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <button type="submit" className={primaryButton}>
              Simpan topik
            </button>
          </form>
        )}

        {notice && (
          <p className="mt-3 rounded-lg border border-border px-3 py-2 text-[12px] text-muted">
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        )}

        {selected ? (
          <TopicDetail
            topic={selected}
            notes={notes}
            focus={focus}
            busy={busy}
            answers={answers}
            grade={grade}
            onNotes={setNotes}
            onFocus={setFocus}
            onAnswer={(index, option) =>
              setAnswers((prev) => {
                const next = [...prev];
                next[index] = option;
                return next;
              })
            }
            onBack={() => {
              setSelectedId(null);
              setNotice(null);
              setGrade(null);
            }}
            onSaveNotes={() =>
              void run(
                "notes",
                () => updateStudyTopic(selected.id, { notes }),
                "Catatan disimpan.",
              )
            }
            onEditInfo={(patch) =>
              void run(
                "edit",
                () => updateStudyTopic(selected.id, patch),
                "Info topik diperbarui.",
              )
            }
            onProgress={(progress) =>
              void run(
                "progress",
                () => updateStudyTopic(selected.id, { progress }),
                "Progres diperbarui.",
              )
            }
            onStatus={(status) =>
              void run(
                "status",
                () => updateStudyTopic(selected.id, { status }),
                status === "done" ? "Ditandai selesai." : "Status diperbarui.",
              )
            }
            onTarget={(value) =>
              void run(
                "target",
                () =>
                  updateStudyTopic(selected.id, { target_date: value || null }),
                "Tanggal target disimpan.",
              )
            }
            onImport={(file) =>
              void run(
                "import",
                () => importStudyMaterial(selected.id, file),
                "Materi sumber diimpor.",
              )
            }
            onGenerate={() =>
              void run(
                "generate",
                () => generateStudyMaterial(selected.id, focus.trim()),
                "Materi belajar dibuat.",
              )
            }
            onQuiz={(count, level) =>
              void run(
                "quiz",
                () => generateStudyQuiz(selected.id, count, level),
                "Kuis dibuat. Jawab lalu periksa.",
              )
            }
            onSubmitQuiz={() => void submitQuiz(selected)}
            onExplain={(index) => void explain(selected, index)}
            onDeleteHistory={(index) =>
              void run(
                "history-delete",
                () => deleteStudyQuizHistory(selected.id, index),
                "Riwayat dihapus.",
              )
            }
            onPlan={() =>
              void run(
                "plan",
                () => generateStudyPlan(selected.id),
                "Rencana harian dibuat.",
              )
            }
            onReview={(days) =>
              void run(
                "review",
                () => scheduleStudyReview(selected.id, days),
                `Review dijadwalkan ${days} hari lagi.`,
              )
            }
            onGoal={() =>
              void run(
                "goal",
                () => linkStudyGoal(selected.id),
                "Topik dijadikan target (muncul di Target & laporan harian).",
              )
            }
            onDelete={() => void remove(selected)}
          />
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2">
              <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted">
                Aktif
              </h2>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
              >
                <RefreshCw size={12} aria-hidden /> Muat ulang
              </button>
            </div>

            {showLoading && (
              <LoadingState label="Memuat topik..." variant="cards" rows={2} />
            )}

            {!loading && topics.length === 0 && (
              <div className="mt-2 rounded-lg border border-border px-4 py-6 text-center text-[14px] text-muted">
                Belum ada topik. Tambah topik seperti “CPNS - TWK” untuk mulai.
              </div>
            )}

            {active.length > 0 && (
              <TopicList
                topics={active}
                onOpen={(topic) => {
                  setSelectedId(topic.id);
                  setNotice(null);
                }}
              />
            )}

            {other.length > 0 && (
              <>
                <h2 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-muted">
                  Selesai / arsip
                </h2>
                <TopicList
                  topics={other}
                  onOpen={(topic) => {
                    setSelectedId(topic.id);
                    setNotice(null);
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TopicList({
  topics,
  onOpen,
}: {
  topics: StudyTopic[];
  onOpen: (topic: StudyTopic) => void;
}) {
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          onClick={() => onOpen(topic)}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-colors duration-150 hover:bg-surface-muted"
        >
          <span className="flex items-start gap-2">
            <BookOpen size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">
                {topic.title}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted">
                {[topic.subject, statusLabel(topic.status)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </span>
          {topic.goal && (
            <span className="line-clamp-2 text-[12px] text-muted">
              {topic.goal}
            </span>
          )}
          <span className="mt-auto flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full bg-primary"
                style={{ width: `${topic.progress}%` }}
              />
            </span>
            <span className="shrink-0 text-[11px] text-muted">
              {topic.progress}%
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TopicDetail({
  topic,
  notes,
  focus,
  busy,
  answers,
  grade,
  onNotes,
  onFocus,
  onAnswer,
  onBack,
  onSaveNotes,
  onEditInfo,
  onProgress,
  onStatus,
  onTarget,
  onImport,
  onGenerate,
  onQuiz,
  onSubmitQuiz,
  onExplain,
  onDeleteHistory,
  onPlan,
  onReview,
  onGoal,
  onDelete,
}: {
  topic: StudyTopic;
  notes: string;
  focus: string;
  busy: string | null;
  answers: number[];
  grade: StudyGradeResult | null;
  onNotes: (value: string) => void;
  onFocus: (value: string) => void;
  onAnswer: (index: number, option: number) => void;
  onBack: () => void;
  onSaveNotes: () => void;
  onEditInfo: (patch: { title: string; subject: string; goal: string }) => void;
  onProgress: (progress: number) => void;
  onStatus: (status: StudyStatus) => void;
  onTarget: (value: string) => void;
  onImport: (file: File) => void;
  onGenerate: () => void;
  onQuiz: (count: number, level: StudyQuizLevel) => void;
  onSubmitQuiz: () => void;
  onExplain: (index: number) => void;
  onDeleteHistory: (index: number) => void;
  onPlan: () => void;
  onReview: (days: number) => void;
  onGoal: () => void;
  onDelete: () => void;
}) {
  const currentDay = todayIndex(topic);
  const [tab, setTab] = useState<"materi" | "kuis" | "rencana">("materi");
  const [quizCount, setQuizCount] = useState(5);
  const [quizLevel, setQuizLevel] = useState<StudyQuizLevel>("campuran");
  const [current, setCurrent] = useState(0);
  const [shortOpen, setShortOpen] = useState<Set<number>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(topic.title);
  const [editSubject, setEditSubject] = useState(topic.subject);
  const [editGoal, setEditGoal] = useState(topic.goal);

  useEffect(() => {
    setEditTitle(topic.title);
    setEditSubject(topic.subject);
    setEditGoal(topic.goal);
    setEditOpen(false);
    setCurrent(0);
    setShortOpen(new Set());
  }, [topic.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCurrent((value) =>
      Math.min(value, Math.max(0, topic.quiz.length - 1)),
    );
  }, [topic.quiz.length]);

  function saveInfo() {
    const nextTitle = editTitle.trim();
    if (!nextTitle) return;
    onEditInfo({
      title: nextTitle,
      subject: editSubject.trim(),
      goal: editGoal.trim(),
    });
    setEditOpen(false);
  }

  const total = topic.quiz.length;
  const answeredCount = answers.filter(
    (value, index) => index < total && value !== undefined,
  ).length;
  const activeQuestion = topic.quiz[current];
  const activeResult = grade?.results[current];

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft size={13} aria-hidden /> Semua topik
      </button>

      <div className="mt-2 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold">{topic.title}</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {[topic.subject, statusLabel(topic.status)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {topic.goal && (
              <p className="mt-2 text-[13px] text-muted">Target: {topic.goal}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditOpen((value) => !value)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
            >
              <Pencil size={12} aria-hidden /> Ubah
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[12px] text-muted transition-colors duration-150 hover:text-danger"
            >
              <Trash2 size={12} aria-hidden /> Hapus
            </button>
          </div>
        </div>

        {editOpen && (
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface-muted p-3">
            <div>
              <label htmlFor="study-edit-title" className="block text-[12px] text-muted">
                Judul
              </label>
              <input
                id="study-edit-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="study-edit-subject" className="block text-[12px] text-muted">
                  Kategori
                </label>
                <input
                  id="study-edit-subject"
                  value={editSubject}
                  onChange={(event) => setEditSubject(event.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label htmlFor="study-edit-goal" className="block text-[12px] text-muted">
                  Target belajar
                </label>
                <textarea
                  id="study-edit-goal"
                  value={editGoal}
                  onChange={(event) => setEditGoal(event.target.value)}
                  rows={1}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy === "edit" || !editTitle.trim()}
                onClick={saveInfo}
                className={primaryButton}
              >
                {busy === "edit" ? "Menyimpan..." : "Simpan perubahan"}
              </button>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className={chipClass}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>Progres</span>
            <span>{topic.progress}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${topic.progress}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {[0, 25, 50, 75, 100].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onProgress(value)}
                aria-pressed={topic.progress === value}
                className={`inline-flex h-7 items-center rounded-lg border px-2 text-[11px] ${
                  topic.progress === value
                    ? "border-foreground/40 bg-surface-muted text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {value}%
              </button>
            ))}
            {topic.status === "active" ? (
              <button
                type="button"
                onClick={() => onStatus("done")}
                className={`${chipClass} gap-1`}
              >
                <Check size={12} aria-hidden /> Tandai selesai
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStatus("active")}
                className={chipClass}
              >
                Aktifkan lagi
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="study-target-date" className="block text-[12px] text-muted">
              Tanggal target ujian/selesai
            </label>
            <input
              id="study-target-date"
              type="date"
              value={topic.target_date ?? ""}
              onChange={(event) => onTarget(event.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <span className="block text-[12px] text-muted">Target (Goal)</span>
            <button
              type="button"
              disabled={Boolean(topic.goal_id) || busy === "goal"}
              onClick={onGoal}
              className={`mt-1 ${chipClass} gap-1 ${topic.goal_id ? "text-foreground" : ""}`}
            >
              <Target size={12} aria-hidden />
              {topic.goal_id ? "Tersambung ke Target" : "Jadikan Target"}
            </button>
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Bagian belajar"
        className="mt-4 flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {(
          [
            { key: "materi", label: "Materi" },
            { key: "kuis", label: "Kuis" },
            { key: "rencana", label: "Rencana" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
            {key === "kuis" && topic.quiz.length > 0 && (
              <span className="ml-1.5 text-[11px] opacity-70">
                {topic.quiz.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "materi" && (
        <>
          {/* Import source */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
              <Upload size={13} aria-hidden /> Materi sumber
            </h3>
            <p className="mt-1 text-[12px] text-muted">
              {topic.source_filename
                ? `${topic.source_filename} · ${topic.source_chars.toLocaleString("id-ID")} karakter`
                : "Impor PDF/TXT/MD agar materi dan soal mengikuti sumber aslinya."}
            </p>
            <label
              className={`mt-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground ${
                busy === "import" ? "opacity-50" : ""
              }`}
            >
              <Upload size={12} aria-hidden />
              {busy === "import" ? "Mengimpor..." : "Pilih file"}
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json"
                className="sr-only"
                disabled={busy === "import"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImport(file);
                  event.target.value = "";
                }}
              />
            </label>
          </section>

          {/* Material */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
              <Sparkles size={13} aria-hidden /> Materi belajar
            </h3>
            <div className="mt-2">
              <label htmlFor="study-focus" className="block text-[12px] text-muted">
                Fokus materi (opsional)
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id="study-focus"
                  value={focus}
                  onChange={(event) => onFocus(event.target.value)}
                  placeholder="Contoh: fokus soal deret angka"
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={busy === "generate"}
                  onClick={onGenerate}
                  className={`${primaryButton} shrink-0`}
                >
                  <Sparkles size={14} aria-hidden />
                  {busy === "generate"
                    ? "Menyusun..."
                    : topic.material
                      ? "Buat ulang materi"
                      : "Buat materi"}
                </button>
              </div>
            </div>
            {busy === "generate" && (
              <p className="mt-3 text-[13px] text-muted" role="status">
                Menyusun materi belajar...
              </p>
            )}
            {topic.material ? (
              <div className="mt-3">
                <Markdown content={topic.material} />
              </div>
            ) : (
              busy !== "generate" && (
                <p className="mt-3 text-[13px] text-muted">
                  Belum ada materi. Impor sumber atau klik “Buat materi”.
                </p>
              )
            )}
          </section>

          {/* Notes */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <label htmlFor="study-notes" className="block text-[12px] text-muted">
              Catatan pribadi
            </label>
            <textarea
              id="study-notes"
              value={notes}
              onChange={(event) => onNotes(event.target.value)}
              rows={3}
              placeholder="Rangkuman atau hal yang ingin diingat"
              className={`mt-1 ${inputClass}`}
            />
            <button
              type="button"
              disabled={busy === "notes"}
              onClick={onSaveNotes}
              className={`mt-2 ${chipClass}`}
            >
              Simpan catatan
            </button>
          </section>
        </>
      )}

      {tab === "kuis" && (
        <>
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
                <ListChecks size={13} aria-hidden /> Kuis
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {topic.quiz.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setShortOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(current)) next.delete(current);
                          else next.add(current);
                          return next;
                        })
                      }
                      className={chipClass}
                    >
                      <BookOpen size={12} aria-hidden />
                      {shortOpen.has(current) ? "Sembunyikan" : "Jelaskan"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy === "explain" ||
                        Boolean(topic.quiz[current]?.detail)
                      }
                      onClick={() => onExplain(current)}
                      className={chipClass}
                    >
                      <Sparkles size={12} aria-hidden />
                      {busy === "explain"
                        ? "Menjelaskan..."
                        : topic.quiz[current]?.detail
                          ? "Penjelasan lengkap siap"
                          : "Penjelasan Lengkap"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy === "quiz"}
                  onClick={() => onQuiz(quizCount, quizLevel)}
                  className={primaryButton}
                >
                  <Sparkles size={14} aria-hidden />
                  {busy === "quiz"
                    ? "Menyusun..."
                    : topic.quiz.length
                      ? "Buat ulang kuis"
                      : "Buat kuis"}
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[12px] text-muted">Jumlah soal</span>
                <div className="flex items-center gap-1.5">
                  {[5, 10, 15].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuizCount(value)}
                      aria-pressed={quizCount === value}
                      className={`inline-flex h-7 items-center rounded-lg border px-2.5 text-[12px] ${
                        quizCount === value
                          ? "border-foreground/40 bg-surface-muted text-foreground"
                          : "border-border text-muted hover:text-foreground"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[12px] text-muted">Tingkat</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUIZ_LEVEL_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuizLevel(value)}
                      aria-pressed={quizLevel === value}
                      className={`inline-flex h-7 items-center rounded-lg border px-2.5 text-[12px] ${
                        quizLevel === value
                          ? "border-foreground/40 bg-surface-muted text-foreground"
                          : "border-border text-muted hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {quizLevel === "campuran" && (
                <p className="text-[12px] text-muted">
                  Campuran: 30% mudah · 50% sedang · 20% sulit.
                </p>
              )}
            </div>

            {topic.quiz.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                Belum ada kuis. Kuis dibuat dari topik/materi; buat materi atau impor
                sumber dulu agar soal lebih akurat.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-4 lg:self-start">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[12px] font-medium uppercase tracking-wide text-muted">
                      Bank soal
                    </h4>
                    <span className="text-[11px] text-muted">
                      {answeredCount}/{total}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-6 gap-1.5 lg:grid-cols-5">
                    {topic.quiz.map((_, index) => {
                      const result = grade?.results[index];
                      const answered = answers[index] !== undefined;
                      let tone =
                        "border-border text-muted hover:text-foreground";
                      if (result) {
                        tone = result.correct
                          ? "border-success/60 bg-success/10 text-success"
                          : "border-danger/60 bg-danger/10 text-danger";
                      } else if (answered) {
                        tone = "border-primary/50 bg-primary/10 text-foreground";
                      } else if (index === current) {
                        tone = "border-foreground/40 text-foreground";
                      }
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setCurrent(index)}
                          aria-label={`Soal ${index + 1}`}
                          aria-current={index === current}
                          className={`inline-flex h-8 items-center justify-center rounded-md border text-[12px] ${tone} ${
                            index === current ? "ring-1 ring-foreground/40" : ""
                          }`}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 space-y-1 text-[11px] text-muted">
                    <p className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded border border-primary/50 bg-primary/10" />
                      Terjawab
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded border border-border" />
                      Belum dijawab
                    </p>
                    {grade && (
                      <>
                        <p className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded border border-success/60 bg-success/10" />
                          Benar
                        </p>
                        <p className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded border border-danger/60 bg-danger/10" />
                          Salah
                        </p>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy === "grade" || answeredCount === 0}
                    onClick={onSubmitQuiz}
                    className={`mt-3 w-full ${primaryButton}`}
                  >
                    <Check size={14} aria-hidden />
                    {busy === "grade" ? "Menilai..." : "Periksa jawaban"}
                  </button>
                  {grade && (
                    <p className="mt-2 text-center text-[12px] text-muted">
                      Skor {grade.score}% ({grade.correct}/{grade.total})
                    </p>
                  )}
                </aside>

                <section className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center justify-between text-[12px] text-muted">
                    <span>
                      Soal {current + 1} dari {total}
                    </span>
                    {activeResult && (
                      <span
                        className={
                          activeResult.correct ? "text-success" : "text-danger"
                        }
                      >
                        {activeResult.correct ? "Benar" : "Salah"}
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-[15px] font-medium leading-relaxed">
                    <MathText content={activeQuestion.question} />
                  </p>

                  <div className="mt-3 space-y-1.5">
                    {activeQuestion.options.map((option, oIndex) => {
                      const picked = answers[current] === oIndex;
                      const correctOption =
                        activeResult && activeResult.answer === oIndex;
                      const wrongPick =
                        activeResult && picked && !activeResult.correct;
                      const letter = String.fromCharCode(65 + oIndex);
                      return (
                        <label
                          key={oIndex}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[14px] ${
                            correctOption
                              ? "border-success/50 text-foreground"
                              : wrongPick
                                ? "border-danger/50 text-danger"
                                : picked
                                  ? "border-foreground/40 bg-surface-muted text-foreground"
                                  : "border-border text-muted"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q-${topic.id}-${current}`}
                            checked={picked}
                            onChange={() => onAnswer(current, oIndex)}
                            className="mt-1 h-3.5 w-3.5 shrink-0 accent-foreground"
                          />
                          <span className="min-w-0">
                            <span className="mr-1.5 font-medium text-muted">
                              {letter}.
                            </span>
                            <MathText content={option} />
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {shortOpen.has(current) && activeQuestion.explanation && (
                    <div className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px] text-muted">
                      <MathText content={activeQuestion.explanation} />
                    </div>
                  )}

                  {activeQuestion.detail && (
                    <div className="mt-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px]">
                      <Markdown content={activeQuestion.detail} />
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={current === 0}
                      onClick={() => setCurrent((value) => Math.max(0, value - 1))}
                      className={chipClass}
                    >
                      <ArrowLeft size={12} aria-hidden /> Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={current >= total - 1}
                      onClick={() =>
                        setCurrent((value) => Math.min(total - 1, value + 1))
                      }
                      className={chipClass}
                    >
                      Berikutnya <ArrowRight size={12} aria-hidden />
                    </button>
                  </div>
                </section>
              </div>
            )}
          </section>

          {/* Quiz history */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
              <History size={13} aria-hidden /> Riwayat kuis
            </h3>
            {topic.quiz_history.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                Belum ada riwayat. Kerjakan kuis lalu periksa jawaban.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {[...topic.quiz_history].reverse().map((attempt, index) => {
                  const realIndex = topic.quiz_history.length - 1 - index;
                  const levelLabel =
                    QUIZ_LEVEL_OPTIONS.find(
                      (option) => option.value === attempt.level,
                    )?.label ?? attempt.level;
                  return (
                    <li
                      key={realIndex}
                      className="flex items-center justify-between gap-3 py-2 text-[13px]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-muted">
                          {attempt.at
                            ? new Date(attempt.at).toLocaleString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-muted">
                          {attempt.count > 0 ? `${attempt.count} soal` : "—"}
                          {levelLabel ? ` · ${levelLabel}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted">
                          {attempt.correct}/{attempt.total}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[12px] ${
                            attempt.score >= 70
                              ? "border-success/50 text-success"
                              : "border-border text-muted"
                          }`}
                        >
                          {attempt.score}%
                        </span>
                        <button
                          type="button"
                          disabled={busy === "history-delete"}
                          onClick={() => onDeleteHistory(realIndex)}
                          aria-label="Hapus riwayat"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-colors duration-150 hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "rencana" && (
        <>
          {/* Plan */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
                <CalendarCheck size={13} aria-hidden /> Rencana harian
              </h3>
              <button
                type="button"
                disabled={busy === "plan"}
                onClick={onPlan}
                className={chipClass}
              >
                {busy === "plan"
                  ? "Menyusun..."
                  : topic.plan.length
                    ? "Buat ulang rencana"
                    : "Buat rencana"}
              </button>
            </div>
            {topic.plan.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                Belum ada rencana. Isi tanggal target agar rencana menyesuaikan waktu.
              </p>
            ) : (
              <ol className="mt-3 space-y-2">
                {topic.plan.map((item) => {
                  const isToday = item.day === currentDay;
                  return (
                    <li
                      key={item.day}
                      className={`rounded-lg border px-3 py-2 ${
                        isToday
                          ? "border-primary/40 bg-primary/5"
                          : "border-border"
                      }`}
                    >
                      <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                        <span className="rounded border border-border px-1.5 py-0.5">
                          Hari {item.day}
                        </span>
                        {isToday && <span className="text-primary">Hari ini</span>}
                      </p>
                      {item.focus && (
                        <p className="mt-1 text-[13px]">
                          <MathText content={item.focus} />
                        </p>
                      )}
                      {item.tasks.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-muted">
                          {item.tasks.map((task, index) => (
                            <li key={index}>
                              <MathText content={task} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Review */}
          <section className="mt-4 rounded-lg border border-border bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted">
              <RefreshCw size={13} aria-hidden /> Review terjadwal
            </h3>
            <p className="mt-1 text-[12px] text-muted">
              {topic.next_review_at
                ? `Review berikutnya: ${formatDate(topic.next_review_at)} (masuk Jadwal + Telegram/PWA).`
                : "Jadwalkan pengulangan agar materi tidak lupa."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[1, 3, 7, 14].map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={busy === "review"}
                  onClick={() => onReview(days)}
                  className={chipClass}
                >
                  +{days} hari
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}