"""Conversation history endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import ChatMode, ConversationOut, MessageOut

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _to_conversation(row: dict[str, Any]) -> ConversationOut:
    return ConversationOut(
        id=row["id"],
        title=row.get("title"),
        mode=row.get("mode") or "general",
        summary=row.get("summary"),
        message_count=int(row.get("message_count") or 0),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        last_message_at=row.get("last_message_at"),
    )


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    user: CurrentUser = Depends(read_rate_limit),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    mode: ChatMode | None = None,
) -> list[ConversationOut]:
    query = user.client.table("conversations").select("*")
    if mode:
        query = query.eq("mode", mode)
    response = (
        await query.order("last_message_at", desc=True, nullsfirst=False)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [_to_conversation(row) for row in (response.data or [])]


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> ConversationOut:
    response = (
        await user.client.table("conversations")
        .select("*")
        .eq("id", str(conversation_id))
        .maybe_single()
        .execute()
    )
    if not response or not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Percakapan tidak ditemukan.")
    return _to_conversation(response.data)


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    user: CurrentUser = Depends(read_rate_limit),
    limit: int = Query(default=200, ge=1, le=500),
    after: str | None = None,
) -> list[MessageOut]:
    query = (
        await user.client.table("messages")
        .select("*")
        .eq("conversation_id", str(conversation_id))
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    rows: list[dict[str, Any]] = query.data or []
    if after:
        rows = [row for row in rows if (row.get("created_at") or "") > after]
    return [
        MessageOut(
            id=row["id"],
            conversation_id=row["conversation_id"],
            role=row["role"],
            content=row.get("content", ""),
            model=row.get("model"),
            token_count=row.get("token_count"),
            metadata=row.get("metadata") or {},
            created_at=row.get("created_at"),
        )
        for row in rows
    ]


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(
    conversation_id: uuid.UUID,
    title: str,
    user: CurrentUser = Depends(rate_limit),
) -> ConversationOut:
    response = (
        await user.client.table("conversations")
        .update({"title": title.strip() or None})
        .eq("id", str(conversation_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Percakapan tidak ditemukan.")
    return _to_conversation(response.data[0])


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await (
        user.client.table("conversations")
        .delete()
        .eq("id", str(conversation_id))
        .execute()
    )
