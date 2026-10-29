-- AXTRA — link chat conversations to projects + auto-refreshed AI health
-- 1) projects.health_stale: true when project data changed since the last AI
--    review. New AND existing rows default to true so each project refreshes
--    once after this migration.
-- 2) project_conversations: which chat threads reference a project via @mention.
--    Lets the project detail page list "Chat terkait".

alter table public.projects
    add column if not exists health_stale boolean not null default true;

-- ---------------------------------------------------------------------------
-- project_conversations (chat thread <-> project link)
-- ---------------------------------------------------------------------------
create table if not exists public.project_conversations (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    project_id uuid not null references public.projects (id) on delete cascade,
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (project_id, conversation_id)
);

create index if not exists project_conversations_project_idx
    on public.project_conversations (project_id, created_at desc);
create index if not exists project_conversations_conversation_idx
    on public.project_conversations (conversation_id);

alter table public.project_conversations enable row level security;
grant select, insert, update, delete on public.project_conversations to service_role;
