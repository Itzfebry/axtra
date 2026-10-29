#!/usr/bin/env python3
"""Terapkan migration via Supabase Management API (tanpa DB password).

Butuh personal access token Supabase (sbp_...): Dashboard -> Account -> Access Tokens.
Token & project ref dibaca dari root .env. Secret tidak dicetak.

Migration yang sudah pernah diterapkan dicatat di tabel
``public.schema_migrations`` sehingga run berikutnya hanya menjalankan file
baru (bukan mengulang semuanya).

Pemakaian:
    python scripts/migrate_api.py
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
API_BASE = "https://api.supabase.com/v1"

TRACKING_DDL = """
create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);
"""


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, _, value = text.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def run_query(ref: str, token: str, query: str) -> list[dict]:
    request = urllib.request.Request(
        f"{API_BASE}/projects/{ref}/database/query",
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Management API gagal ({exc.code}): {detail[:500]}") from exc
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def escape_literal(value: str) -> str:
    return value.replace("'", "''")


def main() -> int:
    env = load_env(ENV_PATH)
    token = env.get("SUPABASE_ACCESS_TOKEN", "")
    ref = env.get("SUPABASE_PROJECT_REF", "")
    if not token or not ref:
        print(
            "SUPABASE_ACCESS_TOKEN dan SUPABASE_PROJECT_REF harus diisi di root .env.\n"
            "Buat token di: https://supabase.com/dashboard/account/tokens",
            file=sys.stderr,
        )
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("Tidak ada migration.", file=sys.stderr)
        return 1

    run_query(ref, token, TRACKING_DDL)
    applied_rows = run_query(
        ref, token, "select version from public.schema_migrations"
    )
    applied = {
        str(row.get("version"))
        for row in applied_rows
        if isinstance(row, dict) and row.get("version")
    }

    ran = 0
    for path in files:
        version = path.stem
        if version in applied:
            print(f"-- {path.name} (sudah diterapkan)")
            continue
        sql = path.read_text(encoding="utf-8")
        print(f"-> {path.name}")
        run_query(ref, token, sql)
        run_query(
            ref,
            token,
            "insert into public.schema_migrations (version) values "
            f"('{escape_literal(version)}') on conflict (version) do nothing",
        )
        ran += 1

    if ran:
        print(f"Migration selesai ({ran} baru).")
    else:
        print("Semua migration sudah diterapkan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())