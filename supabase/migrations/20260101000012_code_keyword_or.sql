-- AXTRA — improve code retrieval for natural-language questions
--
-- The previous version used plainto_tsquery(), which joins every term with
-- AND. A normal Indonesian question ("apa fungsi utama project ini") can never
-- match an English codebase, so retrieval returned zero chunks even when the
-- index was complete.
--
-- This version:
--   1. splits the question into tokens and joins them with OR,
--   2. accepts chunks that match any token through full-text search,
--   3. adds a substring (ILIKE) fallback for partial/identifier matches,
--   4. ranks by ts_rank plus the number of matched tokens.

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
    with tokens as (
        select distinct lower(token) as token
        from regexp_split_to_table(
            coalesce(query_text, ''), '[^[:alnum:]_]+'
        ) as token
        where length(token) >= 3
          and lower(token) not in (
              'apa', 'apakah', 'ini', 'itu', 'yang', 'dan', 'atau', 'untuk',
              'dengan', 'dari', 'pada', 'adalah', 'bagaimana', 'gimana',
              'cara', 'kenapa', 'mengapa', 'dimana', 'mana', 'saya', 'kami',
              'kita', 'bisa', 'tidak', 'sudah', 'belum', 'akan', 'juga',
              'ada', 'juga', 'the', 'and', 'for', 'with', 'this', 'that',
              'from', 'what', 'how'
          )
    ),
    parsed as (
        select to_tsquery('simple', string_agg(token, ' | ')) as tsq
        from tokens
    ),
    candidates as (
        select c.*
        from public.project_code_chunks c, parsed p
        where c.project_id = filter_project
          and (
            p.tsq is null
            or to_tsvector('simple', c.content) @@ p.tsq
            or exists (
                select 1 from tokens t
                where length(t.token) >= 4
                  and c.content ilike '%' || t.token || '%'
            )
          )
    )
    select
        c.id,
        c.path,
        c.language,
        c.content,
        (
            case
                when p.tsq is not null
                 and to_tsvector('simple', c.content) @@ p.tsq
                then ts_rank(to_tsvector('simple', c.content), p.tsq)
                else 0
            end
            + coalesce((
                select count(*)::real from tokens t
                where length(t.token) >= 4
                  and c.content ilike '%' || t.token || '%'
            ), 0) * 0.01
        )::real as rank
    from candidates c, parsed p
    order by rank desc nulls last, c.path asc
    limit greatest(match_count, 1);
$$;

grant execute on function public.search_code_chunks_keyword to authenticated, service_role;
