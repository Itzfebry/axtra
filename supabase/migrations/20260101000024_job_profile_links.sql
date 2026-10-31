-- AXTRA — Cari Kerja: profil kandidat (LinkedIn + portfolio).
--
-- Both links are owner-level (same row as the single active CV), so every job
-- application can reuse them. `portfolio_content` / `linkedin_content` hold an
-- optional text snapshot that is fed to the analysis; the raw links stay as
-- references. Analysis sources are chosen per request and never persisted.

alter table public.job_cv add column if not exists linkedin_url text not null default '';
alter table public.job_cv add column if not exists portfolio_url text not null default '';
alter table public.job_cv add column if not exists portfolio_content text not null default '';
alter table public.job_cv add column if not exists linkedin_content text not null default '';
alter table public.job_cv add column if not exists links_updated_at timestamptz;

-- Row may already exist from an uploaded CV; nothing else to backfill.