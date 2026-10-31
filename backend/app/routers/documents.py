"""Document attachments for Document-mode chats.

Only extracted plain text is stored; the original binary is discarded. Text is
scoped to a single conversation and injected as context by the chat service.
"""

from __future__ import annotations

import io
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import DocumentOut

router = APIRouter(prefix="/api/documents", tags=["documents"])

_TEXT_EXTENSIONS = (".txt", ".md", ".markdown", ".csv", ".json", ".log")
_PDF_EXTENSIONS = (".pdf",)
MAX_DOCUMENTS_PER_CONVERSATION = 10


def _safe_filename(name: str | None) -> str:
    base = (name or "dokumen").replace("\\", "/").split("/")[-1].strip()
    return base[:200] or "dokumen"


def _extract_text(filename: str, mime_type: str, data: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(_PDF_EXTENSIONS) or mime_type == "application/pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Dukungan PDF belum terpasang di server.",
            ) from exc
        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [(page.extract_text() or "") for page in reader.pages]
        except Exception as exc:  # noqa: BLE001 - surface a friendly error
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Gagal membaca PDF: {exc}",
            ) from exc
        return "\n".join(pages).strip()

    if lower.endswith(_TEXT_EXTENSIONS) or mime_type.startswith("text/"):
        for encoding in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
            try:
                return data.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="replace").strip()

    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        detail="Format tidak didukung. Gunakan TXT, MD, atau PDF.",
    )


async def _resolve_conversation(
    client: Any, user_id: str, conversation_id: str | None
) -> str:
    if conversation_id:
        response = (
            await client.table("conversations")
            .select("id, mode")
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not response or not response.data:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Percakapan tidak ditemukan.")
        if (response.data.get("mode") or "general") != "document":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Lampiran hanya tersedia pada mode Document.",
            )
        return response.data["id"]

    created = (
        await client.table("conversations")
        .insert({"user_id": user_id, "title": None, "mode": "document"})
        .execute()
    )
    return created.data[0]["id"]


def _to_document(row: dict[str, Any]) -> DocumentOut:
    return DocumentOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        filename=row.get("filename") or "dokumen",
        mime_type=row.get("mime_type") or "text/plain",
        size_bytes=int(row.get("size_bytes") or 0),
        created_at=row.get("created_at"),
    )


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> DocumentOut:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File kosong.")
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Ukuran file melebihi batas {limit_mb} MB.",
        )

    filename = _safe_filename(file.filename)
    mime_type = file.content_type or "text/plain"
    text = _extract_text(filename, mime_type, data)
    if not text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Tidak ada teks yang bisa dibaca dari file ini.",
        )

    conversation_id = await _resolve_conversation(user.client, user.id, conversation_id)

    count = (
        await user.client.table("chat_documents")
        .select("id", count="exact")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    if int(count.count or 0) >= MAX_DOCUMENTS_PER_CONVERSATION:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Maksimal {MAX_DOCUMENTS_PER_CONVERSATION} dokumen per percakapan.",
        )

    response = (
        await user.client.table("chat_documents")
        .insert(
            {
                "user_id": user.id,
                "conversation_id": conversation_id,
                "filename": filename,
                "mime_type": mime_type,
                "size_bytes": len(data),
                "content": text,
            }
        )
        .execute()
    )
    return _to_document(response.data[0])


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    conversation_id: str = Query(..., min_length=1),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[DocumentOut]:
    response = (
        await user.client.table("chat_documents")
        .select("id, conversation_id, filename, mime_type, size_bytes, created_at")
        .eq("conversation_id", conversation_id)
        .eq("user_id", user.id)
        .order("created_at")
        .execute()
    )
    return [_to_document(row) for row in (response.data or [])]


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_document(
    document_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await (
        user.client.table("chat_documents")
        .delete()
        .eq("id", document_id)
        .eq("user_id", user.id)
        .execute()
    )