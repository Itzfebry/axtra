"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { apiFetch } from "@/lib/api";

type Profile = {
  id: string;
  display_name: string | null;
  timezone: string;
  locale: string;
  communication_style: string | null;
  preferences: Record<string, string | boolean | number>;
};

const EMPTY: Profile = {
  id: "",
  display_name: null,
  timezone: "Asia/Jakarta",
  locale: "id",
  communication_style: null,
  preferences: {},
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/profile")
      .then((data) => setProfile({ ...EMPTY, ...data }))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat profil."))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const data = await apiFetch<Profile>("/profile", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: profile.display_name?.trim() || null,
          timezone: profile.timezone,
          locale: profile.locale,
          communication_style: profile.communication_style?.trim() || null,
          preferences: profile.preferences ?? {},
        }),
      });
      setProfile({ ...EMPTY, ...data });
      setNotice("Profil tersimpan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan profil.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted focus:border-foreground/40";
  const labelClass = "block text-[12px] text-muted";

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 py-6 pb-16">
          <h1 className="text-2xl font-semibold tracking-tight">Profil</h1>
          <p className="mt-1 text-[14px] text-muted">
            Identitas dasar yang menjadi konteks percakapan. Fakta lain dikumpulkan otomatis
            sebagai memori.
          </p>

          {loading ? (
            <LoadingState label="Memuat profil..." variant="form" rows={4} className="mt-6" />
          ) : (
            <form onSubmit={save} className="mt-6 space-y-4">
              <div>
                <label htmlFor="display_name" className={labelClass}>
                  Nama panggilan
                </label>
                <input
                  id="display_name"
                  value={profile.display_name ?? ""}
                  onChange={(event) =>
                    setProfile((prev) => ({ ...prev, display_name: event.target.value }))
                  }
                  placeholder="Mau dipanggil apa?"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="timezone" className={labelClass}>
                    Zona waktu
                  </label>
                  <select
                    id="timezone"
                    value={profile.timezone}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, timezone: event.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
                    <option value="Asia/Makassar">Asia/Makassar (WITA)</option>
                    <option value="Asia/Jayapura">Asia/Jayapura (WIT)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="locale" className={labelClass}>
                    Bahasa
                  </label>
                  <select
                    id="locale"
                    value={profile.locale}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, locale: event.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="id">Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="communication_style" className={labelClass}>
                  Gaya komunikasi yang diinginkan
                </label>
                <textarea
                  id="communication_style"
                  value={profile.communication_style ?? ""}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      communication_style: event.target.value,
                    }))
                  }
                  placeholder="Contoh: sapaan santai, langsung ke inti, hindari emoji berlebihan."
                  rows={3}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? "Menyimpan…" : "Simpan profil"}
                </button>
                {notice && (
                  <p role="status" className="text-[12px] text-muted">
                    {notice}
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/40 px-3 py-2 text-[12px] text-danger"
                >
                  {error}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}