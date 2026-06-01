"""
CRUD — chat history + session state operations.
Property data is never stored; it comes live from Stagehand.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from backend.database.models import ChatThread, ChatMessage, ChatSummary, ChatToolRun

logger = logging.getLogger(__name__)


# ── Session State ──────────────────────────────────────────────────────────
#
# Shape of state_json (stored on ChatThread):
# {
#   "preferences": {          ← what the user explicitly told us
#     "category": "rent",
#     "property_type": "apartment",
#     "bedrooms": 3,
#     "bathrooms": 2,
#     "locality": "Sliema",
#     "city": "Malta",
#     "country": "Malta",
#     "min_price": null,
#     "max_price": null
#   },
#   "agency_list": [          ← from find_agencies call
#     {"name": "...", "website": "https://..."},
#     ...
#   ],
#   "current_agency_index": 0,
#   "search_phase": "clarifying"  ← clarifying | showing_results | navigating
# }


_EMPTY_STATE: dict[str, Any] = {
    "preferences": {},
    "agency_list": [],
    "current_agency_index": 0,
    "search_phase": "clarifying",
}


async def get_thread_state(db: AsyncSession, thread_id: str) -> dict[str, Any]:
    """Load session state for a thread. Returns empty state if none saved yet."""
    try:
        thread = await get_chat_thread(db, thread_id)
        if not thread or not thread.state_json:
            return dict(_EMPTY_STATE)
        loaded = json.loads(thread.state_json)
        # Ensure all keys exist (forward-compat if schema grows)
        state = dict(_EMPTY_STATE)
        state.update(loaded)
        return state
    except Exception as exc:
        logger.warning("get_thread_state error (non-fatal): %s", exc)
        return dict(_EMPTY_STATE)


async def update_thread_state(
    db: AsyncSession,
    thread_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    """
    Merge `updates` into the thread's state and persist.
    Only keys present in `updates` are changed — others are preserved.

    Example:
        await update_thread_state(db, tid, {"preferences": {"bedrooms": 3}})
        # merges into existing preferences, doesn't wipe other pref keys

    Special behaviour: if updates["preferences"] is a dict, it is MERGED
    (not replaced) into the existing preferences dict.
    """
    try:
        state = await get_thread_state(db, thread_id)

        for key, val in updates.items():
            if key == "preferences" and isinstance(val, dict):
                # Deep-merge preferences — don't wipe unmentioned fields
                state["preferences"] = {**state.get("preferences", {}), **val}
            else:
                state[key] = val

        thread = await get_chat_thread(db, thread_id)
        if thread:
            thread.state_json = json.dumps(state)
            await db.commit()
        return state
    except Exception as exc:
        logger.warning("update_thread_state error (non-fatal): %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass
        return updates


async def clear_thread_state(db: AsyncSession, thread_id: str) -> None:
    """Reset thread state to empty (e.g. when user starts a fresh search)."""
    try:
        thread = await get_chat_thread(db, thread_id)
        if thread:
            thread.state_json = json.dumps(_EMPTY_STATE)
            await db.commit()
    except Exception as exc:
        logger.warning("clear_thread_state error (non-fatal): %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass


# ── Threads ────────────────────────────────────────────────────────────────

async def create_chat_thread(db: AsyncSession, title: str = "New Chat") -> ChatThread:
    thread = ChatThread(title=title)
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return thread


async def list_chat_threads(db: AsyncSession, include_archived: bool = False) -> list[ChatThread]:
    stmt = select(ChatThread)
    if not include_archived:
        stmt = stmt.where(ChatThread.archived.is_(False))
    stmt = stmt.order_by(ChatThread.updated_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_chat_thread(db: AsyncSession, thread_id: str) -> ChatThread | None:
    result = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    return result.scalar_one_or_none()


async def update_chat_thread(
    db: AsyncSession,
    thread_id: str,
    *,
    title: str | None = None,
    archived: bool | None = None,
) -> ChatThread | None:
    thread = await get_chat_thread(db, thread_id)
    if not thread:
        return None
    if title is not None:
        thread.title = title
    if archived is not None:
        thread.archived = archived
    await db.commit()
    await db.refresh(thread)
    return thread


async def delete_chat_thread(db: AsyncSession, thread_id: str) -> bool:
    thread = await get_chat_thread(db, thread_id)
    if not thread:
        return False
    await db.delete(thread)
    await db.commit()
    return True


# ── Messages ───────────────────────────────────────────────────────────────

async def create_chat_message(
    db: AsyncSession,
    thread_id: str,
    role: str,
    content: str,
    meta: dict | None = None,
) -> ChatMessage:
    message = ChatMessage(
        thread_id=thread_id,
        role=role,
        content=content,
        meta_json=json.dumps(meta) if meta else None,
    )
    db.add(message)
    # Bump thread updated_at
    thread = await get_chat_thread(db, thread_id)
    if thread:
        from datetime import datetime, timezone
        thread.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(message)
    return message


async def list_chat_messages(
    db: AsyncSession, thread_id: str, limit: int = 200
) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


# ── Summaries ──────────────────────────────────────────────────────────────

async def get_latest_chat_summary(db: AsyncSession, thread_id: str) -> ChatSummary | None:
    stmt = (
        select(ChatSummary)
        .where(ChatSummary.thread_id == thread_id)
        .order_by(ChatSummary.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_chat_summary(
    db: AsyncSession, thread_id: str, summary: str, message_count: int
) -> ChatSummary:
    row = ChatSummary(thread_id=thread_id, summary=summary, message_count=message_count)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ── Tool runs ──────────────────────────────────────────────────────────────

async def create_chat_tool_run(
    db: AsyncSession,
    thread_id: str,
    tool_name: str,
    tool_args: dict | None = None,
    rationale: str | None = None,
    message_id: str | None = None,
    status: str = "started",
    output: dict | None = None,
) -> ChatToolRun:
    row = ChatToolRun(
        thread_id=thread_id,
        message_id=message_id,
        tool_name=tool_name,
        tool_args_json=json.dumps(tool_args) if tool_args else None,
        rationale=rationale,
        status=status,
        output_json=json.dumps(output) if output else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
