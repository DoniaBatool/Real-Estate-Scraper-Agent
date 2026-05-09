"""ARIA OpenAI tool-loop runner for chat."""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.ai.aria_prompts import AGENT_SYSTEM_PROMPT, ARIA_TOOLS, TOOL_STATUS_LABELS
from backend.ai.aria_tool_runner import execute_aria_tool
from backend.memory.user_memory import (
    build_personalized_context,
    store_conversation_embedding,
    update_user_memory,
)

logger = logging.getLogger(__name__)


def detect_intent(message: str) -> str:
    msg = message.lower().strip()

    appreciation_words = [
        "thanks", "thank you", "thankyou", "shukriya",
        "good job", "great job", "well done", "amazing",
        "awesome", "excellent", "perfect", "wonderful",
        "brilliant", "fantastic", "superb", "bohot acha",
        "shabash", "wah", "wow", "impressive", "nice work",
    ]
    greeting_words = [
        "hi", "hello", "hey", "salam", "assalam",
        "good morning", "good evening", "greetings",
    ]
    emotional_words = [
        "how are you", "how r u", "you okay", "whats up",
        "what's up", "kya haal", "kaisa hai", "kesy ho",
    ]
    frustration_words = [
        "not working", "broken", "useless", "bad",
        "annoying", "frustrated", "angry", "wrong",
        "error", "failed", "doesn't work",
    ]
    capability_words = [
        "what can you do", "what features", "capabilities",
        "what tools", "what skills", "help me understand",
        "tell me about yourself", "what are you",
    ]
    compliment_words = [
        "you are smart", "you're smart", "intelligent",
        "clever", "good bot", "best agent", "love you",
        "you're great", "you are great",
    ]

    if any(w in msg for w in greeting_words) and len(msg) < 20:
        return "greeting"
    if any(w in msg for w in appreciation_words):
        return "appreciation"
    if any(w in msg for w in emotional_words):
        return "emotional"
    if any(w in msg for w in frustration_words):
        return "frustration"
    if any(w in msg for w in capability_words):
        return "capability"
    if any(w in msg for w in compliment_words):
        return "compliment"
    return "task"


def _intent_hint(intent: str) -> str:
    if intent == "appreciation":
        return "\n\n[INTENT: User is expressing appreciation. Respond warmly in 1-2 sentences MAX. Do NOT ask for city/country. Do NOT list capabilities. Just acknowledge naturally and vary your response.]"
    if intent == "greeting":
        return "\n\n[INTENT: User is greeting you. Respond warmly and briefly. Ask how you can help today — casually, not as a sales pitch.]"
    if intent == "emotional":
        return "\n\n[INTENT: Casual emotional/social message. Be human and warm. Brief response. Gently offer help if appropriate.]"
    if intent == "frustration":
        return "\n\n[INTENT: User is frustrated. Be empathetic and calm. Apologize if needed. Ask what went wrong.]"
    if intent == "capability":
        return "\n\n[INTENT: User wants to know your capabilities. Give a friendly, conversational overview. Use the capabilities list from your identity.]"
    if intent == "compliment":
        return "\n\n[INTENT: User is complimenting you. Be gracious and humble. One sentence. No capability list.]"
    return "\n\n[INTENT: Task request. Use appropriate tools. Search database first.]"


def _openai_messages_from_history(
    latest_user_text: str,
    orm_messages: list[Any],
    system_prompt: str,
) -> list[dict[str, Any]]:
    """Build chat messages for OpenAI (last turns only)."""
    msgs: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for m in orm_messages[-24:]:
        role = getattr(m, "role", None)
        content = (getattr(m, "content", None) or "").strip()
        if not content:
            continue
        if role == "user":
            msgs.append({"role": "user", "content": content})
        elif role == "assistant":
            msgs.append({"role": "assistant", "content": content})
    msgs.append({"role": "user", "content": latest_user_text})
    return msgs


async def run_aria_turn(
    db: AsyncSession,
    latest_user_text: str,
    orm_messages: list[Any],
    *,
    user_fingerprint: str = "",
    session_id: str = "",
) -> tuple[str, dict[str, Any], str]:
    """
    Run one user turn with tool calling. Returns (reply_text, assistant_meta, action).
    """
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    intent = detect_intent(latest_user_text)
    memory_context = ""
    memory_meta: dict[str, Any] = {}
    if user_fingerprint:
        memory_context, memory_meta = await build_personalized_context(
            db,
            user_fingerprint=user_fingerprint,
            current_message=latest_user_text,
            session_id=session_id or user_fingerprint,
        )
    system_prompt = AGENT_SYSTEM_PROMPT + _intent_hint(intent) + memory_context

    if intent != "task":
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": latest_user_text},
            ],
            max_tokens=150,
            temperature=0.9,
        )
        text = (response.choices[0].message.content or "").strip() or "Thank you! 😊"
        if user_fingerprint:
            await store_conversation_embedding(
                db,
                user_fingerprint=user_fingerprint,
                session_id=session_id or user_fingerprint,
                message=latest_user_text,
                role="user",
            )
            await store_conversation_embedding(
                db,
                user_fingerprint=user_fingerprint,
                session_id=session_id or user_fingerprint,
                message=text,
                role="assistant",
            )
            if (len(orm_messages) + 1) % 3 == 0:
                conv_text = "\n".join(
                    [f"{getattr(m, 'role', 'user')}: {getattr(m, 'content', '')}" for m in orm_messages[-16:]]
                    + [f"user: {latest_user_text}", f"assistant: {text}"]
                )
                await update_user_memory(
                    db,
                    user_fingerprint=user_fingerprint,
                    conversation_text=conv_text,
                    session_id=session_id or user_fingerprint,
                )
        return text, {"aria": True, "intent": intent, "aria_tool_trace": [], **memory_meta}, "conversation"

    messages = _openai_messages_from_history(latest_user_text, orm_messages, system_prompt)
    tool_trace: list[dict[str, str]] = []
    compare_result: dict[str, Any] | None = None
    max_rounds = max(1, settings.aria_max_tool_rounds)

    for _round in range(max_rounds):
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=messages,
            tools=ARIA_TOOLS,
            tool_choice="auto",
            temperature=0.35,
            max_tokens=4096,
        )
        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments or "{}",
                            },
                        }
                        for tc in msg.tool_calls
                    ],
                }
            )

            for tc in msg.tool_calls:
                tname = tc.function.name
                tool_trace.append(
                    {
                        "tool": tname,
                        "label": TOOL_STATUS_LABELS.get(tname, f"⚙️ {tname}"),
                    }
                )
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                try:
                    result_str = await execute_aria_tool(db, tname, args)
                    if tname == "compare_properties":
                        try:
                            parsed_result = json.loads(result_str)
                            if isinstance(parsed_result, dict):
                                compare_result = parsed_result
                        except Exception:
                            pass
                except Exception as exc:
                    logger.exception("Tool %s failed", tname)
                    result_str = json.dumps({"error": str(exc)})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str[:120000],
                    }
                )
            continue

        text = (msg.content or "").strip()
        meta = {
            "aria": True,
            "aria_tool_trace": tool_trace,
            "aria_actions_line": " · ".join(t["label"] for t in tool_trace) if tool_trace else None,
            "compare_result": compare_result,
        }
        if not text:
            text = "Here is what I found from the tools above. Let me know if you want listings for another area or price band."
        if user_fingerprint:
            await store_conversation_embedding(
                db,
                user_fingerprint=user_fingerprint,
                session_id=session_id or user_fingerprint,
                message=latest_user_text,
                role="user",
            )
            await store_conversation_embedding(
                db,
                user_fingerprint=user_fingerprint,
                session_id=session_id or user_fingerprint,
                message=text,
                role="assistant",
            )
            if (len(orm_messages) + 1) % 3 == 0:
                conv_text = "\n".join(
                    [f"{getattr(m, 'role', 'user')}: {getattr(m, 'content', '')}" for m in orm_messages[-16:]]
                    + [f"user: {latest_user_text}", f"assistant: {text}"]
                )
                await update_user_memory(
                    db,
                    user_fingerprint=user_fingerprint,
                    conversation_text=conv_text,
                    session_id=session_id or user_fingerprint,
                )
        action_taken = tool_trace[0]["tool"] if tool_trace else "task"
        return text, {**meta, **memory_meta}, action_taken

    meta = {"aria": True, "aria_tool_trace": tool_trace, "aria_truncated": True}
    return (
        "I reached the maximum number of tool steps for this turn. Please narrow your question or try again.",
        meta,
        "aria_limit",
    )
