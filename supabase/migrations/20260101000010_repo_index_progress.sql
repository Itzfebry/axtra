-- AXTRA — repo index progress
-- Adds progress percentage + current stage so the UI can show a live bar.

alter table public.projects
    add column if not exists repo_index_progress integer not null default 0,
    add column if not exists repo_index_stage text;
