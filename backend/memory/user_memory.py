"""User memory, RAG retrieval and personalization for ARIA."""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from backend.config import settings

logger = logging.getLogger(__name__)
_client = AsyncOpenAI(api_key=settings.openai_api_key)


# ─────────────────────────────────────────
# EMBEDDINGS
# ─────────────────────────────────────────

async def _get_embedding(text_input: str) -> list[float]:
    """Get OpenAI text-embedding-3-small vector."""
    try:
        resp = await _client.embeddings.create(
            model="text-embedding-3-small",
            input=text_input[:8000],
        )
        return resp.data[0].embedding
    except Exception as exc:
        logger.warning("Embedding failed: %s", exc)
        return []


# ─────────────────────────────────────────
# STORE CONVERSATION MESSAGE + EMBEDDING
# ─────────────────────────────────────────

async def store_conversation_embedding(
    db: AsyncSession,
    *,
    user_fingerprint: str,
    session_id: str,
    message: str,
    role: str,
) -> None:
    """
    Save each chat message with vector embedding
    to conversation_embeddings table for RAG retrieval.
    """
    if not user_fingerprint or not message.strip():
        return

    sid = (session_id or user_fingerprint or "default").strip() or "default"

    try:
        embedding = await _get_embedding(message)

        if embedding:
            emb_str = (
                "[" + ",".join(map(str, embedding)) + "]"
            )
            await db.execute(text("""
                INSERT INTO conversation_embeddings
                  (session_id, user_fingerprint,
                   role, message, embedding, metadata)
                VALUES
                  (:sid, :fp, :role, :msg, :emb::vector, '{}'::jsonb)
            """), {
                "sid": sid,
                "fp": user_fingerprint,
                "role": role,
                "msg": message[:2000],
                "emb": emb_str,
            })
        else:
            await db.execute(text("""
                INSERT INTO conversation_embeddings
                  (session_id, user_fingerprint,
                   role, message, metadata)
                VALUES
                  (:sid, :fp, :role, :msg, '{}'::jsonb)
            """), {
                "sid": sid,
                "fp": user_fingerprint,
                "role": role,
                "msg": message[:2000],
            })

        await db.commit()

    except Exception as exc:
        logger.warning(
            "store_conversation_embedding error: %s", exc
        )
        await db.rollback()


# ─────────────────────────────────────────
# RAG: FIND SIMILAR PAST CONVERSATIONS
# ─────────────────────────────────────────

async def _get_similar_messages(
    db: AsyncSession,
    user_fingerprint: str,
    current_message: str,
    limit: int = 5,
) -> list[str]:
    """
    Vector similarity search over past messages.
    Returns most relevant past conversation snippets.
    """
    if not user_fingerprint:
        return []

    try:
        embedding = await _get_embedding(current_message)
        if not embedding:
            return []

        emb_str = "[" + ",".join(map(str, embedding)) + "]"

        result = await db.execute(text("""
            SELECT role, message
            FROM conversation_embeddings
            WHERE user_fingerprint = :fp
              AND embedding IS NOT NULL
            ORDER BY embedding <=> :emb::vector ASC
            LIMIT :limit
        """), {
            "fp": user_fingerprint,
            "emb": emb_str,
            "limit": limit,
        })

        rows = result.fetchall()
        return [
            f"{r.role}: {r.message}"
            for r in rows
        ]

    except Exception as exc:
        logger.warning("RAG retrieval error: %s", exc)
        return []


# ─────────────────────────────────────────
# GET USER MEMORY
# ─────────────────────────────────────────

async def _get_user_memory(
    db: AsyncSession,
    user_fingerprint: str,
) -> dict[str, Any]:
    """Fetch existing user memory row from Supabase."""
    try:
        result = await db.execute(text("""
            SELECT * FROM user_memory
            WHERE user_fingerprint = :fp
            LIMIT 1
        """), {"fp": user_fingerprint})

        row = result.fetchone()
        return dict(row._mapping) if row else {}

    except Exception as exc:
        logger.warning("get_user_memory error: %s", exc)
        return {}


# ─────────────────────────────────────────
# BUILD PERSONALIZED CONTEXT FOR ARIA
# ─────────────────────────────────────────

async def build_personalized_context(
    db: AsyncSession,
    *,
    user_fingerprint: str,
    current_message: str,
    session_id: str = "",
) -> tuple[str, dict[str, Any]]:
    """
    Build personalized system prompt context.
    Returns (context_string, meta_dict).

    This makes ARIA say:
    "Welcome back! Still looking for 3-bed in Sliema?"
    """
    if not user_fingerprint:
        return "", {}

    # Run memory + RAG in parallel
    import asyncio
    memory, similar = await asyncio.gather(
        _get_user_memory(db, user_fingerprint),
        _get_similar_messages(
            db, user_fingerprint, current_message
        ),
    )

    if not memory and not similar:
        return "", {}

    parts: list[str] = ["\n\n[PERSONALIZATION CONTEXT]"]
    meta: dict[str, Any] = {}

    total = int(memory.get("total_conversations") or 0)

    if total > 0:
        parts.append(
            f"RETURNING USER — {total} previous sessions"
        )
        meta["returning_user"] = True
        meta["total_conversations"] = total

        profile_lines: list[str] = []

        if memory.get("summary"):
            profile_lines.append(
                f"Previously looking for: {memory['summary']}"
            )
            meta["summary"] = memory["summary"]

        last_city = memory.get("last_city")
        last_country = memory.get("last_country")
        if last_city and last_country:
            profile_lines.append(
                f"Last searched: {last_city}, {last_country}"
            )
            meta["last_location"] = (
                f"{last_city}, {last_country}"
            )

        cities = memory.get("preferred_cities") or []
        if cities:
            profile_lines.append(
                f"Favourite cities: {', '.join(cities[:3])}"
            )

        min_beds = memory.get("min_bedrooms")
        if min_beds:
            profile_lines.append(
                f"Prefers {min_beds}+ bedrooms"
            )

        min_b = memory.get("min_budget")
        max_b = memory.get("max_budget")
        curr = memory.get("currency", "")
        if min_b or max_b:
            budget_str = ""
            if min_b:
                budget_str += f"Min {curr}{min_b:,.0f}"
            if max_b:
                budget_str += (
                    f" — Max {curr}{max_b:,.0f}"
                )
            profile_lines.append(f"Budget: {budget_str}")

        prop_types = (
            memory.get("preferred_property_types") or []
        )
        if prop_types:
            profile_lines.append(
                f"Property interest: "
                f"{', '.join(prop_types)}"
            )

        if memory.get("investment_interest"):
            profile_lines.append(
                "Looking for investment properties"
            )

        if profile_lines:
            parts.append(
                "USER PROFILE:\n" +
                "\n".join(f"  • {l}" for l in profile_lines)
            )

        # Welcome back instruction
        summary = memory.get("summary", "properties")
        parts.append(
            f"\nINSTRUCTION: If this is the FIRST message "
            f"of a new conversation, greet warmly:\n"
            f"'Welcome back! 😊 Last time you were "
            f"looking for {summary}. "
            f"Still searching, or exploring something new?'"
        )

    # RAG context
    if similar:
        parts.append(
            "\nRELEVANT PAST CONTEXT:\n" +
            "\n".join(f"  {m}" for m in similar[:4])
        )
        parts.append(
            "INSTRUCTION: Reference past context "
            "naturally when relevant. Example: "
            "'Based on what you were looking at before...'"
        )

    # Language preference
    lang = memory.get("language", "english")
    if lang and lang.lower() != "english":
        parts.append(
            f"USER LANGUAGE: {lang} — "
            f"respond in {lang} unless they switch"
        )

    return "\n".join(parts), meta


# ─────────────────────────────────────────
# UPDATE USER MEMORY FROM CONVERSATION
# ─────────────────────────────────────────

async def update_user_memory(
    db: AsyncSession,
    *,
    user_fingerprint: str,
    conversation_text: str,
    session_id: str = "",
) -> None:
    """
    Extract preferences from conversation using GPT-4o-mini
    and upsert into user_memory table.
    Called every 3 messages automatically.
    """
    if not user_fingerprint or not conversation_text.strip():
        return

    EXTRACT_PROMPT = f"""
Analyze this conversation and extract user preferences.
Return ONLY valid JSON — no markdown, no explanation.

{{
  "preferred_cities": [],
  "preferred_countries": [],
  "preferred_property_types": [],
  "preferred_localities": [],
  "min_budget": null,
  "max_budget": null,
  "currency": null,
  "min_bedrooms": null,
  "investment_interest": false,
  "rental_interest": false,
  "language": "english",
  "last_city": null,
  "last_country": null,
  "summary": "max 80 chars — what user is looking for"
}}

Rules:
- Only extract what is clearly stated
- language: detect from user messages (english/urdu/arabic)
- summary: very short, specific
- null if not mentioned

Conversation:
{conversation_text[-3000:]}
"""

    try:
        resp = await _client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": EXTRACT_PROMPT}
            ],
            max_tokens=400,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()

        # Strip markdown if present
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(
                lines[1:-1] if lines[-1].strip() == "```"
                else lines[1:]
            )

        prefs = json.loads(raw)

    except Exception as exc:
        logger.warning(
            "update_user_memory extract error: %s", exc
        )
        return

    # Helper to merge arrays
    def _merge(old: list, new: list) -> list:
        return list(dict.fromkeys((old or []) + (new or [])))

    try:
        existing = await _get_user_memory(
            db, user_fingerprint
        )

        if existing:
            await db.execute(text("""
                UPDATE user_memory SET
                  preferred_cities = :cities,
                  preferred_countries = :countries,
                  preferred_property_types = :types,
                  preferred_localities = :localities,
                  min_budget = COALESCE(
                    :min_b, min_budget),
                  max_budget = COALESCE(
                    :max_b, max_budget),
                  currency = COALESCE(
                    :curr, currency),
                  min_bedrooms = COALESCE(
                    :beds, min_bedrooms),
                  investment_interest = :invest,
                  rental_interest = :rental,
                  language = COALESCE(
                    :lang, language),
                  last_city = COALESCE(
                    :lcity, last_city),
                  last_country = COALESCE(
                    :lctry, last_country),
                  summary = COALESCE(
                    :summ, summary),
                  total_conversations = (
                    total_conversations + 1),
                  last_seen = NOW(),
                  updated_at = NOW()
                WHERE user_fingerprint = :fp
            """), {
                "fp": user_fingerprint,
                "cities": _merge(
                    existing.get("preferred_cities"),
                    prefs.get("preferred_cities")
                ),
                "countries": _merge(
                    existing.get("preferred_countries"),
                    prefs.get("preferred_countries")
                ),
                "types": _merge(
                    existing.get("preferred_property_types"),
                    prefs.get("preferred_property_types")
                ),
                "localities": _merge(
                    existing.get("preferred_localities"),
                    prefs.get("preferred_localities")
                ),
                "min_b": prefs.get("min_budget"),
                "max_b": prefs.get("max_budget"),
                "curr": prefs.get("currency"),
                "beds": prefs.get("min_bedrooms"),
                "invest": bool(
                    prefs.get("investment_interest")
                ),
                "rental": bool(
                    prefs.get("rental_interest")
                ),
                "lang": prefs.get("language"),
                "lcity": prefs.get("last_city"),
                "lctry": prefs.get("last_country"),
                "summ": prefs.get("summary"),
            })

        else:
            await db.execute(text("""
                INSERT INTO user_memory (
                  user_fingerprint,
                  preferred_cities, preferred_countries,
                  preferred_property_types,
                  preferred_localities,
                  min_budget, max_budget, currency,
                  min_bedrooms, investment_interest,
                  rental_interest, language,
                  last_city, last_country, summary,
                  total_conversations, last_seen
                ) VALUES (
                  :fp,
                  :cities, :countries, :types,
                  :localities,
                  :min_b, :max_b, :curr,
                  :beds, :invest, :rental, :lang,
                  :lcity, :lctry, :summ,
                  1, NOW()
                )
            """), {
                "fp": user_fingerprint,
                "cities": (
                    prefs.get("preferred_cities") or []
                ),
                "countries": (
                    prefs.get("preferred_countries") or []
                ),
                "types": (
                    prefs.get(
                        "preferred_property_types"
                    ) or []
                ),
                "localities": (
                    prefs.get("preferred_localities") or []
                ),
                "min_b": prefs.get("min_budget"),
                "max_b": prefs.get("max_budget"),
                "curr": prefs.get("currency"),
                "beds": prefs.get("min_bedrooms"),
                "invest": bool(
                    prefs.get("investment_interest", False)
                ),
                "rental": bool(
                    prefs.get("rental_interest", False)
                ),
                "lang": prefs.get("language", "english"),
                "lcity": prefs.get("last_city"),
                "lctry": prefs.get("last_country"),
                "summ": prefs.get("summary"),
            })

        await db.commit()
        logger.info(
            "Memory updated for %s", user_fingerprint
        )

    except Exception as exc:
        logger.warning(
            "update_user_memory DB error: %s", exc
        )
        await db.rollback()
