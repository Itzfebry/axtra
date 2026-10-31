-- AXTRA — project AI health analysis history.
-- Stores the last N analysis snapshots ({summary, generated_at}) so the
-- project detail page can show past "Kesehatan proyek" results instead of
-- overwriting the previous one on every regenerate.

alter table public.projects
    add column if not exists health_history jsonb not null default '[]'::jsonb;
