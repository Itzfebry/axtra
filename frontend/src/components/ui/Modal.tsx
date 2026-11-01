"use client";

import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";

export type ModalTone = "success" | "error" | "info";

const TONE = {
  success: {
    Icon: Check,
    ring: "border-success/40 bg-success/5 text-success",
  },
  error: {
    Icon: AlertTriangle,
    ring: "border-danger/40 bg-danger/5 text-danger",
  },
  info: {
    Icon: Info,
    ring: "border-border bg-surface text-muted",
  },
} as const;

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  tone = "info",
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = "Hapus",
  cancelLabel = "Batal",
  busy = false,
}: {
  open: boolean;
  tone?: ModalTone;
  title: string;
  message?: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    if (!node) return;
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    const initial = focusable()[0];
    initial?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;
  const { Icon, ring } = TONE[tone];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Tutup"
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        ref={panelRef}
        className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Tutup"
          className="absolute right-3 top-3 text-muted transition-colors duration-150 hover:text-foreground disabled:opacity-40"
        >
          <X size={14} aria-hidden />
        </button>
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${ring}`}
        >
          <Icon size={16} aria-hidden />
        </div>
        <h2 className="mt-3 text-[14px] font-medium text-foreground">{title}</h2>
        {message && (
          <p className="mt-1 break-words text-[12px] text-muted">{message}</p>
        )}

        {onConfirm ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-border text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:opacity-40"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger text-[12px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
              {confirmLabel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 inline-flex h-8 w-full items-center justify-center rounded-lg border border-border text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
          >
            Tutup
          </button>
        )}
      </div>
    </div>
  );
}
