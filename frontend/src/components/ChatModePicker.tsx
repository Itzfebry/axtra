import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CHAT_MODES } from "@/lib/chatModes";

export function ChatModePicker() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 pb-16">
        <header>
          <p className="text-[11px] uppercase tracking-wide text-muted">Chat</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pilih mode percakapan</h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            Setiap mode punya gaya, fitur, dan riwayat sendiri. Pengetahuan dan memori
            personal tetap dibagi di semua mode.
          </p>
        </header>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {CHAT_MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <li key={mode.id}>
                <Link
                  href={`/chat/${mode.id}`}
                  className="group flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors duration-150 hover:border-foreground/30 hover:bg-surface-muted"
                >
                  <div className="flex items-start justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-foreground transition-colors duration-150 group-hover:bg-background">
                      <Icon size={18} aria-hidden />
                    </span>
                    <ArrowRight
                      size={16}
                      aria-hidden
                      className="mt-1 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    />
                  </div>
                  <h2 className="mt-3 text-sm font-medium">{mode.label}</h2>
                  <p className="text-[12px] text-muted">{mode.tagline}</p>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    {mode.description}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {mode.capabilities.map((capability) => (
                      <li
                        key={capability}
                        className="rounded border border-border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted"
                      >
                        {capability}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-[12px] text-muted">
          Semua mode memakai memori personal yang sama. Riwayat percakapan dipisah per
          mode agar konteks tetap fokus.
        </p>
      </div>
    </div>
  );
}