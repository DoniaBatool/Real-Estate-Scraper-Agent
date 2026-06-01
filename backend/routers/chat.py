"""
ARIA Chat Router — handles chat threads and ARIA agent turns.
Property data is fetched live via Stagehand. Only chat history is persisted.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.connection import get_db
from backend.database import crud

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

SUMMARY_REFRESH_THRESHOLD = 16   # compress older turns after this many messages
RAW_TURN_WINDOW = 10             # always keep last N raw turns in context


# ── Pydantic models ────────────────────────────────────────────────────────

class ChatThreadOut(BaseModel):
    id: UUID
    title: str
    archived: bool
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None

    class Config:
        from_attributes = True


class ChatMessageOut(BaseModel):
    id: UUID
    thread_id: UUID
    role: str
    content: str
    created_at: datetime
    meta: dict | None = None

    class Config:
        from_attributes = True


class ChatSummaryOut(BaseModel):
    summary: str
    message_count: int


class ChatThreadCreateRequest(BaseModel):
    title: str | None = None


class ChatThreadUpdateRequest(BaseModel):
    title: str | None = None
    archived: bool | None = None


class ChatMessageRequest(BaseModel):
    message: str
    user_fingerprint: str = ""
    meta: dict | None = None


class ChatReplyOut(BaseModel):
    reply: str
    action: str
    context_summary: ChatSummaryOut | None = None
    recent_turns_used: int
    message_meta: dict | None = None


class ClearAllThreadsResponse(BaseModel):
    deleted_count: int


# ── Helpers ────────────────────────────────────────────────────────────────

def _meta_from_json(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _build_summary_text(messages: list) -> str:
    bullets = []
    for m in messages[-SUMMARY_REFRESH_THRESHOLD:]:
        role = "User" if m.role == "user" else "ARIA"
        short = (m.content or "").replace("\n", " ").strip()
        if len(short) > 160:
            short = f"{short[:157]}..."
        bullets.append(f"- {role}: {short}")
    return "Conversation snapshot:\n" + "\n".join(bullets)


async def _refresh_summary_if_needed(
    db: AsyncSession, thread_id: str, messages: list
) -> None:
    if len(messages) < SUMMARY_REFRESH_THRESHOLD:
        return
    latest = await crud.get_latest_chat_summary(db, thread_id)
    if latest and latest.message_count >= len(messages):
        return
    summary = _build_summary_text(
        messages[:-RAW_TURN_WINDOW] if len(messages) > RAW_TURN_WINDOW else messages
    )
    await crud.create_chat_summary(db, thread_id, summary=summary, message_count=len(messages))


# ── Thread endpoints ───────────────────────────────────────────────────────

@router.post("/threads", response_model=ChatThreadOut)
async def create_thread(
    payload: ChatThreadCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    thread = await crud.create_chat_thread(db, title=payload.title or "New Chat")
    return ChatThreadOut.model_validate(thread)


@router.get("/threads", response_model=list[ChatThreadOut])
async def list_threads(db: AsyncSession = Depends(get_db)):
    try:
        threads = await crud.list_chat_threads(db)
        out: list[ChatThreadOut] = []
        for t in threads:
            msgs = await crud.list_chat_messages(db, str(t.id), limit=1)
            preview = msgs[0].content[:80] if msgs else None
            out.append(
                ChatThreadOut(
                    id=t.id,
                    title=t.title,
                    archived=t.archived,
                    created_at=t.created_at,
                    updated_at=t.updated_at,
                    last_message_preview=preview,
                )
            )
        return out
    except Exception as e:
        logger.warning("DB unavailable for list_threads: %s", e)
        return []


@router.get("/threads/{thread_id}", response_model=ChatThreadOut)
async def get_thread(thread_id: str, db: AsyncSession = Depends(get_db)):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ChatThreadOut.model_validate(thread)


@router.patch("/threads/{thread_id}", response_model=ChatThreadOut)
async def update_thread(
    thread_id: str,
    payload: ChatThreadUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    thread = await crud.update_chat_thread(
        db, thread_id, title=payload.title, archived=payload.archived
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ChatThreadOut.model_validate(thread)


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await crud.delete_chat_thread(db, thread_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Thread not found")


@router.delete("/threads", response_model=ClearAllThreadsResponse)
async def clear_all_threads(db: AsyncSession = Depends(get_db)):
    threads = await crud.list_chat_threads(db, include_archived=True)
    count = 0
    for t in threads:
        await crud.delete_chat_thread(db, str(t.id))
        count += 1
    return ClearAllThreadsResponse(deleted_count=count)


# ── Message endpoints ──────────────────────────────────────────────────────

@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageOut])
async def list_messages(thread_id: str, db: AsyncSession = Depends(get_db)):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = await crud.list_chat_messages(db, thread_id)
    return [
        ChatMessageOut(
            id=m.id,
            thread_id=m.thread_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            meta=_meta_from_json(m.meta_json),
        )
        for m in messages
    ]


@router.post("/threads/{thread_id}/messages", response_model=ChatReplyOut)
async def send_message(
    thread_id: str,
    payload: ChatMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    text = payload.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Save user message (include meta so reference/reply context is persisted)
    await crud.create_chat_message(db, thread_id, "user", text, meta=payload.meta)
    messages = await crud.list_chat_messages(db, thread_id)
    await _refresh_summary_if_needed(db, thread_id, messages)

    latest_summary = await crud.get_latest_chat_summary(db, thread_id)
    summary_out = (
        ChatSummaryOut(
            summary=latest_summary.summary, message_count=latest_summary.message_count
        )
        if latest_summary
        else None
    )

    # ── ARIA Agent turn ────────────────────────────────────────────────────
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured. Add it to backend/.env",
        )

    try:
        from backend.ai.aria_agent import run_aria_turn

        fingerprint = payload.user_fingerprint.strip() or thread_id
        reply, meta, action = await run_aria_turn(
            db,
            text,
            messages,
            user_fingerprint=fingerprint,
            session_id=thread_id,
        )

        # Save assistant message with meta (tool trace + scraped properties)
        await crud.create_chat_message(
            db, thread_id, "assistant", reply, meta={**meta, "action": action}
        )

        # Auto-rename thread on first message (if still default "New Chat")
        try:
            current = await crud.get_chat_thread(db, thread_id)
            if current and current.title in ("New Chat", "", None):
                raw = text.strip()
                # Strip leading emoji/punctuation for cleaner title
                import re as _re
                cleaned = _re.sub(r"^[\W_]+", "", raw).strip()
                auto_title = (cleaned or raw)[:52]
                if len(text) > 52:
                    auto_title += "…"
                await crud.update_chat_thread(db, thread_id, title=auto_title)
        except Exception:
            pass  # non-fatal

        return ChatReplyOut(
            reply=reply,
            action=action,
            context_summary=summary_out,
            recent_turns_used=min(len(messages), RAW_TURN_WINDOW),
            message_meta=meta,
        )

    except Exception as exc:
        logger.error("ARIA agent error in thread %s: %s", thread_id, exc, exc_info=True)
        fallback = (
            "I encountered an error while processing your request. "
            "Please check that OPENAI_API_KEY and BROWSERBASE credentials are configured, "
            "then try again. 🙏"
        )
        await crud.create_chat_message(db, thread_id, "assistant", fallback)
        return ChatReplyOut(
            reply=fallback,
            action="error",
            context_summary=summary_out,
            recent_turns_used=min(len(messages), RAW_TURN_WINDOW),
            message_meta={"error": str(exc)},
        )
