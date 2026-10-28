-- AXTRA Phase 1 — Core schema
-- Tables: profiles, conversations, messages, memories, memory_embeddings
-- Requires: pgvector extension

-- Supabase exposes pgvector as the "vector" extension.
create extension if not exists "vector" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    timezone text not null default 'Asia/Jakarta',
    locale text not null default 'id',
    communication_style text,
    preferences jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    title text,
    summary text,
    message_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_message_at timestamptz
);

create index if not exists conversations_user_id_idx
    on public.conversations (user_id, last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
    id uuid primary key default extensions.gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null check (role in ('system', 'user', 'assistant', 'tool')),
    content text not null default '',
    model text,
    token_count integer,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
    on public.messages (conversation_id, created_at);
create index if not exists messages_user_id_idx
    on public.messages (user_id);

-- ---------------------------------------------------------------------------
-- memories
--   type      : identity | episodic | semantic | project | goal | skill | conversation
--   source    : where the fact came from (chat | manual | journal | import | system)
--   status    : active | conflicted | archived
--   confidence: 0..1 belief level; AI inference is not treated as confirmed fact
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    type text not null check (
        type in ('identity', 'episodic', 'semantic', 'project', 'goal', 'skill', 'conversation')
    ),
    content text not null,
    source text not null default 'manual',
    source_ref jsonb not null default '{}'::jsonb,
    confidence numeric(3, 2) not null default 0.50 check (confidence >= 0 and confidence <= 1),
    status text not null default 'active' check (status in ('active', 'conflicted', 'archived')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists memories_user_id_idx
    on public.memories (user_id, status, type);
create index if not exists memories_content_fts_idx
    on public.memories using gin (to_tsvector('simple', content));

-- ---------------------------------------------------------------------------
-- memory_embeddings (pgvector)
--   dimension configurable via EMBEDDING_DIM; default 384 (gte-small compatible)
-- ---------------------------------------------------------------------------
create table if not exists public.memory_embeddings (
    id uuid primary key default extensions.gen_random_uuid(),
    memory_id uuid not null references public.memories (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    embedding extensions.vector(384) not null,    model text not null default 'unknown',
    created_at timestamptz not null default now(),
    unique (memory_id)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
    before update on public.memories
    for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
    before update on public.conversations
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- auto-create profile on new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
