-- AXTRA Phase 2/5 — project tasks, saved repo Q&A, and AI health
-- 1) project_tasks: per-project todo list with status/priority.
-- 2) project_asks: persisted "Tanya repo" history, shown in the right sidebar
--    and restored after a reload.
-- 3) projects.health_summary / health_generated_at: cached AI health analysis.

alter table public.projects
    add column if not exists health_summary text,
    add column if not exists health_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- project_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.project_tasks (
    id uuid primary key default extensions.gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null,
    detail text not null default '',
    status text not null default 'todo' check (
        status in ('todo', 'doing', 'done')
    ),
    priority text not null default 'medium' check (
        priority in ('low', 'medium', 'high')
    ),
    position integer not null default 0,
    source text not null default 'manual',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists project_tasks_project_idx
    on public.project_tasks (project_id, status, position, created_at);

drop trigger if exists project_tasks_set_updated_at on public.project_tasks;
create trigger project_tasks_set_updated_at
    before update on public.project_tasks
    for each row execute function public.set_updated_at();

alter table public.project_tasks enable row level security;
grant select, insert, update, delete on public.project_tasks to service_role;

-- ---------------------------------------------------------------------------
-- project_asks (saved repo questions + answers)
-- ---------------------------------------------------------------------------
create table if not exists public.project_asks (
    id uuid primary key default extensions.gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    question text not null,
    answer text not null default '',
    sources jsonb not null default '[]'::jsonb,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists project_asks_project_idx
    on public.project_asks (project_id, created_at desc);

alter table public.project_asks enable row level security;
grant select, insert, update, delete on public.project_asks to service_role;
