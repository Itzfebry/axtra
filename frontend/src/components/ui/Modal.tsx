"use client";

import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useEffect } from "react";

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

export function Modal({
  open,
  tone = "info",
  title,
  message,
  onClose,
}: {
  open: boolean;
  tone?: ModalTone;
  title: string;
  message?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="absolute right-3 top-3 text-muted transition-colors duration-150 hover:text-foreground"
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
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex h-8 w-full items-center justify-center rounded-lg border border-border text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
