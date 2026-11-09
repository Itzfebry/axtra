"""Extract plain text from uploaded TXT/MD/PDF files.

Shared by chat document attachments and study-material imports so the format
rules stay in one place.
"""

from __future__ import annotations

import io

from fastapi import HTTPException, status

TEXT_EXTENSIONS = (".txt", ".md", ".markdown", ".csv", ".json", ".log")
PDF_EXTENSIONS = (".pdf",)


def safe_filename(name: str | None) -> str:
    base = (name or "dokumen").replace("\\", "/").split("/")[-1].strip()
    return base[:200] or "dokumen"


def extract_text(filename: str, mime_type: str, data: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(PDF_EXTENSIONS) or mime_type == "application/pdf":
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

    if lower.endswith(TEXT_EXTENSIONS) or mime_type.startswith("text/"):
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