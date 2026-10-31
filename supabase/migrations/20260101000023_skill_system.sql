-- AXTRA — structured AI skills (migrasi dari field teks bebas).
--
-- Alur:
--   * skills lama skema per-fitur (feature + instruction) dipindahkan ke
--     feature_skills, lalu kolom feature di-drop.
--   * instruction -> content (Markdown).
--   * metadata baru: slug, category, version, source, license, status.
--
-- Aman untuk tabel yang belum dipakai aplikasi, dan tetap non-destruktif:
-- assignment lama disalin dulu sebelum kolom feature dihapus.

-- 1) Konten: instruction -> content
alter table public.skills rename column instruction to content;

-- 2) Metadata baru
alter table public.skills add column if not exists slug text;
alter table public.skills add column if not exists category text not null default 'general';
alter table public.skills add column if not exists version text not null default '1';
alter table public.skills add column if not exists source text not null default 'custom';
alter table public.skills add column if not exists license text not null default '';
alter table public.skills add column if not exists status text not null default 'active';

-- 3) Backfill slug dari name (fallback id agar tetap unik)
update public.skills
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
where slug is null;

update public.skills
set slug = coalesce(nullif(slug, ''), 'skill') || '-' || left(id::text, 8)
where slug is null or slug = '';

alter table public.skills alter column slug set not null;

-- 4) Ganti constraint lama
alter table public.skills drop constraint if exists skills_user_feature_name_key;
alter table public.skills
    add constraint skills_user_slug_key unique (user_id, slug);
alter table public.skills
    add constraint skills_source_check check (source in ('custom', 'imported', 'ai_generated'));
alter table public.skills
    add constraint skills_status_check check (status in ('draft', 'active', 'disabled'));

-- 5) Relasi many-to-many fitur <-> skill
create table if not exists public.feature_skills (
    feature text not null,
    skill_id uuid not null references public.skills (id) on delete cascade,
    position integer not null default 0,
    created_at timestamptz not null default now(),
    primary key (feature, skill_id)
);

create index if not exists feature_skills_feature_idx
    on public.feature_skills (feature, position);

-- 6) Salin assignment lama sebelum kolom feature dihapus
insert into public.feature_skills (feature, skill_id)
select feature, id from public.skills where feature is not null
on conflict do nothing;

alter table public.skills drop column if exists feature;

-- 7) Index & akses
create index if not exists skills_user_status_idx
    on public.skills (user_id, status, category);

alter table public.skills enable row level security;
alter table public.feature_skills enable row level security;
grant select, insert, update, delete on public.skills to service_role;
grant select, insert, update, delete on public.feature_skills to service_role;