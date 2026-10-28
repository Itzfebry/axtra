-- AXTRA — token usage telemetry
-- Records every LLM call's token usage so the UI can show a rolling
-- tokens-per-minute (TPM) figure and a daily total that resets at 00:00 WIB.
--
-- One row per LLM call. `source` distinguishes the visible chat answer from
-- the background memory-extraction call (both consume model quota).

create table if not exists public.token_usage_events (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    model text,
    source text not null default 'chat',
    prompt_tokens integer not null default 0,
    completion_tokens integer not null default 0,
    total_tokens integer not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists token_usage_events_user_created_idx
    on public.token_usage_events (user_id, created_at desc);

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.token_usage_events enable row level security;

grant select, insert, update, delete on public.token_usage_events to service_role;

-- ---------------------------------------------------------------------------
-- get_token_usage
--   Sums tokens for the rolling window (p_minute_since) and for the current
--   day (p_day_since). Both boundaries are computed in the backend (WIB) and
--   passed in, so the function stays timezone-agnostic.
-- ---------------------------------------------------------------------------
create or replace function public.get_token_usage(
    p_minute_since timestamptz,
    p_day_since timestamptz
)
returns table (
    minute_tokens bigint,
    day_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        coalesce(sum(total_tokens) filter (where created_at >= p_minute_since), 0)::bigint
            as minute_tokens,
        coalesce(sum(total_tokens) filter (where created_at >= p_day_since), 0)::bigint
            as day_tokens
    from public.token_usage_events;
$$;

grant execute on function public.get_token_usage(timestamptz, timestamptz)
    to service_role;
