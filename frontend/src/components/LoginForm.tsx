"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { login } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <label htmlFor="password" className="sr-only">
        Kata sandi
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Masukkan password"
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "login-error" : undefined}
        className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-center text-[14px] tracking-[0.3em] text-foreground outline-none transition-colors duration-150 placeholder:tracking-normal placeholder:text-muted-3 hover:border-foreground/25 focus:border-foreground/40 focus-visible:outline-none disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={busy || !password}
        className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 font-semibold tracking-wide text-foreground backdrop-blur-md transition-[background-color,opacity,transform] duration-150 hover:bg-white/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <>
            Masuk
            <ArrowRight
              size={16}
              aria-hidden
              className="transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </>
        )}
      </button>

      <p className="pt-1 text-center text-[11px] font-medium text-muted">
        Axtra <span className="font-bold italic">by Itz AI</span> ·{" "}
        <span className="tracking-wide text-foreground [font-family:var(--font-brand)]">
          Febry Workstation
        </span>
      </p>

      {error && (
        <p
          id="login-error"
          role="alert"
          className="animate-shake rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      )}
    </form>
  );
}
