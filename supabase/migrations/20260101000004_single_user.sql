-- AXTRA — single-user mode
-- Replaces per-user Supabase Auth with one owner row and a fixed owner id.
-- RLS stays enabled but all auth.uid()-based policies are dropped, so only the
-- backend service role can read/write. The browser uses the anon key and is
-- denied everything.

-- 1. Detach rows from auth.users (single owner from now on).
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.conversations drop constraint if exists conversations_user_id_fkey;
alter table public.messages drop constraint if exists messages_user_id_fkey;
alter table public.memories drop constraint if exists memories_user_id_fkey;
alter table public.memory_embeddings drop constraint if exists memory_embeddings_user_id_fkey;

-- 2. No more signups.
drop trigger if exists on_auth_user_created on auth.users;

-- 3. Fixed owner id.
--    00000000-0000-0000-0000-000000000001
alter table public.profiles alter column id set default '00000000-0000-0000-0000-000000000001';
alter table public.conversations alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table public.messages alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table public.memories alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table public.memory_embeddings alter column user_id set default '00000000-0000-0000-0000-000000000001';

-- 4. Ensure the owner profile exists.
insert into public.profiles (id, display_name)
values ('00000000-0000-0000-0000-000000000001', 'Pemilik')
on conflict (id) do nothing;

-- 5. Drop per-user policies. RLS remains enabled with no policies, which means
--    anon/authenticated roles are denied while the service role (backend) works.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists conversations_all_own on public.conversations;
drop policy if exists messages_all_own on public.messages;
drop policy if exists memories_all_own on public.memories;
drop policy if exists memory_embeddings_all_own on public.memory_embeddings;