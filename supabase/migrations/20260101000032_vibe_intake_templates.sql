-- AXTRA — Vibe Coding: intake modes, feature scope, and extra document kinds
--
-- Adds a one-flow intake for existing projects (brownfield) and new projects
-- (greenfield). entry_mode is an attribute of the session, not a separate code
-- path; both converge on intake -> discovery -> specification -> planning ->
-- verification. See docs/vibe-intake-templates.md.
--
-- Design notes:
-- * feature_scope is null until the user confirms an AI suggestion.
-- * required_artifacts is the confirmed document set (snapshot for UI/prompt);
--   the deterministic matrix in code stays the source of truth.
-- * baseline_commit / baseline_indexed_at snapshot a brownfield repo so
--   verification can compare against the state when the session started.
-- * The seven canonical artifact kinds are kept; DATA_MODEL and API_SPEC are
--   added for templates and data/API changes.

-- ---------------------------------------------------------------------------
-- vibe_sessions — intake attributes
-- ---------------------------------------------------------------------------
alter table public.vibe_sessions
    add column if not exists entry_mode text not null default 'greenfield',
    add column if not exists template_key text,
    add column if not exists feature_scope text,
    add column if not exists required_artifacts text[] not null default '{}',
    add column if not exists baseline_commit text,
    add column if not exists baseline_indexed_at timestamptz;

drop constraint if exists vibe_sessions_entry_mode_check on public.vibe_sessions;
alter table public.vibe_sessions
    add constraint vibe_sessions_entry_mode_check
    check (entry_mode in ('brownfield', 'greenfield'));

drop constraint if exists vibe_sessions_feature_scope_check on public.vibe_sessions;
alter table public.vibe_sessions
    add constraint vibe_sessions_feature_scope_check
    check (feature_scope is null or feature_scope in ('small', 'medium', 'large'));

-- Add the "intake" stage ahead of discovery.
drop constraint if exists vibe_sessions_stage_check on public.vibe_sessions;
alter table public.vibe_sessions
    add constraint vibe_sessions_stage_check
    check (
        stage in ('intake', 'discovery', 'specification', 'planning', 'verification')
    );

create index if not exists vibe_sessions_entry_mode_idx
    on public.vibe_sessions (entry_mode);

-- ---------------------------------------------------------------------------
-- vibe_artifacts — extend allowed kinds
-- ---------------------------------------------------------------------------
drop constraint if exists vibe_artifacts_kind_check on public.vibe_artifacts;
alter table public.vibe_artifacts
    add constraint vibe_artifacts_kind_check
    check (
        kind in (
            'PRD', 'ARCHITECTURE', 'DATA_MODEL', 'API_SPEC',
            'ACCEPTANCE_TEST_PLAN', 'UI_UX_SPEC', 'AGENT_INSTRUCTIONS',
            'IMPLEMENTATION_PLAN', 'DEFINITION_OF_DONE'
        )
    );
