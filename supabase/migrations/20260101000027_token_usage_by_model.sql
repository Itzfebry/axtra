-- AXTRA — rincian pemakaian token harian per model.
--
-- Total harian pada `get_token_usage` sengaja global (lintas model) supaya
-- mencerminkan kuota provider yang sebenarnya: ganti model tetap menambah total
-- hari itu, tidak reset. Fungsi ini hanya menambah rincian per model agar UI
-- bisa menunjukkan kontribusi masing-masing model.

create or replace function public.get_token_usage_by_model(p_day_since timestamptz)
returns table (
    model text,
    day_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        coalesce(nullif(model, ''), '(tidak diketahui)') as model,
        sum(total_tokens)::bigint as day_tokens
    from public.token_usage_events
    where created_at >= p_day_since
    group by coalesce(nullif(model, ''), '(tidak diketahui)')
    order by day_tokens desc;
$$;

grant execute on function public.get_token_usage_by_model(timestamptz)
    to service_role;