-- AXTRA — headless agent surface: orchestrator menu/theme state + job queue.
-- Both tables are owner-scoped singletons/lists touched only through the
-- service role, so RLS is enabled with grants and no anon policy.
-- ``orchestrator_state`` moves the homepage menu config off localStorage so a
-- headless command (API token) can change the menu, and the sidebar reads the
-- same config on every device. ``agent_jobs`` is the queue drained by
-- /api/cron/minutely so a chat answer is not bound to one 300s function call.

create table if not exists public.orchestrator_state (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    "order" jsonb not null default '[]'::jsonb,
    hidden jsonb not null default '[]'::jsonb,
    labels jsonb not null default '{}'::jsonb,
    theme text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id)
);

create table if not exists public.agent_jobs (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    kind text not null default 'chat',
    status text not null default 'queued', -- queued | running | done | failed
    title text not null default '',
    prompt text not null,
    mode text not null default 'general',
    model text,
    conversation_id uuid,
    result text not null default '',
    error text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists agent_jobs_queue_idx
    on public.agent_jobs (status, created_at);

alter table public.orchestrator_state enable row level security;
alter table public.agent_jobs enable row level security;

grant select, insert, update, delete on public.orchestrator_state to service_role;
grant select, insert, update, delete on public.agent_jobs to service_role;
