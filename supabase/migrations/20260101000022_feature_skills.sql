-- AXTRA — per-feature custom skills.
-- Preset skills live in code (backend/app/feature_catalog.py); this table stores
-- only user-authored skills, scoped to one AI feature (e.g. projects:health).
-- Selections (which roles/skills are active) live in profiles.preferences so no
-- extra join table is needed for the single-user setup.

create table if not exists public.skills (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    feature text not null,
    name text not null,
    description text not null default '',
    instruction text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint skills_user_feature_name_key unique (user_id, feature, name)
);

create index if not exists skills_user_feature_idx
    on public.skills (user_id, feature, created_at desc);

drop trigger if exists skills_set_updated_at on public.skills;
create trigger skills_set_updated_at
    before update on public.skills
    for each row execute function public.set_updated_at();

alter table public.skills enable row level security;
grant select, insert, update, delete on public.skills to service_role;