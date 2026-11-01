"""PWA Web Push endpoints: config, subscribe/unsubscribe, test send."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.config import get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import (
    PushConfigOut,
    PushResultOut,
    PushSubscriptionIn,
    PushUnsubscribeIn,
)
from app.services.push_service import (
    delete_subscription,
    save_subscription,
    send_push,
)

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/config", response_model=PushConfigOut)
async def push_config(
    user: CurrentUser = Depends(read_rate_limit),
) -> PushConfigOut:
    settings = get_settings()
    return PushConfigOut(
        enabled=settings.push_ready,
        public_key=settings.vapid_public_key if settings.push_ready else "",
    )


@router.post(
    "/subscribe", response_model=PushResultOut, status_code=status.HTTP_201_CREATED
)
async def push_subscribe(
    payload: PushSubscriptionIn, user: CurrentUser = Depends(rate_limit)
) -> PushResultOut:
    await save_subscription(
        user.client,
        user.id,
        endpoint=payload.endpoint,
        p256dh=payload.keys["p256dh"],
        auth=payload.keys["auth"],
        user_agent=payload.user_agent,
    )
    return PushResultOut(ok=True)


@router.post(
    "/unsubscribe", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def push_unsubscribe(
    payload: PushUnsubscribeIn, user: CurrentUser = Depends(rate_limit)
) -> None:
    await delete_subscription(user.client, user.id, payload.endpoint)


@router.post("/test", response_model=PushResultOut)
async def push_test(user: CurrentUser = Depends(rate_limit)) -> PushResultOut:
    settings = get_settings()
    sent, failed, removed = await send_push(
        user.client,
        settings,
        user.id,
        title="Axtra",
        body="Notifikasi uji coba. Web Push aktif.",
        url="/jadwal",
        tag="axtra-test",
    )
    return PushResultOut(ok=True, sent=sent, failed=failed, removed=removed)
