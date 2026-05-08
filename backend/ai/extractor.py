import asyncio
import json
import logging
import re
from openai import AsyncOpenAI
from backend.config import settings
from backend.ai.prompts import EXTRACTION_PROMPT

logger = logging.getLogger(__name__)

# Truncate HTML to stay within token budget (~120k chars ≈ ~30k tokens)
MAX_HTML_CHARS = 120_000


def _truncate_html(html: str) -> str:
    """Strip script/style tags and truncate to token budget."""
    cleaned = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL)
    return cleaned[:MAX_HTML_CHARS]


def _clean_response(text: str) -> str:
    """
    Clean raw model output before JSON parsing:
    1. Strip whitespace
    2. Remove ```json / ``` fences
    3. Drop any preamble before the first { or [
    """
    text = text.strip()

    # Remove code fences
    if text.startswith("```"):
        parts = text.split("```")
        # parts[1] is the content between first pair of fences
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()

    # Drop any text before the first JSON structure
    first_brace = min(
        (text.find("{") if text.find("{") != -1 else len(text)),
        (text.find("[") if text.find("[") != -1 else len(text)),
    )
    if first_brace > 0:
        text = text[first_brace:]

    return text.strip()


def _parse_json_safe(text: str) -> dict:
    """
    Try to parse the model response as JSON with layered fallbacks.
    """
    text = _clean_response(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: find the first { ... } block
        brace_match = re.search(r"\{[\s\S]+\}", text)
        if brace_match:
            try:
                return json.loads(brace_match.group())
            except json.JSONDecodeError:
                pass
    return {}


async def extract_data(html: str, url: str) -> dict:
    """
    Send the cleaned HTML to GPT-4o-mini and parse the structured JSON response.
    Retries up to 3 times with exponential backoff (1s → 2s → 4s).
    Returns an empty dict on total failure.
    """
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY not set — skipping AI extraction for %s", url)
        return {}

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    cleaned_html = _truncate_html(html)
    user_message = f"{EXTRACTION_PROMPT}\n\nURL: {url}\n\nHTML:\n{cleaned_html}"

    backoff = 1
    for attempt in range(1, 4):
        try:
            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "user", "content": user_message}],
                max_tokens=8000,
                temperature=0,
            )
            raw = response.choices[0].message.content or ""
            result = _parse_json_safe(raw)
            if result:
                logger.info("AI extraction succeeded for %s (attempt %d)", url, attempt)
                return result
            logger.warning("AI returned empty JSON for %s (attempt %d)", url, attempt)
        except Exception as exc:
            logger.warning("AI extraction error for %s attempt %d: %s", url, attempt, exc)

        if attempt < 3:
            await asyncio.sleep(backoff)
            backoff *= 2

    logger.error("AI extraction failed after 3 attempts for %s", url)
    return {}
