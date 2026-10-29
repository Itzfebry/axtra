-- AXTRA Phase 2/5 — project code index (RAG over a GitHub repository)
-- Adds repo indexing state to projects and a pgvector chunk store, plus
-- semantic + keyword retrieval RPCs scoped to one project.

-- ---------------------------------------------------------------------------
-- projects: repository indexing state
-- ---------------------------------------------------------------------------
alter table public.projects
    add column if not exists repo_full_name text,
    add column if not exists repo_branch text default 'main',
    add column if not exists repo_index_status text not null default 'none',
    add column if not exists repo_file_count integer not null default 0,
    add column if not exists repo_chunk_count integer not null default 0,
    add column if not exists repo_summary text,
    add column if not exists repo_index_error text,
    add column if not exists repo_indexed_at timestamptz;

alter table public.projects
    drop constraint if exists projects_repo_index_status_check;

alter table public.projects
    add constraint projects_repo_index_status_check
    check (repo_index_status in ('none', 'pending', 'indexing', 'ready', 'error'));

-- ---------------------------------------------------------------------------
-- project_code_chunks
--   embedding is nullable: without an embedding provider the index still
--   stores content and keyword search works.
-- ---------------------------------------------------------------------------
create table if not exists public.project_code_chunks (
    id uuid primary key default extensions.gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    repo text not null default '',
    path text not null,
    language text not null default 'text',
    chunk_index integer not null default 0,
    content text not null,
    embedding extensions.vector(384),
    model text,
    created_at timestamptz not null default now(),
    unique (project_id, path, chunk_index)
);

create index if not exists project_code_chunks_project_idx
    on public.project_code_chunks (project_id);
create index if not exists project_code_chunks_content_fts_idx
    on public.project_code_chunks using gin (to_tsvector('simple', content));

alter table public.project_code_chunks enable row level security;
grant select, insert, update, delete on public.project_code_chunks to service_role;

-- ---------------------------------------------------------------------------
-- match_code_chunks_semantic
-- ---------------------------------------------------------------------------
create or replace function public.match_code_chunks_semantic(
    query_embedding extensions.vector(384),
    filter_project uuid,
    match_count integer default 8,
    min_similarity double precision default 0.0
)
returns table (
    id uuid,
    path text,
    language text,
    content text,
    similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select
        c.id,
        c.path,
        c.language,
        c.content,
        1 - (c.embedding <=> query_embedding) as similarity
    from public.project_code_chunks c
    where c.project_id = filter_project
      and c.embedding is not null
      and 1 - (c.embedding <=> query_embedding) >= min_similarity
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1);
$$;

-- ---------------------------------------------------------------------------
-- search_code_chunks_keyword
-- ---------------------------------------------------------------------------
create or replace function public.search_code_chunks_keyword(
    query_text text,
    filter_project uuid,
    match_count integer default 8
)
returns table (
    id uuid,
    path text,
    language text,
    content text,
    rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select
        c.id,
        c.path,
        c.language,
        c.content,
        ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text)) as rank
    from public.project_code_chunks c
    where c.project_id = filter_project
      and (
        query_text is null
        or query_text = ''
        or to_tsvector('simple', c.content) @@ plainto_tsquery('simple', query_text)
      )
    order by rank desc nulls last, c.path asc
    limit greatest(match_count, 1);
$$;

grant execute on function public.match_code_chunks_semantic to authenticated, service_role;
grant execute on function public.search_code_chunks_keyword to authenticated, service_role;
