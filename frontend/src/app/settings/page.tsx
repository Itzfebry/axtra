"use client";

import { AppShell } from "@/components/AppShell";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="w-full px-4 py-5 pb-16 sm:px-6 lg:px-8">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Preferensi</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight font-brand">Pengaturan</h1>
            </div>
            <p className="max-w-3xl text-[13px] text-muted">
              Atur model teks, model gambar, peran, skill, dan command Axtra.
              Perubahan langsung dipakai pada balasan berikutnya.
            </p>
          </header>

          <div className="mt-5">
            <SettingsTabs />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
