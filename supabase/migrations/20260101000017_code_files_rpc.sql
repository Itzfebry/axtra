-- AXTRA — repo file listing aggregation in SQL
--
-- The repo file browser only needs one row per path with its chunk count.
-- Aggregating in Postgres avoids pulling every chunk row to the backend.

create or replace function public.list_project_code_files(
    filter_project uuid
)
returns table (
    path text,
    language text,
    chunk_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select
        path,
        coalesce(max(language), 'text') as language,
        count(*)::bigint as chunk_count
    from public.project_code_chunks
    where project_id = filter_project
    group by path
    order by path;
$$;

grant execute on function public.list_project_code_files(uuid) to service_role;