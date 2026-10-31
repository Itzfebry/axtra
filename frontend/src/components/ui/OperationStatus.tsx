"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export type OperationStep = {
  label: string;
  /** Seconds after start when this step becomes active. */
  at: number;
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} dtk`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

/**
 * Informative status block for one-shot async actions (crawl, upload, AI
 * generation). Real byte progress is used when the caller has it; otherwise
 * the bar is indeterminate and the steps advance with elapsed time.
 */
export function OperationStatus({
  active,
  title,
  steps,
  progress = null,
  note,
}: {
  active: boolean;
  title: string;
  steps: OperationStep[];
  /** 0-100 for measurable work (uploads). Null means indeterminate. */
  progress?: number | null;
  note?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const activeIndex = steps.reduce(
    (current, step, index) => (elapsed >= step.at ? index : current),
    0,
  );
  const clamped =
    progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2.5 rounded-xl border border-primary/25 bg-primary/5 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 size={14} className="shrink-0 animate-spin text-primary" aria-hidden />
          <p className="truncate text-[12px] font-medium">{title}</p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {formatElapsed(elapsed)}
          {clamped != null ? ` · ${clamped}%` : ""}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        {clamped == null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>

      <ol className="mt-2 space-y-1">
        {steps.map((step, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          return (
            <li
              key={step.label}
              className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                done || current ? "text-foreground" : "text-muted/70"
              }`}
            >
              {done ? (
                <Check size={11} className="mt-0.5 shrink-0 text-success" aria-hidden />
              ) : current ? (
                <Loader2
                  size={11}
                  className="mt-0.5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
              ) : (
                <span
                  className="mt-1 h-1 w-1 shrink-0 rounded-full bg-current"
                  aria-hidden
                />
              )}
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {note && <p className="mt-1.5 text-[10px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}