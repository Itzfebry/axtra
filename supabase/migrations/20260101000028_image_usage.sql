-- AXTRA — image generation telemetry
-- Records every successful image generation so the UI can show how many images
-- and how much (USD) was spent today, and the server can enforce a daily cap.
-- Image generation is billed per image (not per token), so it is kept separate
-- from token_usage_events and never feeds the token meters.
--
-- One row per completed generation (all `n` images of one call).

create table if not exists public.image_usage_events (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    provider text not null default '',
    model text not null default '',
    cost numeric(12, 6) not null default 0,
    images integer not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists image_usage_events_user_created_idx
    on public.image_usage_events (user_id, created_at desc);

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.image_usage_events enable row level security;

grant select, insert, update, delete on public.image_usage_events to service_role;

-- ---------------------------------------------------------------------------
-- get_image_usage_day
--   Sums images and cost for the current WIB day. The day boundary is computed
--   in the backend (WIB) and passed in, so the function stays timezone-free.
-- ---------------------------------------------------------------------------
create or replace function public.get_image_usage_day(p_day_since timestamptz)
returns table (
    day_images bigint,
    day_cost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        coalesce(sum(images), 0)::bigint as day_images,
        coalesce(sum(cost), 0)::numeric as day_cost
    from public.image_usage_events
    where created_at >= p_day_since;
$$;

grant execute on function public.get_image_usage_day(timestamptz) to service_role;
