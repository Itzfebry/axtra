-- AXTRA — project labels
-- Free-form labels/tags per project (e.g. "Landing page", "CRUD").
-- Single-user mode: RLS already enabled on public.projects with no policies.

alter table public.projects
    add column if not exists labels jsonb not null default '[]'::jsonb;

-- Constraint: labels must be a JSON array of strings.
alter table public.projects
    drop constraint if exists projects_labels_is_array;
alter table public.projects
    add constraint projects_labels_is_array
    check (jsonb_typeof(labels) = 'array');