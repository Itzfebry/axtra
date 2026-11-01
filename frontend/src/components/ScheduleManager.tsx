"use client";

import {
  BellRing,
  CalendarClock,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LoadingState } from "@/components/ui/LoadingState";
import {
  cancelSchedule,
  completeSchedule,
  createSchedule,
  deleteSchedule,
  fetchPushConfig,
  fetchSchedules,
  snoozeSchedule,
  testPush,
  updateSchedule,
  type Schedule,
} from "@/lib/api";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupported,
} from "@/lib/push";
import { useDelayedFlag } from "@/lib/useDelayedFlag";

type Kind = "once" | "timer";
type DueMode = "relative" | "absolute";

const QUICK_MINUTES = [5, 10, 15, 30, 60];

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human countdown like "2j 05m" / "3m 20d" / "terlambat". */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "sekarang";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}d`;
  return `${secs}d`;
}

function localDatetimeValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedFlag(loading);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<Kind>("once");
  const [dueMode, setDueMode] = useState<DueMode>("relative");
  const [minutes, setMinutes] = useState(30);
  const [dueAt, setDueAt] = useState(() =>
    localDatetimeValue(new Date(Date.now() + 3600000)),
  );
  const [channels, setChannels] = useState({ telegram: true, push: true });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDueAt, setEditDueAt] = useState("");

  const [pushOn, setPushOn] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const supported = useMemo(() => pushSupported(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSchedules();
      setSchedules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat jadwal.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live countdown clock (only while the tab is open).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Refresh the list when a schedule's countdown crosses zero.
  useEffect(() => {
    const dueSoon = schedules.some(
      (item) =>
        item.status === "active" &&
        item.due_in_seconds !== null &&
        item.due_in_seconds <= 0,
    );
    if (dueSoon) {
      const timer = window.setTimeout(() => void load(), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [now, schedules, load]);

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const [config, enabled] = await Promise.all([
          fetchPushConfig(),
          isPushEnabled(),
        ]);
        setPushReady(config.enabled);
        setPushOn(enabled);
      } catch {
        // Push is optional; ignore.
      }
    })();
  }, [supported]);

  const active = schedules.filter((item) => item.status === "active");
  const history = schedules.filter((item) => item.status !== "active");

  const selectedChannels = Object.entries(channels)
    .filter(([, value]) => value)
    .map(([name]) => name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (selectedChannels.length === 0) {
      setError("Pilih minimal satu kanal notifikasi.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const input = {
        title: title.trim(),
        note: note.trim(),
        kind,
        channels: selectedChannels,
        ...(kind === "timer" || dueMode === "relative"
          ? { due_in_minutes: Math.max(1, Math.round(minutes)) }
          : { due_at: new Date(dueAt).toISOString() }),
      };
      await createSchedule(input);
      setTitle("");
      setNote("");
      setShowForm(false);
      setNotice("Jadwal dibuat.");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat jadwal.");
    }
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aksi gagal.");
    }
  }

  async function remove(schedule: Schedule) {
    const ok = window.confirm(
      `Hapus jadwal "${schedule.title}" permanen?\n\nTindakan ini tidak dapat dibatalkan.`,
    );
    if (!ok) return;
    setSchedules((prev) => prev.filter((item) => item.id !== schedule.id));
    await run(() => deleteSchedule(schedule.id), "Jadwal dihapus.");
  }

  function startEdit(schedule: Schedule) {
    setEditingId(schedule.id);
    setEditTitle(schedule.title);
    setEditNote(schedule.note);
    setEditDueAt(localDatetimeValue(new Date(schedule.due_at)));
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return;
    await run(
      () =>
        updateSchedule(id, {
          title: editTitle.trim(),
          note: editNote.trim(),
          due_at: new Date(editDueAt).toISOString(),
        }),
      "Jadwal diperbarui.",
    );
    setEditingId(null);
  }

  async function togglePush() {
    setPushBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        setNotice("Notifikasi PWA dinonaktifkan.");
      } else {
        await enablePush();
        setPushOn(true);
        setNotice("Notifikasi PWA diaktifkan.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah notifikasi PWA.");
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTest() {
    await run(() => testPush(), "Notifikasi uji dikirim (cek perangkat).");
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";
  const chipClass =
    "inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-16">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight font-brand">Jadwal</h1>
            <p className="mt-1 text-[14px] text-muted">
              Pengingat sekali waktu dan timer. Dikirim ke Telegram dan notifikasi PWA.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
          >
            {showForm ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
            {showForm ? "Tutup" : "Tambah"}
          </button>
        </div>

        {/* PWA push toggle */}
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <BellRing size={16} className="text-muted" aria-hidden />
            <div>
              <p className="text-[13px] font-medium">Notifikasi PWA</p>
              <p className="text-[12px] text-muted">
                {!supported
                  ? "Browser ini tidak mendukung Web Push."
                  : !pushReady
                    ? "Belum dikonfigurasi di server (VAPID)."
                    : pushOn
                      ? "Aktif di perangkat ini."
                      : "Nonaktif di perangkat ini."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {supported && pushOn && pushReady && (
              <button type="button" onClick={() => void sendTest()} className={chipClass}>
                Uji
              </button>
            )}
            <button
              type="button"
              disabled={!supported || !pushReady || pushBusy}
              onClick={() => void togglePush()}
              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
            >
              {pushOn ? "Nonaktifkan" : "Aktifkan"}
            </button>
          </div>
        </section>

        {showForm && (
          <form
            onSubmit={submit}
            className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-3"
          >
            <div>
              <label htmlFor="sch-title" className="block text-[12px] text-muted">
                Judul
              </label>
              <input
                id="sch-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Contoh: minum obat"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="sch-note" className="block text-[12px] text-muted">
                Catatan (opsional)
              </label>
              <textarea
                id="sch-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Detail tambahan"
                className={`mt-1 ${inputClass}`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted">Jenis</span>
              <button
                type="button"
                onClick={() => {
                  setKind("once");
                  setDueMode("absolute");
                }}
                aria-pressed={kind === "once"}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12px] ${
                  kind === "once"
                    ? "border-foreground/40 bg-surface-muted text-foreground"
                    : "border-border text-muted"
                }`}
              >
                <CalendarClock size={13} aria-hidden /> Pengingat
              </button>
              <button
                type="button"
                onClick={() => {
                  setKind("timer");
                  setDueMode("relative");
                }}
                aria-pressed={kind === "timer"}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12px] ${
                  kind === "timer"
                    ? "border-foreground/40 bg-surface-muted text-foreground"
                    : "border-border text-muted"
                }`}
              >
                <Timer size={13} aria-hidden /> Timer
              </button>
            </div>

            {kind === "timer" || dueMode === "relative" ? (
              <div>
                <label htmlFor="sch-minutes" className="block text-[12px] text-muted">
                  Dalam (menit)
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    id="sch-minutes"
                    type="number"
                    min={1}
                    value={minutes}
                    onChange={(event) => setMinutes(Number(event.target.value))}
                    className={`w-24 ${inputClass}`}
                  />
                  {QUICK_MINUTES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMinutes(value)}
                      className={chipClass}
                    >
                      +{value}m
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="sch-due" className="block text-[12px] text-muted">
                  Waktu
                </label>
                <input
                  id="sch-due"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] text-muted">Kanal</span>
              <label className="inline-flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={channels.telegram}
                  onChange={(event) =>
                    setChannels((prev) => ({ ...prev, telegram: event.target.checked }))
                  }
                  className="h-3.5 w-3.5 accent-foreground"
                />
                Telegram
              </label>
              <label className="inline-flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={channels.push}
                  onChange={(event) =>
                    setChannels((prev) => ({ ...prev, push: event.target.checked }))
                  }
                  className="h-3.5 w-3.5 accent-foreground"
                />
                PWA
              </label>
            </div>

            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90"
            >
              Simpan
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

        {showLoading && <LoadingState label="Memuat jadwal..." variant="list" rows={4} />}

        {!loading && active.length === 0 && (
          <div className="mt-2 rounded-lg border border-border px-4 py-6 text-center text-[14px] text-muted">
            Belum ada jadwal aktif. Tambah pengingat atau timer.
          </div>
        )}

        {active.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {active.map((schedule) => {
              const remaining =
                schedule.due_in_seconds !== null
                  ? Math.round(
                      (new Date(schedule.due_at).getTime() - now) / 1000,
                    )
                  : null;
              return (
                <li key={schedule.id} className="px-4 py-3">
                  {editingId === schedule.id ? (
                    <div className="space-y-2">
                      <input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        className={inputClass}
                        aria-label="Judul"
                      />
                      <textarea
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                        rows={2}
                        className={inputClass}
                        aria-label="Catatan"
                      />
                      <input
                        type="datetime-local"
                        value={editDueAt}
                        onChange={(event) => setEditDueAt(event.target.value)}
                        className={inputClass}
                        aria-label="Waktu"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEdit(schedule.id)}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className={chipClass}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                          {schedule.kind === "timer" ? (
                            <Timer size={11} aria-hidden />
                          ) : (
                            <CalendarClock size={11} aria-hidden />
                          )}
                          {schedule.kind === "timer" ? "Timer" : "Pengingat"}
                        </span>
                        <span>{schedule.channels.join(" + ")}</span>
                        <span>· {formatDue(schedule.due_at)}</span>
                        {remaining !== null && (
                          <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
                            {remaining <= 0
                              ? "menunggu diproses"
                              : formatCountdown(remaining)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[14px]">{schedule.title}</p>
                      {schedule.note && (
                        <p className="text-[13px] text-muted">{schedule.note}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-muted">Tunda:</span>
                        {[5, 10, 30].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              void run(
                                () => snoozeSchedule(schedule.id, value),
                                `Ditunda ${value} menit.`,
                              )
                            }
                            className={chipClass}
                          >
                            +{value}m
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              () => completeSchedule(schedule.id),
                              "Ditandai selesai.",
                            )
                          }
                          className={`${chipClass} gap-1`}
                        >
                          <Check size={12} aria-hidden /> Selesai
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(schedule)}
                          className={`${chipClass} gap-1`}
                        >
                          <Pencil size={12} aria-hidden /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              () => cancelSchedule(schedule.id),
                              "Jadwal dibatalkan.",
                            )
                          }
                          className={chipClass}
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(schedule)}
                          className={`${chipClass} gap-1 hover:text-danger`}
                        >
                          <Trash2 size={12} aria-hidden /> Hapus
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 && (
          <>
            <h2 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-muted">
              Riwayat
            </h2>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {history.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-muted">{schedule.title}</p>
                    <p className="text-[11px] text-muted">
                      {schedule.status === "done" ? "Selesai" : "Dibatalkan"} ·{" "}
                      {formatDue(schedule.due_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(schedule)}
                    className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors duration-150 hover:text-danger"
                  >
                    <Trash2 size={13} aria-hidden /> Hapus
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
