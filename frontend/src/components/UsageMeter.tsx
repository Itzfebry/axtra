"use client";

import { ChevronDown, ChevronRight, Gauge } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchUsage, type UsageStats } from "@/lib/api";

export const USAGE_CHANGED = "axtra:usage-changed";

export function emitUsageChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(USAGE_CHANGED));
  }
}

const POLL_MS = 15000;

/** Compact Indonesian number: 1.2rb, 12.3k, 1.1jt. */
function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(".", ",")}rb`;
  if (value < 1000000) return `${Math.round(value / 1000)}rb`;
  return `${(value / 1000000).toFixed(1).replace(".", ",")}jt`;
}

function formatExact(value: number): string {
  return value.toLocaleString("id-ID");
}

function percent(value: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

function resetLabel(iso: string): string {
  try {
    const time = new Date(iso).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    });
    return `Reset ${time} WIB`;
  } catch {
    return "Reset 00:00 WIB";
  }
}

export function UsageMeter({
  variant = "navbar",
  collapsed = false,
  onToggle,
}: {
  variant?: "navbar" | "sidebar";
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [usage, setUsage] = useState<UsageStats | null>(null);

  const load = useCallback(async () => {
    try {
      setUsage(await fetchUsage());
    } catch {
      // Usage telemetry is non-critical; keep the last value on failure.
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(USAGE_CHANGED, onChange);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.removeEventListener(USAGE_CHANGED, onChange);
      window.clearInterval(timer);
    };
  }, [load]);

  if (variant === "navbar") {
    const minute = usage?.minute_tokens ?? 0;
    const limit = usage?.minute_limit ?? 0;
    const title = usage
      ? [
          `Model: ${usage.model}`,
          `TPM (60 dtk): ${formatExact(minute)}${limit > 0 ? ` dari ${formatExact(limit)}` : ""} token`,
          `Hari ini: ${formatExact(usage.day_tokens)}${usage.day_limit > 0 ? ` dari ${formatExact(usage.day_limit)}` : ""} token`,
          resetLabel(usage.day_reset_at),
        ].join("\n")
      : "Memuat pemakaian token...";

    return (
      <div
        title={title}
        aria-label="Pemakaian token per menit"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2 text-[12px] text-muted"
      >
        <Gauge size={14} aria-hidden className="shrink-0" />
        <span className="tabular-nums text-foreground">{formatTokens(minute)}</span>
        {limit > 0 && <span className="tabular-nums">/ {formatTokens(limit)}</span>}
        <span className="hidden sm:inline">TPM</span>
      </div>
    );
  }

  const minute = usage?.minute_tokens ?? 0;
  const minuteLimit = usage?.minute_limit ?? 0;
  const day = usage?.day_tokens ?? 0;
  const dayLimit = usage?.day_limit ?? 0;

  return (
    <section
      aria-label="Pemakaian token"
      className="rounded-lg border border-border bg-background px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Perluas pemakaian token" : "Ciutkan pemakaian token"}
            title={collapsed ? "Perluas" : "Ciutkan"}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted transition-colors duration-150 hover:text-foreground"
          >
            <Gauge size={13} aria-hidden />
            Token
            {collapsed ? (
              <ChevronRight size={13} aria-hidden />
            ) : (
              <ChevronDown size={13} aria-hidden />
            )}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
            <Gauge size={13} aria-hidden />
            Token
          </span>
        )}
        {collapsed ? (
          <span className="truncate text-[11px] tabular-nums text-muted">
            {formatTokens(minute)} TPM
          </span>
        ) : (
          usage && (
            <span className="truncate text-[11px] text-muted" title={usage.model}>
              {usage.model}
            </span>
          )
        )}
      </div>

      {!collapsed && (
        <>
          <UsageRow
            label="Per menit"
            value={minute}
            limit={minuteLimit}
            suffix="TPM"
          />
          <UsageRow
            label="Hari ini"
            value={day}
            limit={dayLimit}
            suffix="hari"
          />

          {usage && (
            <p className="mt-1.5 text-[11px] text-muted">
              {resetLabel(usage.day_reset_at)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function UsageRow({
  label,
  value,
  limit,
  suffix,
}: {
  label: string;
  value: number;
  limit: number;
  suffix: string;
}) {
  const pct = percent(value, limit);
  const critical = pct >= 90;
  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-foreground">
          {formatExact(value)}
          {limit > 0 && <span className="text-muted"> / {formatExact(limit)}</span>}
          <span className="ml-1 text-muted">{suffix}</span>
        </span>
      </div>
      {limit > 0 && (
        <div
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} ${pct}%`}
        >
          <div
            className={`h-full rounded-full ${critical ? "bg-danger" : "bg-foreground"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
