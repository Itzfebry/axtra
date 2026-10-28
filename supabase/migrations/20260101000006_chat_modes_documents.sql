-- AXTRA — chat modes + document attachments
-- Adds a per-conversation mode (general | curhat | brainstorming | document)
-- and a table for documents attached to a conversation.
-- Knowledge (memories) stays shared across every mode.

-- ---------------------------------------------------------------------------
-- conversations.mode
-- ---------------------------------------------------------------------------
alter table public.conversations
    add column if not exists mode text not null default 'general';

alter table public.conversations
    drop constraint if exists conversations_mode_check;

alter table public.conversations
    add constraint conversations_mode_check
    check (mode in ('general', 'curhat', 'brainstorming', 'document'));

create index if not exists conversations_user_mode_idx
    on public.conversations (user_id, mode, last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- chat_documents
--   Extracted plain text only; the original binary is not stored.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_documents (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    filename text not null,
    mime_type text not null default 'text/plain',
    size_bytes integer not null default 0,
    content text not null default '',
    created_at timestamptz not null default now()
);

create index if not exists chat_documents_conversation_id_idx
    on public.chat_documents (conversation_id, created_at);

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.chat_documents enable row level security;

grant select, insert, update, delete on public.chat_documents to service_role;