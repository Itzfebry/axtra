-- AXTRA — web research (Riset Web chat mode)
-- Crawled web pages are stored as extracted plain text, scoped to a single
-- conversation, and injected as context by the chat service.

-- ---------------------------------------------------------------------------
-- conversations.mode: allow the new 'research' mode
-- ---------------------------------------------------------------------------
alter table public.conversations
    drop constraint if exists conversations_mode_check;

alter table public.conversations
    add constraint conversations_mode_check
    check (mode in ('general', 'curhat', 'brainstorming', 'document', 'research'));

-- ---------------------------------------------------------------------------
-- research_sources
--   Extracted text of a crawled page; the raw HTML is not stored.
-- ---------------------------------------------------------------------------
create table if not exists public.research_sources (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    url text not null,
    title text not null default '',
    site text not null default '',
    content text not null default '',
    created_at timestamptz not null default now()
);

create index if not exists research_sources_conversation_id_idx
    on public.research_sources (conversation_id, created_at);

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.research_sources enable row level security;

grant select, insert, update, delete on public.research_sources to service_role;
