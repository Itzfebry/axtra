-- AXTRA Phase 1 — Row Level Security
-- Every personal table is isolated per user. auth.uid() must equal user_id.

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.memory_embeddings enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
    for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
drop policy if exists conversations_all_own on public.conversations;
create policy conversations_all_own on public.conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
drop policy if exists messages_all_own on public.messages;
create policy messages_all_own on public.messages
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------
drop policy if exists memories_all_own on public.memories;
create policy memories_all_own on public.memories
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- memory_embeddings
-- ---------------------------------------------------------------------------
drop policy if exists memory_embeddings_all_own on public.memory_embeddings;
create policy memory_embeddings_all_own on public.memory_embeddings
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
