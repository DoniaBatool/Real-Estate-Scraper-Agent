import json
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.models import UserMemory

client = AsyncOpenAI(api_key=settings.openai_api_key)


async def get_embedding(text_value: str) -> list[float]:
    """Get OpenAI embedding for text."""
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text_value,
    )
    return response.data[0].embedding


async def get_or_create_user_memory(
    db: AsyncSession,
    user_fingerprint: str,
    session_id: str | None = None,
) -> UserMemory:
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_fingerprint == user_fingerprint)
    )
    memory = result.scalars().first()

    if not memory:
        memory = UserMemory(
            user_fingerprint=user_fingerprint,
            session_id=session_id,
            total_conversations=0,
            raw_preferences={},
        )
        db.add(memory)
        await db.commit()
        await db.refresh(memory)
    return memory


async def update_user_memory(
    db: AsyncSession,
    user_fingerprint: str,
    conversation_text: str,
    session_id: str | None = None,
) -> None:
    """
    Extract user preferences using GPT and persist merged memory.
    """
    extract_prompt = f"""
Analyze this conversation and extract user preferences.
Return ONLY valid JSON — no markdown.

{{
  "preferred_cities": [],
  "preferred_countries": [],
  "preferred_property_types": [],
  "min_budget": null,
  "max_budget": null,
  "currency": null,
  "min_bedrooms": null,
  "preferred_localities": [],
  "investment_interest": false,
  "rental_interest": false,
  "language": "english",
  "summary": "one sentence summary of user interests"
}}

Conversation:
{conversation_text[-3000:]}
"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": extract_prompt}],
            max_tokens=500,
        )
        prefs = json.loads((response.choices[0].message.content or "").strip())
    except Exception:
        return

    memory = await get_or_create_user_memory(db, user_fingerprint, session_id=session_id)

    existing_cities = memory.preferred_cities or []
    new_cities = list(set(existing_cities + (prefs.get("preferred_cities") or [])))

    await db.execute(
        update(UserMemory)
        .where(UserMemory.user_fingerprint == user_fingerprint)
        .values(
            session_id=session_id or memory.session_id,
            preferred_cities=new_cities or memory.preferred_cities,
            preferred_countries=list(
                set((memory.preferred_countries or []) + (prefs.get("preferred_countries") or []))
            ),
            preferred_property_types=list(
                set((memory.preferred_property_types or []) + (prefs.get("preferred_property_types") or []))
            ),
            min_budget=prefs.get("min_budget") or memory.min_budget,
            max_budget=prefs.get("max_budget") or memory.max_budget,
            currency=prefs.get("currency") or memory.currency,
            min_bedrooms=prefs.get("min_bedrooms") or memory.min_bedrooms,
            preferred_localities=list(
                set((memory.preferred_localities or []) + (prefs.get("preferred_localities") or []))
            ),
            investment_interest=bool(prefs.get("investment_interest") or memory.investment_interest),
            rental_interest=bool(prefs.get("rental_interest") or memory.rental_interest),
            language=prefs.get("language") or memory.language,
            summary=prefs.get("summary") or memory.summary,
            total_conversations=(memory.total_conversations or 0) + 1,
            last_seen=text("NOW()"),
            updated_at=text("NOW()"),
            raw_preferences=prefs,
        )
    )
    await db.commit()


async def store_conversation_embedding(
    db: AsyncSession,
    user_fingerprint: str,
    session_id: str,
    message: str,
    role: str,
) -> None:
    """
    Store conversation embedding row via raw SQL (pgvector-compatible).
    """
    try:
        embedding = await get_embedding(message)
        emb_str = "[" + ",".join(map(str, embedding)) + "]"
        await db.execute(
            text(
                """
                INSERT INTO conversation_embeddings
                (session_id, user_fingerprint, message, role, embedding, metadata)
                VALUES (:session_id, :user_fingerprint, :message, :role, :embedding::vector, :metadata::jsonb)
                """
            ),
            {
                "session_id": session_id,
                "user_fingerprint": user_fingerprint,
                "message": message,
                "role": role,
                "embedding": emb_str,
                "metadata": json.dumps({"length": len(message)}),
            },
        )
        await db.commit()
    except Exception:
        await db.rollback()


async def get_similar_conversations(
    db: AsyncSession,
    user_fingerprint: str,
    current_message: str,
    limit: int = 5,
) -> list[str]:
    """RAG retrieval: nearest historical conversation snippets."""
    try:
        embedding = await get_embedding(current_message)
        embedding_str = "[" + ",".join(map(str, embedding)) + "]"
        result = await db.execute(
            text(
                """
                SELECT message, role, created_at
                FROM conversation_embeddings
                WHERE user_fingerprint = :fingerprint
                ORDER BY embedding <=> :embedding::vector
                LIMIT :limit
                """
            ),
            {"fingerprint": user_fingerprint, "embedding": embedding_str, "limit": limit},
        )
        rows = result.fetchall()
        return [f"{r.role}: {r.message}" for r in rows]
    except Exception:
        return []


async def build_personalized_context(
    db: AsyncSession,
    user_fingerprint: str,
    current_message: str,
    session_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """
    Build personalized context for system prompt and return meta hints.
    """
    memory = await get_or_create_user_memory(db, user_fingerprint, session_id=session_id)
    similar = await get_similar_conversations(db, user_fingerprint, current_message)

    if (memory.total_conversations or 0) == 0:
        return "", {"is_returning_user": False}

    context_parts = ["\n\n[USER MEMORY — Use this to personalize your response]"]
    context_parts.append(f"Returning user — {memory.total_conversations} previous conversations")

    if memory.preferred_cities:
        context_parts.append(f"Interested in cities: {', '.join(memory.preferred_cities)}")
    if memory.preferred_property_types:
        context_parts.append(f"Property types: {', '.join(memory.preferred_property_types)}")
    if memory.min_budget or memory.max_budget:
        budget_str = ""
        if memory.min_budget:
            budget_str += f"Min: {memory.currency or ''}{memory.min_budget:,.0f}"
        if memory.max_budget:
            budget_str += f" Max: {memory.currency or ''}{memory.max_budget:,.0f}"
        context_parts.append(f"Budget range: {budget_str.strip()}")
    if memory.min_bedrooms:
        context_parts.append(f"Minimum bedrooms: {memory.min_bedrooms}")
    if memory.preferred_localities:
        context_parts.append(f"Preferred areas: {', '.join(memory.preferred_localities)}")
    if memory.investment_interest:
        context_parts.append("Interested in investment properties")
    if memory.summary:
        context_parts.append(f"Summary: {memory.summary}")
    if similar:
        context_parts.append("Relevant past context:\n" + "\n".join(similar[:3]))
    context_parts.append(
        "Use this memory naturally. If suitable, greet returning users personally."
    )

    return "\n".join(context_parts), {
        "is_returning_user": True,
        "memory_summary": memory.summary,
        "total_conversations": memory.total_conversations or 0,
    }
