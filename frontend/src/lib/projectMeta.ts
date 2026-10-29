/** Shared project UI constants (list page + detail page). */

import type { Project, ProjectStatus } from "@/lib/api";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "idea",
  "active",
  "paused",
  "done",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Ide",
  active: "Aktif",
  paused: "Jeda",
  done: "Selesai",
};

export const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  idea: "border-border text-muted",
  active: "border-emerald-500/40 text-emerald-500",
  paused: "border-amber-500/40 text-amber-500",
  done: "border-sky-500/40 text-sky-500",
};

export type RepoIndexStatus = Project["repo_index_status"];

export const REPO_STATUS_LABELS: Record<RepoIndexStatus, string> = {
  none: "Belum di-index",
  pending: "Dalam antrean",
  indexing: "Mengindeks...",
  ready: "Siap ditanya",
  error: "Gagal",
};

export const PROJECT_INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

export const PROJECT_LABEL_CLASS = "block text-[12px] text-muted";