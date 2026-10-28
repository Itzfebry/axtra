"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Suspense, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { login } from "@/lib/api";

function PasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <Image src="/axtratr.png" alt="" width={56} height={56} priority className="h-14 w-14 rounded-xl" />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Axtra</h1>
          <p className="mt-1 text-[13px] text-muted">Agen AI personal yang mengingatmu.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="password" className="sr-only">
                Kata sandi
              </label>
              <input
                id="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Kata sandi"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Memeriksa..." : "Masuk"}
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          )}

          <p className="mt-4 text-[12px] text-muted">
            Akses pribadi. Satu kata sandi untuk semua data.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <PasswordForm />
    </Suspense>
  );
}
