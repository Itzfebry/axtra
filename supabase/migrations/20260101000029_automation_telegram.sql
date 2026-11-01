-- AXTRA — automation + Telegram (Phase 4)
-- Persistent storage for the Telegram bot and the scheduled-notification engine.
-- The in-process scheduler is replaced by a single cron endpoint
-- (/api/cron/tick) that reads these tables, so nothing depends on a long-lived
-- worker or a browser tab.

-- ---------------------------------------------------------------------------
-- telegram_links — one row per chat allowed to talk to the bot.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_links (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    chat_id text not null,
    username text not null default '',
    first_name text not null default '',
    enabled boolean not null default true,
    default_mode text not null default 'general',
    conversation_id uuid,
    daily_report boolean not null default true,
    weekly_report boolean not null default true,
    report_hour integer not null default 21,
    quiet_start integer not null default 22,
    quiet_end integer not null default 7,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (chat_id)
);

create index if not exists telegram_links_enabled_idx
    on public.telegram_links (enabled);

-- ---------------------------------------------------------------------------
-- telegram_updates — dedupe store keyed by Telegram update_id. Telegram
-- retries webhooks, so a processed update must be ignored the second time.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_updates (
    update_id bigint primary key,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notification_outbox — durable send queue with bounded retry.
-- A row is enqueued, then delivered by the cron tick (or immediately, when the
-- caller wants a fast path). status: pending | sent | failed.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_outbox (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    chat_id text not null,
    kind text not null default 'message', -- message | photo
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempts integer not null default 0,
    max_attempts integer not null default 5,
    last_error text not null default '',
    next_attempt_at timestamptz not null default now(),
    sent_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists notification_outbox_due_idx
    on public.notification_outbox (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- automation_runs — idempotency guard for scheduled reports. One row per
-- (kind, day) means a report is sent at most once even if the cron fires twice.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_runs (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    kind text not null,
    day_key text not null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (kind, day_key)
);

-- Single-user mode: RLS on, no policies. Only the backend service role reads.
alter table public.telegram_links enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.automation_runs enable row level security;

grant select, insert, update, delete on public.telegram_links to service_role;
grant select, insert, update, delete on public.telegram_updates to service_role;
grant select, insert, update, delete on public.notification_outbox to service_role;
grant select, insert, update, delete on public.automation_runs to service_role;

-- ---------------------------------------------------------------------------
-- purge_telegram_updates — keep the dedupe table small; drop rows older than
-- the given timestamp. Called best-effort from the cron tick.
-- ---------------------------------------------------------------------------
create or replace function public.purge_telegram_updates(p_before timestamptz)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
    delete from public.telegram_updates where created_at < p_before;
$$;

grant execute on function public.purge_telegram_updates(timestamptz) to service_role;
