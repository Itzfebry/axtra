"use client";

import { AppShell } from "@/components/AppShell";
import { ModeSettings } from "@/components/ModeSettings";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-16">
          <header>
            <p className="text-[11px] uppercase tracking-wide text-muted">Preferensi</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pengaturan</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-muted">
              Atur posisi dan perilaku Axtra untuk tiap fitur serta mode chat.
            </p>
          </header>

          <div className="mt-6">
            <ModeSettings />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
