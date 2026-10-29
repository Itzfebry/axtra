-- AXTRA — Cari Kerja (job application tracker)
-- One row per application, plus a single active CV per owner used for matching.

-- ---------------------------------------------------------------------------
-- job_applications
-- ---------------------------------------------------------------------------
create table if not exists public.job_applications (
    id uuid primary key default extensions.gen_random_uuid(),
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    company text not null,
    role text not null,
    location text not null default '',
    work_type text not null default '',
    salary text not null default '',
    job_url text,
    source text not null default 'manual',
    status text not null default 'applied'
        check (status in ('draft', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn')),
    applied_at timestamptz,
    deadline date,
    notes text not null default '',
    job_description text not null default '',
    job_title text not null default '',
    predicted_jobdesk text not null default '',
    match_score integer,
    match_analysis text not null default '',
    success_score integer,
    success_analysis text not null default '',
    cover_letter text not null default '',
    analyzed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists job_applications_user_status_idx
    on public.job_applications (user_id, status, updated_at desc);

create index if not exists job_applications_user_applied_idx
    on public.job_applications (user_id, applied_at desc nulls last);

drop trigger if exists job_applications_set_updated_at on public.job_applications;
create trigger job_applications_set_updated_at
    before update on public.job_applications
    for each row execute function public.set_updated_at();

alter table public.job_applications enable row level security;
grant select, insert, update, delete on public.job_applications to service_role;

-- ---------------------------------------------------------------------------
-- job_cv
--   Single active CV for the owner. Extracted plain text only.
-- ---------------------------------------------------------------------------
create table if not exists public.job_cv (
    user_id uuid primary key default '00000000-0000-0000-0000-000000000001',
    filename text not null default '',
    content text not null default '',
    summary text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists job_cv_set_updated_at on public.job_cv;
create trigger job_cv_set_updated_at
    before update on public.job_cv
    for each row execute function public.set_updated_at();

alter table public.job_cv enable row level security;
grant select, insert, update, delete on public.job_cv to service_role;