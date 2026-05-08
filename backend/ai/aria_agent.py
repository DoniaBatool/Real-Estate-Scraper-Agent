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

logger = logging.getLogger(__name__)


def _openai_messages_from_history(
    latest_user_text: str,
    orm_messages: list[Any],
) -> list[dict[str, Any]]:
    """Build chat messages for OpenAI (last turns only)."""
    msgs: list[dict[str, Any]] = [{"role": "system", "content": AGENT_SYSTEM_PROMPT}]
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
) -> tuple[str, dict[str, Any], str]:
    """
    Run one user turn with tool calling. Returns (reply_text, assistant_meta, action).
    """
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    messages = _openai_messages_from_history(latest_user_text, orm_messages)
    tool_trace: list[dict[str, str]] = []
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
        }
        if not text:
            text = "Here is what I found from the tools above. Let me know if you want listings for another area or price band."
        return text, meta, "aria"

    meta = {"aria": True, "aria_tool_trace": tool_trace, "aria_truncated": True}
    return (
        "I reached the maximum number of tool steps for this turn. Please narrow your question or try again.",
        meta,
        "aria_limit",
    )
