-- AXTRA — Belajar flow: imported source, quiz, daily plan, review, goal link.
-- Extends study_topics so one topic carries the whole learn loop instead of
-- five separate features.

alter table public.study_topics
    add column if not exists source_text text not null default '',
    add column if not exists source_filename text not null default '',
    add column if not exists quiz jsonb not null default '[]'::jsonb,
    add column if not exists plan jsonb not null default '[]'::jsonb,
    add column if not exists target_date date,
    add column if not exists next_review_at timestamptz,
    add column if not exists goal_id uuid;

create index if not exists study_topics_review_idx
    on public.study_topics (user_id, next_review_at)
    where next_review_at is not null;