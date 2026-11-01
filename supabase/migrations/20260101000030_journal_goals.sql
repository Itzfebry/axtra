-- AXTRA — daily journal + goals (Phase 2 completion, minimal)
-- Free-form daily notes and simple goals. Both are first-class memories' input
-- and feed the Telegram bot (/jurnal, /target) and the daily report.

create table if not exists public.journal_entries (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
    content text not null,
    mood text not null default '',
    tags jsonb not null default '[]'::jsonb,
    source text not null default 'web',
    source_ref jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists journal_entries_user_date_idx
    on public.journal_entries (user_id, entry_date desc, created_at desc);

create table if not exists public.goals (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null,
    detail text not null default '',
    status text not null default 'active', -- active | done | archived
    target_date date,
    progress integer not null default 0, -- 0..100
    source text not null default 'web',
    source_ref jsonb not null default '{}'::jsonb,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists goals_user_status_idx
    on public.goals (user_id, status, created_at desc);

alter table public.journal_entries enable row level security;
alter table public.goals enable row level security;

grant select, insert, update, delete on public.journal_entries to service_role;
grant select, insert, update, delete on public.goals to service_role;

-- keep updated_at fresh on update
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists journal_entries_touch on public.journal_entries;
create trigger journal_entries_touch
    before update on public.journal_entries
    for each row execute function public.touch_updated_at();

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch
    before update on public.goals
    for each row execute function public.touch_updated_at();
