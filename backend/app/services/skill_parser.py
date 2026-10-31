"""Parse Agent Skills-compatible ``SKILL.md`` documents.

Only the small YAML subset used by SKILL.md frontmatter is supported, so no
extra YAML dependency is required. Parsing never executes or evaluates content:
frontmatter is split from the Markdown body, and the body is preserved verbatim.

Supported frontmatter keys: ``name``, ``description``, ``license`` and a
``metadata`` block of ``key: value`` pairs. Unknown top-level keys are ignored;
malformed lines raise :class:`SkillParseError` with a line number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_FRONTMATTER_KEYS = {"name", "description", "license", "metadata"}
_SLUG_RE = re.compile(r"[^a-z0-9]+")


class SkillParseError(ValueError):
    """Raised when a SKILL.md document cannot be parsed safely."""


@dataclass
class ParsedSkill:
    name: str
    description: str = ""
    license: str = ""
    metadata: dict[str, str] = field(default_factory=dict)
    content: str = ""


def slugify(value: str, *, fallback: str = "skill") -> str:
    """Return an ASCII slug suitable for the unique ``skills.slug`` column."""
    slug = _SLUG_RE.sub("-", value.strip().lower()).strip("-")
    slug = slug[:80].strip("-")
    return slug or fallback


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def _split_frontmatter(raw: str) -> tuple[list[str] | None, str]:
    """Return ``(frontmatter_lines, body)`` or ``(None, raw)`` when absent."""
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, raw
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return lines[1:index], "\n".join(lines[index + 1 :])
    raise SkillParseError(
        "Frontmatter dibuka dengan '---' di baris 1 tetapi tidak ditutup."
    )


def _parse_frontmatter(lines: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    scalar: dict[str, str] = {}
    metadata: dict[str, str] = {}
    block: str | None = None

    for offset, line in enumerate(lines, start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        stripped = line.strip()
        key, sep, value = stripped.partition(":")
        if not sep:
            raise SkillParseError(
                f"Baris {offset}: frontmatter harus berformat 'key: value'."
            )
        key = key.strip()
        value = _unquote(value)
        indented = line[:1].isspace()

        if indented:
            if block != "metadata":
                raise SkillParseError(
                    f"Baris {offset}: indentasi tidak dikenal di luar 'metadata:'."
                )
            if not key:
                raise SkillParseError(f"Baris {offset}: kunci metadata kosong.")
            metadata[key] = value
            continue

        if key == "metadata":
            block = "metadata"
            continue

        block = None
        if key not in _FRONTMATTER_KEYS:
            # Unknown keys are ignored rather than discarding the document.
            continue
        if key in scalar:
            raise SkillParseError(f"Baris {offset}: kunci '{key}' duplikat.")
        scalar[key] = value

    return scalar, metadata


def parse_skill_md(raw: str, *, fallback_name: str = "") -> ParsedSkill:
    """Parse a SKILL.md string into metadata + Markdown content."""
    if not isinstance(raw, str) or not raw.strip():
        raise SkillParseError("Dokumen SKILL.md kosong.")

    frontmatter, body = _split_frontmatter(raw)
    scalar: dict[str, str] = {}
    metadata: dict[str, str] = {}
    if frontmatter is not None:
        scalar, metadata = _parse_frontmatter(frontmatter)

    name = scalar.get("name", "").strip() or fallback_name.strip()
    if not name:
        raise SkillParseError("Field 'name' wajib ada di frontmatter atau isi nama manual.")

    content = body.strip()
    if not content:
        raise SkillParseError("Isi Markdown skill kosong setelah frontmatter.")

    return ParsedSkill(
        name=name,
        description=scalar.get("description", "").strip(),
        license=scalar.get("license", "").strip(),
        metadata=metadata,
        content=content,
    )