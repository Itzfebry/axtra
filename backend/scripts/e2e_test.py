"""End-to-end smoke test: password login -> chat -> verify persistence.

Run: .venv/Scripts/python scripts/e2e_test.py
Requires backend running on :8000 and backend/.env with APP_PASSWORD.

The test logs in with the shared password, exercises one chat turn, verifies
messages/memories/retrieval, then deletes the conversation and memories it
created so the owner's data stays clean.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


async def main() -> int:
    env = load_env()
    base = "http://127.0.0.1:8000"
    password = env.get("APP_PASSWORD", "")
    if not password:
        print("FAIL: APP_PASSWORD is not set in backend/.env")
        return 1

    async with httpx.AsyncClient(timeout=90.0) as client:
        # 1. Password login (cookies are stored on the client).
        response = await client.post(f"{base}/api/auth/login", json={"password": password})
        if response.status_code != 200:
            print("FAIL login:", response.status_code, response.text[:300])
            return 1
        print("auth: OK")

        response = await client.get(f"{base}/api/auth/status")
        if not response.json().get("authenticated"):
            print("FAIL: auth status is not authenticated after login")
            return 1

        # 2. Profile
        response = await client.get(f"{base}/api/profile")
        print(f"profile: {response.status_code} {response.json().get('display_name')}")
        if response.status_code != 200:
            print("FAIL: profile endpoint")
            return 1

        # 3. Chat with memory-relevant content
        response = await client.post(
            f"{base}/api/chat",
            json={
                "message": "Halo! Perlu diingat ya: namaku Budi, aku tinggal di Bandung "
                "dan sedang belajar Next.js. Jawab singkat.",
                "use_memory": True,
            },
        )
        if response.status_code != 200:
            print("FAIL chat:", response.status_code, response.text[:400])
            return 1

        events: dict[str, dict] = {}
        reply_parts: list[str] = []
        for block in response.text.split("\n\n"):
            lines = block.strip().split("\n")
            if not lines or not lines[0].startswith("event:"):
                continue
            event = lines[0][len("event:") :].strip()
            data = json.loads(lines[1][len("data:") :]) if len(lines) > 1 else {}
            events[event] = data
            if event == "token":
                reply_parts.append(data["t"])
        print(f"chat: OK, reply: {''.join(reply_parts)[:120]!r}")
        print(f"chat events: {sorted(events)}")
        if "error" in events:
            print("FAIL chat error event:", events["error"])
            return 1

        saved = events.get("memory", {}).get("saved", [])
        saved_ids = [item["id"] for item in saved]
        if saved:
            print(f"memory saved: {saved}")

        conversation_id = events.get("meta", {}).get("conversation_id")
        print(f"conversation_id: {conversation_id}")

        # 4. Verify persistence + retrieval
        response = await client.get(f"{base}/api/conversations/{conversation_id}/messages")
        messages = response.json()
        print(f"messages persisted: {len(messages)}")
        if len(messages) != 2:
            print("FAIL: expected 2 persisted messages")
            return 1

        response = await client.get(f"{base}/api/memories")
        memories = response.json()
        print(f"memories: {len(memories)}")
        for memory in memories:
            print(f"  - [{memory['type']}] {memory['content'][:80]}")
        if not memories:
            print("FAIL: no memories extracted")
            return 1

        response = await client.get(f"{base}/api/memories/search", params={"q": "Bandung"})
        if response.status_code != 200:
            print("FAIL retrieval:", response.status_code, response.text[:300])
            return 1
        hits = response.json()
        print(f"retrieval 'Bandung': {[h['content'][:60] for h in hits]}")
        if not hits:
            print("FAIL: retrieval returned nothing for known memory")
            return 1

        # 5. Cleanup: remove conversation and memories created by this run.
        if conversation_id:
            await client.delete(f"{base}/api/conversations/{conversation_id}")
        for memory_id in saved_ids:
            await client.delete(f"{base}/api/memories/{memory_id}")
        print("cleanup: OK")

        # 6. Logout invalidates the cookie.
        await client.post(f"{base}/api/auth/logout")
        response = await client.get(f"{base}/api/auth/status")
        if response.json().get("authenticated"):
            print("FAIL: still authenticated after logout")
            return 1
        print("logout: OK")

    print("\nALL E2E CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))