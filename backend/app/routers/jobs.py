"""Cari Kerja: job application tracker, CV matching, and cover letters."""

from __future__ import annotations

import io
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.memory_service_provider import build_llm_provider
from app.schemas import (
    JobApplicationCreate,
    JobApplicationOut,
    JobApplicationUpdate,
    JobCrawlRequest,
    JobCvOut,
    JobStatus,
)
from app.services.job_service import JobCoach
from app.services.crawl_provider import crawl, resolve_user_provider
from app.services.usage_service import record_usage
from app.services.web_crawler import CrawlError, normalize_url

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

MAX_CV_CHARS = 30000
CV_EXTENSIONS = (".txt", ".md", ".markdown", ".pdf")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_out(row: dict[str, Any]) -> JobApplicationOut:
    return JobApplicationOut(
        id=row["id"],
        company=row.get("company") or "",
        role=row.get("role") or "",
        location=row.get("location") or "",
        work_type=row.get("work_type") or "",
        salary=row.get("salary") or "",
        job_url=row.get("job_url"),
        source=row.get("source") or "manual",
        status=row.get("status") or "applied",
        applied_at=row.get("applied_at"),
        deadline=row.get("deadline"),
        notes=row.get("notes") or "",
        job_description=row.get("job_description") or "",
        job_title=row.get("job_title") or "",
        predicted_jobdesk=row.get("predicted_jobdesk") or "",
        match_score=row.get("match_score"),
        match_analysis=row.get("match_analysis") or "",
        success_score=row.get("success_score"),
        success_analysis=row.get("success_analysis") or "",
        cover_letter=row.get("cover_letter") or "",
        analyzed_at=row.get("analyzed_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


async def _get_row(client: Any, user_id: str, job_id: str) -> dict[str, Any]:
    response = (
        await client.table("job_applications")
        .select("*")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not response or not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Lamaran tidak ditemukan.")
    return response.data


async def _get_cv_text(client: Any, user_id: str) -> tuple[str, str]:
    response = (
        await client.table("job_cv")
        .select("filename, content")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    return row.get("content") or "", row.get("filename") or ""


def _safe_filename(name: str | None) -> str:
    base = (name or "cv").replace("\\", "/").split("/")[-1].strip()
    return base[:200] or "cv"


def _extract_cv_text(filename: str, mime_type: str, data: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf") or mime_type == "application/pdf":
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
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"Gagal membaca PDF: {exc}"
            ) from exc
        return "\n".join(pages).strip()

    for encoding in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").strip()


def _coach(settings: Settings) -> JobCoach:
    return JobCoach(build_llm_provider(), settings.default_chat_model)


# ---------------------------------------------------------------------------
# CV
# ---------------------------------------------------------------------------
@router.get("/cv", response_model=JobCvOut)
async def get_cv(user: CurrentUser = Depends(read_rate_limit)) -> JobCvOut:
    response = (
        await user.client.table("job_cv")
        .select("filename, content, summary, updated_at")
        .eq("user_id", user.id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    if not row:
        return JobCvOut()
    return JobCvOut(
        filename=row.get("filename") or "",
        summary=row.get("summary") or "",
        char_count=len(row.get("content") or ""),
        updated_at=row.get("updated_at"),
    )


@router.post("/cv", response_model=JobCvOut, status_code=status.HTTP_201_CREATED)
async def upload_cv(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> JobCvOut:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File CV kosong.")
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Ukuran CV melebihi batas {limit_mb} MB.",
        )

    filename = _safe_filename(file.filename)
    if not filename.lower().endswith(CV_EXTENSIONS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Format CV harus TXT, MD, atau PDF.",
        )
    text = _extract_cv_text(filename, file.content_type or "", data)
    if not text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Tidak ada teks yang bisa dibaca dari CV ini.",
        )
    content = text[:MAX_CV_CHARS]

    payload = {
        "user_id": user.id,
        "filename": filename,
        "content": content,
    }
    await (
        user.client.table("job_cv")
        .upsert(payload, on_conflict="user_id")
        .execute()
    )
    return JobCvOut(
        filename=filename,
        summary="",
        char_count=len(content),
    )


@router.delete("/cv", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cv(user: CurrentUser = Depends(rate_limit)) -> None:
    await (
        user.client.table("job_cv").delete().eq("user_id", user.id).execute()
    )


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
@router.get("", response_model=list[JobApplicationOut])
async def list_applications(
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=200),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[JobApplicationOut]:
    query = (
        user.client.table("job_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", desc=True)
    )
    if status_filter:
        query = query.eq("status", status_filter)
    response = await query.execute()
    rows = response.data or []
    term = (search or "").strip().lower()
    if term:
        rows = [
            row
            for row in rows
            if term in (row.get("company") or "").lower()
            or term in (row.get("role") or "").lower()
            or term in (row.get("location") or "").lower()
        ]
    return [_to_out(row) for row in rows]


@router.post(
    "", response_model=JobApplicationOut, status_code=status.HTTP_201_CREATED
)
async def create_application(
    payload: JobApplicationCreate,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    record = payload.model_dump(mode="json")
    # created_at has a DB default; only send it when the user set it manually.
    if record.get("created_at") is None:
        record.pop("created_at", None)
    record["user_id"] = user.id
    response = (
        await user.client.table("job_applications").insert(record).execute()
    )
    return _to_out(response.data[0])


@router.get("/{job_id}", response_model=JobApplicationOut)
async def get_application(
    job_id: str,
    user: CurrentUser = Depends(read_rate_limit),
) -> JobApplicationOut:
    return _to_out(await _get_row(user.client, user.id, job_id))


@router.patch("/{job_id}", response_model=JobApplicationOut)
async def update_application(
    job_id: str,
    payload: JobApplicationUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    await _get_row(user.client, user.id, job_id)
    patch = payload.model_dump(mode="json", exclude_unset=True)
    if patch.get("created_at") is None:
        patch.pop("created_at", None)
    if not patch:
        return _to_out(await _get_row(user.client, user.id, job_id))
    response = (
        await user.client.table("job_applications")
        .update(patch)
        .eq("id", job_id)
        .eq("user_id", user.id)
        .execute()
    )
    return _to_out(response.data[0])


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    job_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await _get_row(user.client, user.id, job_id)
    await (
        user.client.table("job_applications")
        .delete()
        .eq("id", job_id)
        .eq("user_id", user.id)
        .execute()
    )


# ---------------------------------------------------------------------------
# Actions: crawl, analyze, cover letter
# ---------------------------------------------------------------------------
@router.post("/{job_id}/crawl", response_model=JobApplicationOut)
async def crawl_application(
    job_id: str,
    payload: JobCrawlRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> JobApplicationOut:
    row = await _get_row(user.client, user.id, job_id)
    raw_url = (payload.url or row.get("job_url") or "").strip()
    if not raw_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Isi URL rekrutmen dulu sebelum crawl.",
        )
    try:
        normalized = normalize_url(raw_url)
    except CrawlError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    provider = await resolve_user_provider(user.client, user.id, settings)
    try:
        outcome = await crawl(
            normalized,
            settings=settings,
            client=user.client,
            user_id=user.id,
            provider=provider,
        )
    except CrawlError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    page = outcome.page
    patch = {
        "job_url": page.url,
        "job_title": page.title[:300],
        "job_description": page.text[:50000],
        "source": "crawl",
    }
    response = (
        await user.client.table("job_applications")
        .update(patch)
        .eq("id", job_id)
        .eq("user_id", user.id)
        .execute()
    )
    out = _to_out(response.data[0])
    out.crawl_notice = outcome.notice
    return out


@router.post("/{job_id}/analyze", response_model=JobApplicationOut)
async def analyze_application(
    job_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    row = await _get_row(user.client, user.id, job_id)
    cv_text, _ = await _get_cv_text(user.client, user.id)
    if not cv_text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Unggah CV dulu di panel CV sebelum analisa.",
        )

    application = _to_out(row)
    try:
        result, usage = await _coach(get_settings()).analyze(application, cv_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"Analisa gagal: {exc}"
        ) from exc

    from datetime import datetime, timezone

    patch = {
        **result,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    response = (
        await user.client.table("job_applications")
        .update(patch)
        .eq("id", job_id)
        .eq("user_id", user.id)
        .execute()
    )
    await record_usage(
        user.client,
        user.id,
        get_settings().default_chat_model,
        usage,
        source="jobs",
    )
    return _to_out(response.data[0])


@router.post("/{job_id}/cover-letter", response_model=JobApplicationOut)
async def generate_cover_letter(
    job_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    row = await _get_row(user.client, user.id, job_id)
    cv_text, _ = await _get_cv_text(user.client, user.id)
    application = _to_out(row)
    try:
        text, usage = await _coach(get_settings()).cover_letter(application, cv_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"Gagal membuat cover letter: {exc}"
        ) from exc

    response = (
        await user.client.table("job_applications")
        .update({"cover_letter": text})
        .eq("id", job_id)
        .eq("user_id", user.id)
        .execute()
    )
    await record_usage(
        user.client,
        user.id,
        get_settings().default_chat_model,
        usage,
        source="jobs",
    )
    return _to_out(response.data[0])