-- AXTRA — Belajar: quiz attempt history (last 20 kept).
-- Lets the UI show progress over repeated attempts without a separate table.

alter table public.study_topics
    add column if not exists quiz_history jsonb not null default '[]'::jsonb;
