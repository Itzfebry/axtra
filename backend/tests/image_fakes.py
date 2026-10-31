"""Shared httpx stubs for image service / router tests."""

from __future__ import annotations

from typing import Any


class FakeResponse:
    def __init__(
        self,
        status: int = 200,
        payload: object = None,
        *,
        content: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self) -> object:
        return self._payload


class FakeStream:
    def __init__(self, status: int, lines: list[str]) -> None:
        self.status_code = status
        self._lines = lines

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def aread(self) -> bytes:
        return b""

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeAsyncClient:
    get_response = FakeResponse(200, {"data": []})
    post_response = FakeResponse(200, {})
    stream_obj: FakeStream | None = None
    last_post: dict[str, Any] | None = None

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def get(self, url: str, **kwargs: object) -> FakeResponse:
        return FakeAsyncClient.get_response

    async def post(self, url: str, **kwargs: object) -> FakeResponse:
        FakeAsyncClient.last_post = kwargs.get("json")  # type: ignore[assignment]
        return FakeAsyncClient.post_response

    def stream(self, method: str, url: str, **kwargs: object) -> FakeStream:
        assert FakeAsyncClient.stream_obj is not None
        return FakeAsyncClient.stream_obj
