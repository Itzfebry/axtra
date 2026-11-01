"""Catalog of Vibe Coding project templates, tech stacks, and artifact matrices.

Code-defined (like ``feature_catalog``) so the UI and the deterministic
document matrix always stay in sync with the backend. A template only seeds
*structure* (which artifact kinds are relevant + file conventions); it never
generates code. Greenfield output stays a specification + handoff prompt.

The resolver here is the single source of truth for ``required_artifacts``:
the AI may *suggest* a scope, but the matrix decides which documents are
relevant, and the user confirms the final set.
"""

from __future__ import annotations

from typing import Any

from app.schemas import VibeArtifactKind, VibeEntryMode, VibeFeatureScope

# Canonical order used everywhere (prompt sorting, matrix output).
ARTIFACT_KINDS: tuple[VibeArtifactKind, ...] = (
    "PRD",
    "ARCHITECTURE",
    "DATA_MODEL",
    "API_SPEC",
    "ACCEPTANCE_TEST_PLAN",
    "UI_UX_SPEC",
    "AGENT_INSTRUCTIONS",
    "IMPLEMENTATION_PLAN",
    "DEFINITION_OF_DONE",
)

ARTIFACT_TITLES: dict[VibeArtifactKind, str] = {
    "PRD": "Product Requirements Document",
    "ARCHITECTURE": "Arsitektur & Desain Teknis",
    "DATA_MODEL": "Model Data",
    "API_SPEC": "Spesifikasi API",
    "ACCEPTANCE_TEST_PLAN": "Rencana Pengujian & Acceptance",
    "UI_UX_SPEC": "Spesifikasi UI/UX",
    "AGENT_INSTRUCTIONS": "Instruksi Agen Coding",
    "IMPLEMENTATION_PLAN": "Rencana Implementasi",
    "DEFINITION_OF_DONE": "Definition of Done",
}

FEATURE_SCOPES: tuple[VibeFeatureScope, ...] = ("small", "medium", "large")

# Scope floors shared by both entry modes. "large" additionally includes every
# kind a template declares. Kept intentionally small so a small feature never
# drags in a full architecture document.
_SCOPE_SMALL: tuple[VibeArtifactKind, ...] = (
    "PRD",
    "AGENT_INSTRUCTIONS",
    "IMPLEMENTATION_PLAN",
    "DEFINITION_OF_DONE",
)
_SCOPE_MEDIUM_EXTRA: tuple[VibeArtifactKind, ...] = (
    "ARCHITECTURE",
    "ACCEPTANCE_TEST_PLAN",
)

# Kinds that only make sense when a change or template touches data or an API.
_DATA_API_KINDS: tuple[VibeArtifactKind, ...] = ("DATA_MODEL", "API_SPEC")


def _template(
    key: str,
    label: str,
    description: str,
    artifact_kinds: tuple[VibeArtifactKind, ...],
    tech_stack_options: tuple[str, ...],
    file_conventions: tuple[str, ...],
    seed_docs: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "description": description,
        "artifact_kinds": list(artifact_kinds),
        "tech_stack_options": list(tech_stack_options),
        "file_conventions": list(file_conventions),
        "seed_docs": seed_docs or {},
    }


_COMMON_STACKS: tuple[str, ...] = (
    "Next.js + TypeScript + Tailwind",
    "React + Vite + TypeScript",
    "Nuxt + Vue + Tailwind",
    "Node.js (Express) + TypeScript",
    "FastAPI + Python + Jinja/HTMX",
    "Laravel + Blade + Tailwind",
    "Astro + TypeScript",
)

TEMPLATES: dict[str, dict[str, Any]] = {
    "landing-page": _template(
        "landing-page",
        "Landing page",
        "Halaman pemasaran satu arah dengan CTA.",
        (
            "PRD",
            "UI_UX_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "IMPLEMENTATION_PLAN",
            "DEFINITION_OF_DONE",
        ),
        _COMMON_STACKS,
        (
            "routes: / (single page, no auth)",
            "sections: hero, features, pricing, faq, cta, footer",
            "assets: public/ untuk gambar & ikon",
            "styling: utility classes, mobile-first",
        ),
        {
            "UI_UX_SPEC": "Fokus hierarki section, CTA, dan responsive breakpoints.",
            "PRD": "Fokus value proposition dan target audiens, bukan fitur aplikasi.",
        },
    ),
    "crud": _template(
        "crud",
        "CRUD",
        "Aplikasi data dengan operasi buat/baca/ubah/hapus.",
        (
            "PRD",
            "ARCHITECTURE",
            "DATA_MODEL",
            "API_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "IMPLEMENTATION_PLAN",
            "DEFINITION_OF_DONE",
        ),
        _COMMON_STACKS,
        (
            "routes: /items, /items/new, /items/[id]/edit",
            "layer: UI -> service -> data access",
            "validation di batas API, bukan hanya UI",
            "migrasi skema tersimpan di folder migrations",
        ),
        {
            "DATA_MODEL": "Tabel utama + kolom, tipe, relasi, index.",
            "API_SPEC": "Endpoint CRUD, payload, status code, validasi.",
            "ARCHITECTURE": "Pisahkan UI, service, dan akses data.",
        },
    ),
    "landing-crud": _template(
        "landing-crud",
        "Landing + CRUD",
        "Landing page publik plus panel CRUD terautentikasi.",
        ARTIFACT_KINDS,
        _COMMON_STACKS,
        (
            "routes: / publik, /app/* privat (auth)",
            "auth guard di layer route privat",
            "layer: UI -> service -> data access",
            "migrasi skema tersimpan di folder migrations",
        ),
        {
            "UI_UX_SPEC": "Bedakan area publik dan area terautentikasi.",
            "API_SPEC": "Endpoint publik vs endpoint butuh auth.",
        },
    ),
    "dashboard-analytics": _template(
        "dashboard-analytics",
        "Dashboard & Analytics",
        "Panel data dengan metrik, filter, dan grafik.",
        (
            "PRD",
            "ARCHITECTURE",
            "DATA_MODEL",
            "API_SPEC",
            "UI_UX_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "IMPLEMENTATION_PLAN",
            "DEFINITION_OF_DONE",
        ),
        _COMMON_STACKS,
        (
            "routes: /dashboard, /dashboard/[section]",
            "charting: satu library konsisten (mis. Recharts/Chart.js)",
            "query agregasi di backend, bukan di UI",
            "caching hasil agregat bila berat",
        ),
        {
            "DATA_MODEL": "Tabel sumber + view/agregat untuk metrik.",
            "API_SPEC": "Endpoint metrik, filter rentang waktu, paginasi.",
            "UI_UX_SPEC": "State loading, empty, dan error untuk tiap chart.",
        },
    ),
    "sistem-absensi": _template(
        "sistem-absensi",
        "Sistem absensi",
        "Check-in/out kehadiran dengan rekap.",
        (
            "PRD",
            "ARCHITECTURE",
            "DATA_MODEL",
            "API_SPEC",
            "UI_UX_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "IMPLEMENTATION_PLAN",
            "DEFINITION_OF_DONE",
        ),
        _COMMON_STACKS,
        (
            "routes: /checkin, /riwayat, /rekap",
            "zona waktu eksplisit (mis. WIB) untuk semua stempel waktu",
            "aturan telat/lembur di service, bukan UI",
            "audit trail untuk koreksi manual",
        ),
        {
            "DATA_MODEL": "Tabel kehadiran, karyawan, aturan shift.",
            "API_SPEC": "Check-in/out, rekap, koreksi (butuh role).",
            "PRD": "Definisikan aturan telat, lembur, dan izin.",
        },
    ),
    "chatbot-rag": _template(
        "chatbot-rag",
        "Chatbot RAG",
        "Chatbot yang menjawab dari basis pengetahuan.",
        (
            "PRD",
            "ARCHITECTURE",
            "DATA_MODEL",
            "API_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "IMPLEMENTATION_PLAN",
            "DEFINITION_OF_DONE",
        ),
        (
            "Next.js + TypeScript + vector DB (pgvector/Pinecone)",
            "FastAPI + Python + LangChain/LlamaIndex",
            "Node.js + TypeScript + LangChain.js",
            "Supabase (pgvector) + Next.js",
        ),
        (
            "pipeline: ingest -> chunk -> embed -> retrieve -> answer",
            "sumber jawaban wajib disertakan (sitasi)",
            "batas ukuran konteks dan fallback bila retrieval kosong",
            "konten sumber diperlakukan sebagai data tidak tepercaya",
        ),
        {
            "ARCHITECTURE": "Jelaskan pipeline RAG, pemilihan vector DB, dan chunking.",
            "DATA_MODEL": "Tabel dokumen, chunk, embedding, dan metadata sumber.",
            "API_SPEC": "Endpoint ingest, chat/stream, dan manajemen sumber.",
            "PRD": "Definisikan domain pengetahuan dan kebijakan anti-halusinasi.",
        },
    ),
}

TEMPLATE_ORDER: tuple[str, ...] = tuple(TEMPLATES.keys())


def list_templates() -> list[dict[str, Any]]:
    """Catalog for the API/UI, in a stable order."""
    return [TEMPLATES[key] for key in TEMPLATE_ORDER]


def get_template(template_key: str | None) -> dict[str, Any] | None:
    if not template_key:
        return None
    return TEMPLATES.get(template_key)


def scope_artifacts(
    scope: VibeFeatureScope, template_key: str | None = None
) -> list[VibeArtifactKind]:
    """Deterministic document floor for a scope.

    large = every kind the template declares (greenfield) or the full matrix
    (brownfield). small/medium use the shared floors.
    """
    if scope == "large":
        template = get_template(template_key)
        wanted = set(template["artifact_kinds"]) if template else set(ARTIFACT_KINDS)
    elif scope == "medium":
        wanted = set(_SCOPE_SMALL) | set(_SCOPE_MEDIUM_EXTRA)
    else:
        wanted = set(_SCOPE_SMALL)
    return [kind for kind in ARTIFACT_KINDS if kind in wanted]


def resolve_required_artifacts(
    *,
    entry_mode: VibeEntryMode,
    scope: VibeFeatureScope,
    template_key: str | None = None,
    touches_data_api: bool = False,
) -> list[VibeArtifactKind]:
    """Final document set = scope matrix, plus data/API docs when relevant.

    The AI never sets this directly; it suggests a scope and the matrix
    produces the set, which the user then confirms.
    """
    kinds = scope_artifacts(scope, template_key)
    if touches_data_api:
        kinds = list(kinds) + [k for k in _DATA_API_KINDS if k not in kinds]
    return [kind for kind in ARTIFACT_KINDS if kind in set(kinds)]
