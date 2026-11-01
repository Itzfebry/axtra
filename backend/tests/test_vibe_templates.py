"""Unit tests for the Vibe Coding template catalog and document matrix."""

from __future__ import annotations

from app.vibe_templates import (
    ARTIFACT_KINDS,
    FEATURE_SCOPES,
    TEMPLATE_ORDER,
    get_template,
    list_templates,
    resolve_required_artifacts,
    scope_artifacts,
)

EXPECTED_TEMPLATES = {
    "landing-page",
    "crud",
    "landing-crud",
    "dashboard-analytics",
    "sistem-absensi",
    "chatbot-rag",
}


def test_new_artifact_kinds_present() -> None:
    assert "DATA_MODEL" in ARTIFACT_KINDS
    assert "API_SPEC" in ARTIFACT_KINDS
    # canonical seven are preserved
    for kind in (
        "PRD",
        "ARCHITECTURE",
        "ACCEPTANCE_TEST_PLAN",
        "UI_UX_SPEC",
        "AGENT_INSTRUCTIONS",
        "IMPLEMENTATION_PLAN",
        "DEFINITION_OF_DONE",
    ):
        assert kind in ARTIFACT_KINDS


def test_list_templates_shape() -> None:
    templates = list_templates()
    assert {item["key"] for item in templates} == EXPECTED_TEMPLATES
    assert tuple(item["key"] for item in templates) == TEMPLATE_ORDER
    for item in templates:
        assert item["artifact_kinds"], item["key"]
        assert item["tech_stack_options"], item["key"]
        assert item["file_conventions"], item["key"]


def test_get_template() -> None:
    assert get_template("crud") is not None
    assert get_template("missing") is None
    assert get_template(None) is None


def test_small_scope_is_minimal() -> None:
    kinds = resolve_required_artifacts(entry_mode="brownfield", scope="small")
    assert kinds == [
        "PRD",
        "AGENT_INSTRUCTIONS",
        "IMPLEMENTATION_PLAN",
        "DEFINITION_OF_DONE",
    ]


def test_medium_scope_adds_architecture_and_tests() -> None:
    kinds = resolve_required_artifacts(entry_mode="greenfield", scope="medium")
    assert "ARCHITECTURE" in kinds
    assert "ACCEPTANCE_TEST_PLAN" in kinds


def test_large_greenfield_follows_template() -> None:
    kinds = resolve_required_artifacts(
        entry_mode="greenfield", scope="large", template_key="crud"
    )
    assert kinds == get_template("crud")["artifact_kinds"]


def test_large_brownfield_without_template_is_full_matrix() -> None:
    kinds = resolve_required_artifacts(entry_mode="brownfield", scope="large")
    assert kinds == list(ARTIFACT_KINDS)


def test_touches_data_api_adds_docs() -> None:
    kinds = resolve_required_artifacts(
        entry_mode="brownfield", scope="small", touches_data_api=True
    )
    assert "DATA_MODEL" in kinds
    assert "API_SPEC" in kinds


def test_output_is_canonical_order() -> None:
    kinds = resolve_required_artifacts(
        entry_mode="greenfield", scope="large", template_key="landing-crud"
    )
    assert kinds == [kind for kind in ARTIFACT_KINDS if kind in set(kinds)]


def test_scopes_catalog() -> None:
    assert FEATURE_SCOPES == ("small", "medium", "large")
    # a template's large set never invents kinds outside the canonical list
    for key in TEMPLATE_ORDER:
        assert set(scope_artifacts("large", key)) <= set(ARTIFACT_KINDS)
