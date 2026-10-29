-- AXTRA Phase 2 — projects
-- Personal project registry: spec, status, tech stack, links, and notes.
-- Single-user mode: RLS on with no policies; only the backend service role
-- (owner client) can read/write.

create table if not exists public.projects (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    name text not null,
    description text not null default '',
    status text not null default 'idea' check (
        status in ('idea', 'active', 'paused', 'done')
    ),
    tech_stack jsonb not null default '[]'::jsonb,
    repo_url text,
    notes text not null default '',
    source text not null default 'manual',
    source_ref jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists projects_user_status_idx
    on public.projects (user_id, status, updated_at desc);
create index if not exists projects_user_name_idx
    on public.projects (user_id, lower(name));

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
    before update on public.projects
    for each row execute function public.set_updated_at();

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.projects enable row level security;

grant select, insert, update, delete on public.projects to service_role;
