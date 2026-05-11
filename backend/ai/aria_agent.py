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

    appreciation = [
        "thanks", "thank you", "thankyou", "shukriya",
        "good job", "great job", "well done", "amazing",
        "awesome", "excellent", "perfect", "wonderful",
        "brilliant", "fantastic", "thats great",
        "that's great", "great work", "nice work",
        "shabash", "wah", "bohot acha", "bahut acha"
    ]
    greetings = [
        "hi", "hello", "hey", "salam", "assalam",
        "good morning", "good evening", "good afternoon",
        "howdy", "sup", "whats up", "what's up",
        "how are you", "how r u", "kya haal",
        "kaisa hai", "kesy ho", "aoa"
    ]
    compliments = [
        "you are smart", "you're smart", "so smart",
        "intelligent", "clever", "best agent",
        "love you", "you're great", "you are great",
        "impressive", "good bot", "nice bot"
    ]

    if any(w in msg for w in appreciation):
        return "appreciation"
    if any(w in msg for w in greetings) and len(msg) < 30:
        return "greeting"
    if any(w in msg for w in compliments):
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

    if intent in ["appreciation", "greeting", "compliment"]:
        import random

        appreciation_responses = [
            "Thank you! 😊 Always happy to help.",
            "Glad I could help! Let me know if you need anything else. 🏡",
            "That means a lot! ✨ Here whenever you need me.",
            "Happy to be of service! What else can I help you with?",
            "Aww, thank you! 😊 That keeps me motivated!",
            "So glad you're happy with that! 🌟",
        ]

        greeting_responses = [
            "Hey there! 👋 Doing great, thanks for asking. How can I help you today?",
            "Hello! 😊 Great to connect. What property are you looking for?",
            "Hi! Doing well, thank you! Ready to help with your real estate needs. 🏡",
            "Hey! 👋 Always good to hear from you. What can I do for you today?",
        ]

        compliment_responses = [
            "Thank you, that's very kind! 😊",
            "You're too kind! 😊 Happy to help anytime.",
            "That really means a lot, thank you! 🌟",
        ]

        if intent == "appreciation":
            text = random.choice(appreciation_responses)
        elif intent == "greeting":
            text = random.choice(greeting_responses)
        else:
            text = random.choice(compliment_responses)

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
        return text, {"aria": True, "intent": intent, "aria_tool_trace": []}, "conversation"

    intent_hint = ""
    lower_msg = latest_user_text.lower()
    if "tell me more about" in lower_msg:
        intent_hint = """
[INTENT: User wants details about a specific property.
Search database for this property title. 
If not found, use web_search.
Present all available details beautifully with emojis.
DO NOT ask for city/country — search directly.]"""
    elif any(
        x in lower_msg
        for x in [
            "valletta",
            "dubai",
            "london",
            "malta",
            "malta",
            "scrape",
            "find agencies",
            "show me",
            "properties in",
        ]
    ):
        intent_hint = """
[INTENT: User gave location or task.
Act on it IMMEDIATELY — search database first.
If insufficient results, scrape that city.
DO NOT repeat the sales pitch.
DO NOT ask them to confirm — just do it.]"""

    memory_context = ""
    memory_meta: dict[str, Any] = {}
    if user_fingerprint:
        memory_context, memory_meta = await build_personalized_context(
            db,
            user_fingerprint=user_fingerprint,
            current_message=latest_user_text,
            session_id=session_id or user_fingerprint,
        )
    system_prompt = AGENT_SYSTEM_PROMPT + intent_hint + memory_context
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for h in orm_messages[-10:]:
        role = getattr(h, "role", None)
        content = (getattr(h, "content", None) or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": latest_user_text})
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
