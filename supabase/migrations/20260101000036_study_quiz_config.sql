-- AXTRA — Belajar: store the quiz config so each history entry can show it.

alter table public.study_topics
    add column if not exists quiz_count integer not null default 5,
    add column if not exists quiz_level text not null default 'campuran';
