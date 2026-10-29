-- AXTRA — Firecrawl crawl credit telemetry
-- Records every Firecrawl scrape attempt (success and failure) so the UI can
-- show credits used per day/month and the server can enforce a daily cap that
-- protects the monthly quota. Failures are recorded with 0 credits so the
-- statistics do not silently drop attempted calls.
--
-- One row per attempt. `provider` is "firecrawl"; the built-in httpx parser
-- does not consume credits and is not recorded here.

create table if not exists public.crawl_usage_events (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    provider text not null default 'firecrawl',
    url text not null default '',
    credits integer not null default 0,
    status text not null default 'success',
    code text not null default '',
    created_at timestamptz not null default now()
);

create index if not exists crawl_usage_events_user_created_idx
    on public.crawl_usage_events (user_id, created_at desc);
-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.crawl_usage_events enable row level security;

grant select, insert, update, delete on public.crawl_usage_events to service_role;

-- ---------------------------------------------------------------------------
-- get_crawl_usage
--   Sums Firecrawl credits for the current WIB day (p_day_since) and month
--   (p_month_since). Both boundaries are computed in the backend (WIB) and
--   passed in, so the function stays timezone-agnostic.
-- ---------------------------------------------------------------------------
create or replace function public.get_crawl_usage(
    p_day_since timestamptz,
    p_month_since timestamptz
)
returns table (
    day_credits bigint,
    month_credits bigint
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        coalesce(sum(credits) filter (
            where created_at >= p_day_since and status = 'success'
        ), 0)::bigint as day_credits,
        coalesce(sum(credits) filter (
            where created_at >= p_month_since and status = 'success'
        ), 0)::bigint as month_credits
    from public.crawl_usage_events;
$$;

grant execute on function public.get_crawl_usage(timestamptz, timestamptz)
    to service_role;

-- ---------------------------------------------------------------------------
-- research_sources.provider
--   Records which crawl provider produced a stored source, so cache reuse in
--   the same conversation can report it. Existing rows default to 'httpx'.
-- ---------------------------------------------------------------------------
alter table public.research_sources
    add column if not exists provider text not null default 'httpx';

