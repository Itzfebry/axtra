import type { ReactNode } from "react";

export type LoadingVariant =
  | "list"
  | "cards"
  | "form"
  | "detail"
  | "chat"
  | "inline";

function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-surface-muted ${className}`} />;
}

function skeleton(variant: LoadingVariant, rows: number): ReactNode {
  switch (variant) {
    case "cards":
      return (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-border bg-surface p-4"
            >
              <Bar className="h-4 w-2/3" />
              <Bar className="h-3 w-full" />
              <Bar className="h-3 w-5/6" />
              <div className="flex gap-2 pt-1">
                <Bar className="h-5 w-16 rounded-full" />
                <Bar className="h-5 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      );
    case "form":
      return (
        <div className="space-y-4">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Bar className="h-3 w-24" />
              <Bar className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      );
    case "detail":
      return (
        <div className="space-y-3">
          <Bar className="h-6 w-1/3" />
          {Array.from({ length: rows }).map((_, index) => (
            <Bar
              key={index}
              className={`h-3 ${index % 3 === 2 ? "w-2/3" : "w-full"}`}
            />
          ))}
        </div>
      );
    case "chat":
      return (
        <div className="space-y-4">
          <Bar className="h-10 w-2/3 rounded-2xl" />
          <div className="flex justify-end">
            <Bar className="h-14 w-3/4 rounded-2xl" />
          </div>
          <Bar className="h-10 w-1/2 rounded-2xl" />
          <div className="flex justify-end">
            <Bar className="h-20 w-4/5 rounded-2xl" />
          </div>
        </div>
      );
    case "inline":
      return (
        <div className="flex items-center gap-2">
          <Bar className="h-3 w-3 rounded-full" />
          <Bar className="h-3 w-28" />
        </div>
      );
    case "list":
    default:
      return (
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="space-y-2 px-4 py-3">
              <Bar className="h-3 w-24" />
              <Bar className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      );
  }
}

/**
 * Informative loading state: a visible label plus a skeleton that mirrors the
 * final layout. Announced to assistive tech via role=status + aria-live.
 */
export function LoadingState({
  label = "Memuat...",
  variant = "list",
  rows = 4,
  className = "",
}: {
  label?: string;
  variant?: LoadingVariant;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`w-full ${className}`}
    >
      <span className="sr-only">{label}</span>
      <p className="mb-3 flex items-center gap-2 text-[12px] text-muted" aria-hidden>
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-border border-t-foreground motion-reduce:animate-none" />
        {label}
      </p>
      <div aria-hidden className="animate-pulse motion-reduce:animate-none">
        {skeleton(variant, rows)}
      </div>
    </div>
  );
}