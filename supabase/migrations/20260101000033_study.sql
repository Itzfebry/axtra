-- AXTRA — "Belajar" study topics (CPNS, materi/kursus apa pun).
-- Each row is a study topic the owner learns; Axtra generates its material
-- (ringkasan, poin kunci, contoh soal, kuis, langkah berikutnya) on demand.

create table if not exists public.study_topics (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null,
    subject text not null default '',   -- kategori, mis. "CPNS" / "Kursus Python"
    goal text not null default '',      -- target belajar
    status text not null default 'active', -- active | done | archived
    progress integer not null default 0,   -- 0..100
    material text not null default '',  -- materi hasil generate (markdown)
    notes text not null default '',     -- catatan pribadi
    source text not null default 'web',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists study_topics_user_status_idx
    on public.study_topics (user_id, status, created_at desc);

alter table public.study_topics enable row level security;
grant select, insert, update, delete on public.study_topics to service_role;

drop trigger if exists study_topics_touch on public.study_topics;
create trigger study_topics_touch
    before update on public.study_topics
    for each row execute function public.touch_updated_at();
