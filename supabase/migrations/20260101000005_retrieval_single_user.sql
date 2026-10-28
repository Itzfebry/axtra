-- AXTRA — retrieval functions for single-user mode
--
-- The backend now reads with the service role, so `auth.uid()` is NULL and the
-- old per-user filters returned nothing. There is exactly one owner and the
-- anon role is denied by RLS (no policies), so retrieval no longer needs to
-- filter by user. Signatures are unchanged (create or replace, no overload).

create or replace function public.match_memories_semantic(
    query_embedding extensions.vector(384),
    match_count integer default 8,
    min_similarity double precision default 0.0,
    filter_types text[] default null
)
returns table (
    id uuid,
    type text,
    content text,
    source text,
    confidence numeric,
    metadata jsonb,
    created_at timestamptz,
    similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select
        m.id,
        m.type,
        m.content,
        m.source,
        m.confidence,
        m.metadata,
        m.created_at,
        1 - (e.embedding <=> query_embedding) as similarity
    from public.memory_embeddings e
    join public.memories m on m.id = e.memory_id
    where m.status = 'active'
      and (filter_types is null or m.type = any (filter_types))
      and 1 - (e.embedding <=> query_embedding) >= min_similarity
    order by e.embedding <=> query_embedding
    limit greatest(match_count, 1);
$$;

create or replace function public.search_memories_keyword(
    query_text text,
    match_count integer default 8,
    filter_types text[] default null
)
returns table (
    id uuid,
    type text,
    content text,
    source text,
    confidence numeric,
    metadata jsonb,
    created_at timestamptz,
    rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select
        m.id,
        m.type,
        m.content,
        m.source,
        m.confidence,
        m.metadata,
        m.created_at,
        ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', query_text)) as rank
    from public.memories m
    where m.status = 'active'
      and (filter_types is null or m.type = any (filter_types))
      and (
        query_text is null
        or query_text = ''
        or to_tsvector('simple', m.content) @@ plainto_tsquery('simple', query_text)
      )
    order by rank desc nulls last, m.created_at desc
    limit greatest(match_count, 1);
$$;

grant execute on function public.match_memories_semantic to authenticated, service_role;
grant execute on function public.search_memories_keyword to authenticated, service_role;