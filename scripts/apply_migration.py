"""Apply a SQL migration file to the Supabase Postgres database.

Reads SUPABASE_DB_URL from the root .env and executes the given SQL file.
Used when the Supabase CLI is unavailable/unlinked; the SQL itself is written
to be idempotent (add column if not exists, drop constraint if exists).
"""

from __future__ import annotations

import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent


def db_url() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key.strip() == "SUPABASE_DB_URL" and value.strip():
            return value.strip()
    raise SystemExit("SUPABASE_DB_URL not found in .env")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: apply_migration.py <sql-file>")
    sql_path = Path(sys.argv[1])
    if not sql_path.is_absolute():
        sql_path = ROOT / sql_path
    sql = sql_path.read_text(encoding="utf-8")
    url = db_url()
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
    print(f"applied {sql_path.name}")


if __name__ == "__main__":
    main()
