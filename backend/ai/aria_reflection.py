"""
ARIA Self-Improvement Engine
============================
Implements the self-improving loop from the M.Kashef architecture:

  Chatbot Responds → Evaluates Itself → Scores Saved → Prompt Auto-Updated → Gets Better

Two main features:
1. RESPONSE REFLECTION  — after every turn, a fast LLM scores the reply on 5 dimensions.
   If total < RETRY_THRESHOLD the response is flagged and a corrected reply is generated.

2. AUTO-CORRECTION       — if reflection detects an issue (missing clarifying question,
   wrong tool call, off-brand tone, etc.) aria_agent.run_aria_turn() is called again
   with a correction hint injected into the system prompt.

3. PERSISTENT SCORING   — scores are stored in an in-memory ring buffer (last 100 turns).
   A sliding average is maintained per issue category so the system can detect patterns.

4. PROMPT PATCH          — every 20 turns the patch_system_prompt() function scans the
   score history and injects an auto-patch paragraph into AGENT_SYSTEM_PROMPT to address
   the top recurring failure.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# ── Tunables ───────────────────────────────────────────────────────────────
RETRY_THRESHOLD   = 55      # out of 100 — below this, auto-correct fires
MAX_RETRIES       = 1       # how many auto-correction attempts
SCORE_RING_SIZE   = 100     # how many recent turns to remember
PATCH_EVERY       = 20      # re-evaluate prompt patch every N turns
REFLECTION_MODEL  = "gpt-4o-mini"   # cheap + fast for evaluation


# ── Score ring buffer ──────────────────────────────────────────────────────
_score_ring: deque[dict] = deque(maxlen=SCORE_RING_SIZE)
_turns_since_patch = 0


# ── Reflection rubric ──────────────────────────────────────────────────────
_REFLECTION_SYSTEM = """You are a quality evaluator for ARIA, an AI real-estate agent.
Score the assistant response on these 5 dimensions (0–20 each, total 100):

1. CLARITY          — response is well-structured, easy to read, no confusion
2. HELPFULNESS      — response genuinely moves the user toward their goal
3. COMPLETENESS     — asked for missing info when needed; didn't skip steps
4. TOOL_USAGE       — called the right tool at the right moment (or correctly deferred)
5. ON_BRAND         — warm, professional, real-estate-agent tone; matched user's language

Return ONLY valid JSON:
{
  "clarity": <0-20>,
  "helpfulness": <0-20>,
  "completeness": <0-20>,
  "tool_usage": <0-20>,
  "on_brand": <0-20>,
  "total": <0-100>,
  "issues": ["short phrase per issue found", ...],
  "correction_hint": "one sentence telling ARIA exactly what to fix (empty string if no issue)"
}

Be strict. Common failures to catch:
- Not asking clarifying questions when location/preference is missing → completeness low
- Calling scrape_website before asking preferences → tool_usage low
- Saying 'I found no results' without calling tools → helpfulness low
- Inventing fake URLs or property data → helpfulness low
- Giving a wall-of-text when user just said 'thanks' → clarity low
- Replying in English when user wrote in Urdu → on_brand low"""

_REFLECTION_USER_TMPL = """USER MESSAGE:
{user_message}

TOOLS CALLED (in order): {tools}

ARIA RESPONSE:
{aria_response}

Score this response."""


# ── Core evaluation ────────────────────────────────────────────────────────

async def evaluate_response(
    user_message: str,
    aria_response: str,
    tools_called: list[str],
) -> dict[str, Any]:
    """
    Score ARIA's response.  Returns a dict with keys:
      clarity, helpfulness, completeness, tool_usage, on_brand,
      total, issues, correction_hint, should_retry
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        # Can't reflect without an API key — return neutral score
        return _neutral_score()

    client = AsyncOpenAI(api_key=api_key)

    user_prompt = _REFLECTION_USER_TMPL.format(
        user_message=user_message[:600],
        tools=", ".join(tools_called) if tools_called else "none",
        aria_response=aria_response[:1200],
    )

    try:
        resp = await client.chat.completions.create(
            model=REFLECTION_MODEL,
            messages=[
                {"role": "system", "content": _REFLECTION_SYSTEM},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception as exc:
        logger.warning("Reflection call failed: %s", exc)
        return _neutral_score()

    # Normalise
    scores = {
        "clarity":      _clamp(data.get("clarity",      15), 0, 20),
        "helpfulness":  _clamp(data.get("helpfulness",  15), 0, 20),
        "completeness": _clamp(data.get("completeness", 15), 0, 20),
        "tool_usage":   _clamp(data.get("tool_usage",   15), 0, 20),
        "on_brand":     _clamp(data.get("on_brand",     15), 0, 20),
    }
    total = sum(scores.values())
    issues = data.get("issues", [])
    correction_hint = data.get("correction_hint", "")

    result = {
        **scores,
        "total": total,
        "issues": issues,
        "correction_hint": correction_hint,
        "should_retry": total < RETRY_THRESHOLD and bool(correction_hint),
    }

    # Store in ring buffer
    _record_score(user_message, aria_response, result)
    return result


def _neutral_score() -> dict:
    return {
        "clarity": 15, "helpfulness": 15, "completeness": 15,
        "tool_usage": 15, "on_brand": 15,
        "total": 75, "issues": [], "correction_hint": "",
        "should_retry": False,
    }


def _clamp(v: Any, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return (lo + hi) // 2


def _record_score(user_msg: str, aria_reply: str, scores: dict) -> None:
    _score_ring.append({
        "ts": time.time(),
        "total": scores["total"],
        "issues": scores["issues"],
        "user_snippet": user_msg[:80],
    })


# ── Prompt auto-patch ──────────────────────────────────────────────────────

def get_prompt_patch() -> str:
    """
    Scan the score ring buffer and return a short paragraph that addresses
    the most common recurring failure. Called every PATCH_EVERY turns.

    Returns an empty string if no patch is needed.
    """
    global _turns_since_patch
    _turns_since_patch += 1

    if _turns_since_patch < PATCH_EVERY or len(_score_ring) < 10:
        return ""

    _turns_since_patch = 0

    # Count issue frequencies
    issue_counts: dict[str, int] = {}
    recent = list(_score_ring)[-PATCH_EVERY:]
    for entry in recent:
        for issue in entry.get("issues", []):
            key = issue.lower()[:60]
            issue_counts[key] = issue_counts.get(key, 0) + 1

    if not issue_counts:
        return ""

    top_issue, count = max(issue_counts.items(), key=lambda x: x[1])

    if count < 3:
        return ""  # Not a pattern yet — don't patch

    # Map known issue patterns to corrections
    patch_map = {
        "not asking clarifying": (
            "\n[AUTO-PATCH] You recently skipped asking for the user's preferences "
            "before scraping. ALWAYS ask at minimum: buy/rent, property type, "
            "bedrooms, budget — before calling scrape_website.\n"
        ),
        "missing location": (
            "\n[AUTO-PATCH] Several recent turns lacked a city/country. "
            "If no location is given, ask for it FIRST before any tool call.\n"
        ),
        "inventing": (
            "\n[AUTO-PATCH] Do NOT invent property data, prices, or URLs. "
            "Only present data from actual tool results.\n"
        ),
        "wrong language": (
            "\n[AUTO-PATCH] Match the user's language exactly. "
            "Urdu in → Urdu out. English in → English out.\n"
        ),
        "tool_usage": (
            "\n[AUTO-PATCH] Review tool selection. Call find_agencies for city "
            "searches, scrape_website after preferences are confirmed, "
            "get_property_details only when asked.\n"
        ),
        "no results without": (
            "\n[AUTO-PATCH] Never say 'no results' without calling scrape_website "
            "at least twice (two different agencies).\n"
        ),
    }

    for keyword, patch_text in patch_map.items():
        if keyword in top_issue:
            logger.info("Auto-patch triggered for issue: %s (count=%d)", top_issue, count)
            return patch_text

    # Generic fallback patch
    return (
        f"\n[AUTO-PATCH] Recent quality issue detected: '{top_issue}'. "
        "Review this pattern and correct it in your next responses.\n"
    )


# ── Score summary (for logging / debugging) ───────────────────────────────

def get_score_summary() -> dict:
    """Return rolling statistics from the score ring."""
    if not _score_ring:
        return {"turns": 0, "avg_total": None, "recent_issues": []}

    recent = list(_score_ring)
    totals = [r["total"] for r in recent]
    all_issues: list[str] = []
    for r in recent[-20:]:
        all_issues.extend(r.get("issues", []))

    # Issue frequency
    freq: dict[str, int] = {}
    for iss in all_issues:
        freq[iss] = freq.get(iss, 0) + 1
    top_issues = sorted(freq.items(), key=lambda x: -x[1])[:5]

    return {
        "turns": len(recent),
        "avg_total": round(sum(totals) / len(totals), 1),
        "min_total": min(totals),
        "max_total": max(totals),
        "top_issues": top_issues,
    }
