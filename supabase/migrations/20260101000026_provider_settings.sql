-- AXTRA — Pengaturan provider LLM (tab Provider).
--
-- Menyimpan API key per-user untuk provider OpenAI-compatible. Key dienkripsi
-- di server (Fernet, lihat services/provider_crypto.py) sebelum disimpan; kolom
-- `masked` hanya bentuk samar untuk ditampilkan di UI. Nilai key mentah tidak
-- pernah dikirim ke browser.
--
-- Pilihan provider/model aktif disimpan terpisah di
-- profiles.preferences['llm'] = {"provider": "...", "model": "..."} sehingga
-- tidak butuh tabel baru.

create table if not exists public.provider_keys (
    user_id uuid not null,
    provider_id text not null,
    secret text not null,
    masked text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, provider_id)
);

create index if not exists provider_keys_user_idx
    on public.provider_keys (user_id);

alter table public.provider_keys enable row level security;
grant select, insert, update, delete on public.provider_keys to service_role;
