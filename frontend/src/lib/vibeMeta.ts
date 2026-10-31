/** Shared Vibe Coding labels and badge styles. */

import type {
  VibeArtifactKind,
  VibeArtifactStatus,
  VibeDecisionStatus,
  VibeStage,
  VibeVerificationStatus,
} from "@/lib/api";

export const VIBE_ARTIFACT_KINDS: VibeArtifactKind[] = [
  "PRD",
  "ARCHITECTURE",
  "ACCEPTANCE_TEST_PLAN",
  "UI_UX_SPEC",
  "AGENT_INSTRUCTIONS",
  "IMPLEMENTATION_PLAN",
  "DEFINITION_OF_DONE",
];

export const VIBE_ARTIFACT_LABELS: Record<VibeArtifactKind, string> = {
  PRD: "PRD",
  ARCHITECTURE: "Arsitektur",
  ACCEPTANCE_TEST_PLAN: "Test Plan",
  UI_UX_SPEC: "UI/UX",
  AGENT_INSTRUCTIONS: "Instruksi Agen",
  IMPLEMENTATION_PLAN: "Rencana Implementasi",
  DEFINITION_OF_DONE: "Definition of Done",
};

export const VIBE_ARTIFACT_HINTS: Record<VibeArtifactKind, string> = {
  PRD: "Tujuan, pengguna, requirement, scope, risiko.",
  ARCHITECTURE: "Stack, modul, data model, API, keamanan.",
  ACCEPTANCE_TEST_PLAN: "Acceptance, happy/negative/edge case.",
  UI_UX_SPEC: "Layar, interaksi, state, aksesibilitas.",
  AGENT_INSTRUCTIONS: "Aturan repo, dependency, keamanan.",
  IMPLEMENTATION_PLAN: "Task, dependencies, urutan kerja.",
  DEFINITION_OF_DONE: "Quality gate dan bukti penyelesaian.",
};

export const VIBE_ARTIFACT_STATUS_CLASSES: Record<VibeArtifactStatus, string> = {
  DRAFT: "border-border text-muted",
  NEEDS_REVIEW: "border-amber-500/50 text-amber-500",
  APPROVED: "border-emerald-500/40 text-emerald-500",
  STALE: "border-sky-500/40 text-sky-500",
};

export const VIBE_DECISION_LABELS: Record<VibeDecisionStatus, string> = {
  CONFIRMED: "Terkonfirmasi",
  ASSUMED: "Asumsi",
  RESEARCH: "Riset",
  NEEDS_DECISION: "Perlu keputusan",
  VALIDATION_REQUIRED: "Perlu validasi",
};

export const VIBE_DECISION_CLASSES: Record<VibeDecisionStatus, string> = {
  CONFIRMED: "border-emerald-500/40 text-emerald-500",
  ASSUMED: "border-border text-muted",
  RESEARCH: "border-sky-500/40 text-sky-500",
  NEEDS_DECISION: "border-amber-500/50 text-amber-500",
  VALIDATION_REQUIRED: "border-rose-500/50 text-rose-500",
};

export const VIBE_VERIFICATION_LABELS: Record<VibeVerificationStatus, string> = {
  TODO: "Belum",
  IN_PROGRESS: "Dikerjakan",
  BLOCKED: "Terhambat",
  NEEDS_REVIEW: "Perlu review",
  DONE: "Selesai",
};

export const VIBE_VERIFICATION_CLASSES: Record<VibeVerificationStatus, string> = {
  TODO: "border-border text-muted",
  IN_PROGRESS: "border-sky-500/40 text-sky-500",
  BLOCKED: "border-rose-500/50 text-rose-500",
  NEEDS_REVIEW: "border-amber-500/50 text-amber-500",
  DONE: "border-emerald-500/40 text-emerald-500",
};

export const VIBE_STAGE_LABELS: Record<VibeStage, string> = {
  discovery: "Discovery",
  specification: "Spesifikasi",
  planning: "Perencanaan",
  verification: "Verifikasi",
};

export const VIBE_STAGE_ORDER: VibeStage[] = [
  "discovery",
  "specification",
  "planning",
  "verification",
];