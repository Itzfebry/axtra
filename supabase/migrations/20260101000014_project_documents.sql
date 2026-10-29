-- AXTRA — project documents & links (non-repo project data)
-- Free-form knowledge that belongs to a project but does NOT live in its repo:
-- pasted specs/notes/meeting minutes (kind='note') and external links
-- (kind='link'). These feed the AI health summary and the @mention chat context.

create table if not exists public.project_documents (
    id uuid primary key default extensions.gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null default '00000000-0000-0000-0000-000000000001',
    title text not null default '',
    kind text not null default 'note' check (kind in ('note', 'link')),
    url text,
    content text not null default '',
    source text not null default 'manual',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists project_documents_project_idx
    on public.project_documents (project_id, created_at desc);

drop trigger if exists project_documents_set_updated_at on public.project_documents;
create trigger project_documents_set_updated_at
    before update on public.project_documents
    for each row execute function public.set_updated_at();

alter table public.project_documents enable row level security;
grant select, insert, update, delete on public.project_documents to service_role;
