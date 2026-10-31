-- AXTRA — Vibe Coding workspace
-- Persistent idea -> discovery -> specification -> planning -> verification flow.
-- Single-user mode: RLS on with no policies; the backend service role is the
-- only reader/writer. Every row keeps the configured owner id (no hardcoded
-- per-user logic) and cascades from its parent project/session.
--
-- Design notes:
-- * A project can have many vibe sessions (ideas/features).
-- * Discovery turns and decisions are stored as structured rows, not one blob.
-- * The seven artifact kinds live in vibe_artifacts (one current row per kind)
--   and every save/generation appends an immutable vibe_artifact_versions row.
-- * Implementation tasks reuse public.project_tasks. Forward-only nullable
--   columns add plan/verification metadata without changing the task board.

-- ---------------------------------------------------------------------------
-- vibe_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.vibe_sessions (
    id uuid primary key default extensions.gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null default '',
    raw_idea jsonb not null default '{}'::jsonb,
    stage text not null default 'discovery' check (
        stage in ('discovery', 'specification', 'planning', 'verification')
    ),
    summary text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists vibe_sessions_project_idx
    on public.vibe_sessions (project_id, updated_at desc);
create index if not exists vibe_sessions_user_idx
    on public.vibe_sessions (user_id, updated_at desc);

drop trigger if exists vibe_sessions_set_updated_at on public.vibe_sessions;
create trigger vibe_sessions_set_updated_at
    before update on public.vibe_sessions
    for each row execute function public.set_updated_at();

alter table public.vibe_sessions enable row level security;
grant select, insert, update, delete on public.vibe_sessions to service_role;

-- ---------------------------------------------------------------------------
-- vibe_messages (persistent discovery conversation)
-- ---------------------------------------------------------------------------
create table if not exists public.vibe_messages (
    id uuid primary key default extensions.gen_random_uuid(),
    session_id uuid not null references public.vibe_sessions (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists vibe_messages_session_idx
    on public.vibe_messages (session_id, created_at);

alter table public.vibe_messages enable row level security;
grant select, insert, update, delete on public.vibe_messages to service_role;

-- ---------------------------------------------------------------------------
-- vibe_decisions (confirmed decisions vs assumptions)
-- ---------------------------------------------------------------------------
create table if not exists public.vibe_decisions (
    id uuid primary key default extensions.gen_random_uuid(),
    session_id uuid not null references public.vibe_sessions (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    category text not null default 'general',
    statement text not null,
    status text not null default 'ASSUMED' check (
        status in (
            'CONFIRMED', 'ASSUMED', 'RESEARCH',
            'NEEDS_DECISION', 'VALIDATION_REQUIRED'
        )
    ),
    rationale text not null default '',
    source text not null default 'ai',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists vibe_decisions_session_idx
    on public.vibe_decisions (session_id, status, created_at);

drop trigger if exists vibe_decisions_set_updated_at on public.vibe_decisions;
create trigger vibe_decisions_set_updated_at
    before update on public.vibe_decisions
    for each row execute function public.set_updated_at();

alter table public.vibe_decisions enable row level security;
grant select, insert, update, delete on public.vibe_decisions to service_role;

-- ---------------------------------------------------------------------------
-- vibe_artifacts (one current document per kind per session)
-- ---------------------------------------------------------------------------
create table if not exists public.vibe_artifacts (
    id uuid primary key default extensions.gen_random_uuid(),
    session_id uuid not null references public.vibe_sessions (id) on delete cascade,
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    kind text not null check (
        kind in (
            'PRD', 'ARCHITECTURE', 'ACCEPTANCE_TEST_PLAN', 'UI_UX_SPEC',
            'AGENT_INSTRUCTIONS', 'IMPLEMENTATION_PLAN', 'DEFINITION_OF_DONE'
        )
    ),
    title text not null default '',
    content text not null default '',
    status text not null default 'DRAFT' check (
        status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'STALE')
    ),
    version integer not null default 1 check (version >= 1),
    generated_by text not null default 'ai' check (
        generated_by in ('ai', 'manual')
    ),
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (session_id, kind)
);

create index if not exists vibe_artifacts_project_idx
    on public.vibe_artifacts (project_id, updated_at desc);

drop trigger if exists vibe_artifacts_set_updated_at on public.vibe_artifacts;
create trigger vibe_artifacts_set_updated_at
    before update on public.vibe_artifacts
    for each row execute function public.set_updated_at();

alter table public.vibe_artifacts enable row level security;
grant select, insert, update, delete on public.vibe_artifacts to service_role;

-- ---------------------------------------------------------------------------
-- vibe_artifact_versions (immutable history; approved content is never lost)
-- ---------------------------------------------------------------------------
create table if not exists public.vibe_artifact_versions (
    id uuid primary key default extensions.gen_random_uuid(),
    artifact_id uuid not null references public.vibe_artifacts (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    version integer not null check (version >= 1),
    content text not null default '',
    status text not null default 'DRAFT' check (
        status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'STALE')
    ),
    note text not null default '',
    created_at timestamptz not null default now(),
    unique (artifact_id, version)
);

create index if not exists vibe_artifact_versions_artifact_idx
    on public.vibe_artifact_versions (artifact_id, version desc);

alter table public.vibe_artifact_versions enable row level security;
grant select, insert, update, delete on public.vibe_artifact_versions to service_role;

-- ---------------------------------------------------------------------------
-- project_tasks: implementation-plan + verification metadata
-- All columns are nullable/defaulted so the existing task board is unchanged.
-- ---------------------------------------------------------------------------
alter table public.project_tasks
    add column if not exists vibe_session_id uuid
        references public.vibe_sessions (id) on delete set null,
    add column if not exists vibe_task_key text,
    add column if not exists acceptance_criteria jsonb not null default '[]'::jsonb,
    add column if not exists dependencies jsonb not null default '[]'::jsonb,
    add column if not exists affected_modules jsonb not null default '[]'::jsonb,
    add column if not exists doc_refs jsonb not null default '[]'::jsonb,
    add column if not exists testing_notes text not null default '',
    add column if not exists verification_status text not null default 'TODO' check (
        verification_status in (
            'TODO', 'IN_PROGRESS', 'BLOCKED', 'NEEDS_REVIEW', 'DONE'
        )
    ),
    add column if not exists verification_evidence text not null default '',
    add column if not exists verification_notes text not null default '';

create index if not exists project_tasks_vibe_session_idx
    on public.project_tasks (vibe_session_id, position);
create unique index if not exists project_tasks_vibe_key_idx
    on public.project_tasks (vibe_session_id, vibe_task_key)
    where vibe_session_id is not null and vibe_task_key is not null;