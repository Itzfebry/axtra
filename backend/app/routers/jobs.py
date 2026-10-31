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
from app.llm import LLMProviderError
from app.schemas import (
    JobAnalyzeRequest,
    JobApplicationCreate,
    JobApplicationOut,
    JobApplicationUpdate,
    JobCrawlRequest,
    JobCvOut,
    JobProfileLinksUpdate,
    JobStatus,
    TokenUsageOut,
)
from app.services.feature_persona import load_feature_persona
from app.services.job_service import JobCoach
from app.services.llm_router import resolve_active_llm
from app.services.crawl_provider import crawl, resolve_user_provider
from app.services.usage_service import normalize_usage, record_usage
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


def _with_usage(
    out: JobApplicationOut, usage: dict[str, Any] | None
) -> JobApplicationOut:
    normalized = normalize_usage(usage)
    if normalized:
        out.token_usage = TokenUsageOut(**normalized)
    return out


_EMPTY_DESCRIPTION = (
    "Deskripsi lowongan masih kosong. Crawl link rekrutmen atau isi deskripsi "
    "lowongan secara manual dulu, agar analisa dan surat lamaran tidak sekadar "
    "menebak dari judul."
)


def _require_description(application: JobApplicationOut) -> None:
    if not application.job_description.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=_EMPTY_DESCRIPTION
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


async def _get_profile(client: Any, user_id: str) -> dict[str, Any]:
    response = (
        await client.table("job_cv")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return (response.data if response else None) or {}


def _cv_out(row: dict[str, Any]) -> JobCvOut:
    return JobCvOut(
        filename=row.get("filename") or "",
        summary=row.get("summary") or "",
        char_count=len(row.get("content") or ""),
        linkedin_url=row.get("linkedin_url") or "",
        portfolio_url=row.get("portfolio_url") or "",
        portfolio_chars=len(row.get("portfolio_content") or ""),
        linkedin_chars=len(row.get("linkedin_content") or ""),
        links_updated_at=row.get("links_updated_at"),
        updated_at=row.get("updated_at"),
    )


def _clean_url(value: str) -> str:
    url = (value or "").strip()
    if url and not url.lower().startswith(("http://", "https://")):
        url = f"https://{url}"
    return url[:1000]


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


async def _coach(settings: Settings, user: CurrentUser) -> JobCoach:
    llm, model = await resolve_active_llm(settings, user.client, user.id)
    return JobCoach(
        llm,
        model,
        tpm_limit=settings.model_tpm_limit,
    )


def _profile_sources(
    profile: dict[str, Any], payload: JobAnalyzeRequest | None
) -> dict[str, Any]:
    """Resolve the chosen analysis sources and validate they contain data."""
    requested = list(dict.fromkeys(payload.sources if payload else ["cv"]))
    if not requested:
        requested = ["cv"]
    include_cv = "cv" in requested
    include_portfolio = "portfolio" in requested
    include_linkedin = "linkedin" in requested

    cv_text = profile.get("content") or ""
    portfolio_url = profile.get("portfolio_url") or ""
    portfolio_text = profile.get("portfolio_content") or ""
    linkedin_url = profile.get("linkedin_url") or ""
    linkedin_text = profile.get("linkedin_content") or ""

    if include_cv and not cv_text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Unggah CV dulu di panel CV, atau pilih sumber lain.",
        )
    if include_portfolio and not (portfolio_url.strip() or portfolio_text.strip()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Isi link portfolio dulu di panel Profil kandidat.",
        )
    if include_linkedin and not (linkedin_url.strip() or linkedin_text.strip()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Isi link LinkedIn dulu di panel Profil kandidat.",
        )

    return {
        "include_cv": include_cv,
        "include_portfolio": include_portfolio,
        "include_linkedin": include_linkedin,
        "cv_text": cv_text,
        "portfolio_url": portfolio_url,
        "portfolio_text": portfolio_text,
        "linkedin_url": linkedin_url,
        "linkedin_text": linkedin_text,
    }


def _llm_http_error(exc: LLMProviderError, prefix: str) -> HTTPException:
    """Translate provider failures into a clear HTTP error."""
    raw = str(exc).lower()
    tpm_hit = (
        exc.status_code == 413
        or "tokens per minute" in raw
        or ("rate_limit_exceeded" in raw and "tokens" in raw)
    )
    if tpm_hit:
        return HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Batas token Groq per menit (TPM) terlampaui. Tunggu ±60 detik "
                "lalu coba lagi, atau kurangi sumber analisa (CV/Portfolio/LinkedIn)."
            ),
            headers={"Retry-After": "60"},
        )
    if exc.status_code == 429:
        wait = exc.retry_after
        detail = "Batas token Groq per menit tercapai."
        if wait:
            detail += f" Coba lagi dalam {wait:.1f} detik."
        detail += " Kurangi sumber analisa (CV/Portfolio/LinkedIn) bila sering terjadi."
        headers = {"Retry-After": str(max(1, int(wait or 2)))} if wait else None
        return HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail=detail, headers=headers
        )
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY, detail=f"{prefix}: {exc}"
    )


# ---------------------------------------------------------------------------
# CV
# ---------------------------------------------------------------------------
@router.get("/cv", response_model=JobCvOut)
async def get_cv(user: CurrentUser = Depends(read_rate_limit)) -> JobCvOut:
    profile = await _get_profile(user.client, user.id)
    if not profile:
        return JobCvOut()
    return _cv_out(profile)


@router.put("/cv/links", response_model=JobCvOut)
async def update_profile_links(
    payload: JobProfileLinksUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> JobCvOut:
    """Save the owner's LinkedIn + portfolio links (and optional text snapshots)."""
    from datetime import datetime, timezone

    record: dict[str, Any] = {
        "user_id": user.id,
        "linkedin_url": _clean_url(payload.linkedin_url),
        "portfolio_url": _clean_url(payload.portfolio_url),
        "links_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.portfolio_content is not None:
        record["portfolio_content"] = payload.portfolio_content.strip()[:40000]
    if payload.linkedin_content is not None:
        record["linkedin_content"] = payload.linkedin_content.strip()[:40000]

    await (
        user.client.table("job_cv")
        .upsert(record, on_conflict="user_id")
        .execute()
    )
    return _cv_out(await _get_profile(user.client, user.id))


@router.post("/cv/portfolio/crawl", response_model=JobCvOut)
async def crawl_portfolio(
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> JobCvOut:
    """Fetch the portfolio page and store its text for the analysis."""
    profile = await _get_profile(user.client, user.id)
    raw_url = (profile.get("portfolio_url") or "").strip()
    if not raw_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Isi link portfolio dulu sebelum menarik konten.",
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

    from datetime import datetime, timezone

    await (
        user.client.table("job_cv")
        .update(
            {
                "portfolio_content": (outcome.page.text or "").strip()[:40000],
                "links_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("user_id", user.id)
        .execute()
    )
    result = _cv_out(await _get_profile(user.client, user.id))
    result.summary = outcome.notice or ""
    return result


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
    return _cv_out(await _get_profile(user.client, user.id))


@router.delete("/cv", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
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


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
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
    payload: JobAnalyzeRequest | None = None,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    row = await _get_row(user.client, user.id, job_id)
    profile = await _get_profile(user.client, user.id)
    sources = _profile_sources(profile, payload)

    application = _to_out(row)
    _require_description(application)
    persona = await load_feature_persona(user.client, "jobs:analyze", user_id=user.id)
    try:
        result, usage = await (await _coach(get_settings(), user)).analyze(
            application,
            sources["cv_text"],
            persona,
            include_cv=sources["include_cv"],
            portfolio_text=sources["portfolio_text"],
            portfolio_url=sources["portfolio_url"],
            include_portfolio=sources["include_portfolio"],
            linkedin_text=sources["linkedin_text"],
            linkedin_url=sources["linkedin_url"],
            include_linkedin=sources["include_linkedin"],
        )
    except LLMProviderError as exc:
        raise _llm_http_error(exc, "Analisa gagal") from exc
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
    return _with_usage(_to_out(response.data[0]), usage)


@router.post("/{job_id}/cover-letter", response_model=JobApplicationOut)
async def generate_cover_letter(
    job_id: str,
    payload: JobAnalyzeRequest | None = None,
    user: CurrentUser = Depends(rate_limit),
) -> JobApplicationOut:
    row = await _get_row(user.client, user.id, job_id)
    profile = await _get_profile(user.client, user.id)
    sources = _profile_sources(profile, payload)
    application = _to_out(row)
    _require_description(application)
    persona = await load_feature_persona(
        user.client, "jobs:cover_letter", user_id=user.id
    )
    try:
        text, usage = await (await _coach(get_settings(), user)).cover_letter(
            application,
            sources["cv_text"],
            persona,
            include_cv=sources["include_cv"],
            portfolio_text=sources["portfolio_text"],
            portfolio_url=sources["portfolio_url"],
            include_portfolio=sources["include_portfolio"],
            linkedin_text=sources["linkedin_text"],
            linkedin_url=sources["linkedin_url"],
            include_linkedin=sources["include_linkedin"],
        )
    except LLMProviderError as exc:
        raise _llm_http_error(exc, "Gagal membuat cover letter") from exc
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
    return _with_usage(_to_out(response.data[0]), usage)