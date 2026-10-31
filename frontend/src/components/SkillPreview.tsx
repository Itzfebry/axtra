"use client";

import { Markdown } from "@/components/Markdown";

/** Read-only Markdown preview for a skill's content. */
export function SkillPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <p className="text-[12px] text-muted">Belum ada konten Markdown.</p>
    );
  }
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-surface p-3">
      <Markdown content={content} />
    </div>
  );
}
