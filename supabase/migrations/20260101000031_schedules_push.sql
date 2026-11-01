-- AXTRA — schedules/reminders + PWA web-push subscriptions
-- One-off reminders and countdown timers, delivered to Telegram and/or the PWA
-- via Web Push. A per-minute cron claims due rows and fans out notifications.

create table if not exists public.schedules (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null,
    note text not null default '',
    kind text not null default 'once', -- once | timer
    due_at timestamptz not null,
    status text not null default 'active', -- active | done | cancelled
    channels jsonb not null default '["telegram", "push"]'::jsonb,
    source text not null default 'web',
    source_ref jsonb not null default '{}'::jsonb,
    fired_at timestamptz,
    done_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists schedules_user_status_due_idx
    on public.schedules (user_id, status, due_at);

create table if not exists public.push_subscriptions (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
    on public.push_subscriptions (user_id, created_at desc);

alter table public.schedules enable row level security;
alter table public.push_subscriptions enable row level security;

grant select, insert, update, delete on public.schedules to service_role;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- touch_updated_at() is defined in 20260101000030_journal_goals.sql.
drop trigger if exists schedules_touch on public.schedules;
create trigger schedules_touch
    before update on public.schedules
    for each row execute function public.touch_updated_at();

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
    before update on public.push_subscriptions
    for each row execute function public.touch_updated_at();
