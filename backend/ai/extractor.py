import asyncio
import json
import logging
import re
from urllib.parse import urljoin
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


async def extract_data(html: str, url: str, *, max_tokens: int | None = None) -> dict:
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
                max_tokens=max_tokens if max_tokens is not None else 8000,
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


# ---------------------------------------------------------------------------
# Multi-page pipeline: agency-only + per-property detail + listings fallback
# ---------------------------------------------------------------------------


def parse_json_universal(text: str) -> dict | list | None:
    """Parse JSON object or array from model output."""
    if not text:
        return None
    cleaned = _clean_response(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
        m = re.search(pattern, cleaned)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                continue
    return None


def _combine_agency_html(html: str, max_each: int = 12000) -> str:
    """Prioritize header/nav/footer — contacts and socials often live there."""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        chunks: list[str] = []
        header = soup.find("header")
        nav = soup.find("nav")
        footer = soup.find("footer")
        if header:
            chunks.append(str(header)[:max_each])
        elif nav:
            chunks.append(str(nav)[:max_each])
        if footer:
            chunks.append(str(footer)[:max_each])
        chunks.append(html[:8000])
        return "\n\n".join(chunks)[:32000]
    except Exception:
        return html[:32000]


async def _openai_json_prompt(user_prompt: str, html_payload: str, *, max_tokens: int = 8000) -> str:
    """Single-shot completion; returns raw assistant text."""
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY not set — skipping LLM extraction")
        return ""

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    backoff = 1
    for attempt in range(1, 4):
        try:
            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a strict JSON-only extractor for real estate sites. Output valid JSON only—no markdown fences.",
                    },
                    {"role": "user", "content": user_prompt + "\n\n--- CONTENT ---\n\n" + html_payload},
                ],
                max_tokens=max_tokens,
                temperature=0,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.warning("OpenAI extraction attempt %d failed: %s", attempt, exc)
        if attempt < 3:
            await asyncio.sleep(backoff)
            backoff *= 2
    return ""


def _normalize_property_images(images: object, page_url: str) -> list[str]:
    """Resolve relative URLs, drop trackers/icons, dedupe."""
    if not isinstance(images, list):
        return []
    out: list[str] = []
    for img in images:
        if not isinstance(img, str):
            continue
        u = img.strip()
        if not u:
            continue
        abs_u = urljoin(page_url, u) if not u.lower().startswith(("http://", "https://")) else u
        lower = abs_u.lower()
        if not any(ext in lower for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
            continue
        if any(x in lower for x in ("logo", "icon", "favicon")):
            continue
        out.append(abs_u)
    return list(dict.fromkeys(out))


async def extract_agency_info(html: str, url: str) -> dict:
    from backend.ai.multipage_prompts import AGENCY_INFO_PROMPT

    payload = _combine_agency_html(html)
    raw = await _openai_json_prompt(f"{AGENCY_INFO_PROMPT}\nPage URL: {url}", payload, max_tokens=4500)
    parsed = parse_json_universal(raw)
    return parsed if isinstance(parsed, dict) else {}


async def extract_single_property(html: str, url: str) -> dict | None:
    from bs4 import BeautifulSoup

    from backend.ai.multipage_prompts import SINGLE_PROPERTY_PROMPT

    soup = BeautifulSoup(html, "html.parser")
    json_ld_parts: list[str] = []
    for tag in soup.find_all("script"):
        t = tag.get("type") or ""
        if "ld+json" in t.lower():
            json_ld_parts.append(tag.string or "")
    ld_block = "\n".join(json_ld_parts)[:16000]

    body = ""
    if ld_block.strip():
        body += "STRUCTURED DATA (JSON-LD):\n" + ld_block + "\n\n"
    body += "HTML:\n" + html[:20000]

    prompt = SINGLE_PROPERTY_PROMPT.format(url=url)
    raw = await _openai_json_prompt(prompt, body, max_tokens=9000)
    parsed = parse_json_universal(raw)
    if not isinstance(parsed, dict):
        return None
    if not parsed.get("title"):
        return None
    parsed["listing_url"] = parsed.get("listing_url") or url
    parsed["images"] = _normalize_property_images(parsed.get("images"), url)
    return parsed


async def extract_properties_from_listings(html: str, base_url: str) -> list[dict]:
    from backend.ai.multipage_prompts import LISTINGS_GRID_PROMPT

    raw = await _openai_json_prompt(
        f"{LISTINGS_GRID_PROMPT}\nBase URL for resolving links: {base_url}",
        html[:18000],
        max_tokens=7000,
    )
    parsed = parse_json_universal(raw)
    if isinstance(parsed, list):
        return [p for p in parsed if isinstance(p, dict)]
    if isinstance(parsed, dict):
        props = parsed.get("properties")
        if isinstance(props, list):
            return [p for p in props if isinstance(p, dict)]
    return []


async def extract_from_multipage(scrape_result: dict, agency_url: str) -> dict:
    """
    Stage 1: agency fields from homepage HTML (plus deterministic footer merge).
    Stage 2: one LLM pass per property detail page.
    Fallback: listings-grid extraction from listings HTML, then homepage HTML.
    """
    from backend.scraper.html_signals import extract_footer_signals, merge_footer_into_extracted, url_fingerprint

    final: dict = {
        "agency_name": None,
        "owner_name": None,
        "founded_year": None,
        "email": [],
        "phone": [],
        "whatsapp": None,
        "facebook_url": None,
        "instagram_url": None,
        "linkedin_url": None,
        "twitter_url": None,
        "youtube_url": None,
        "google_rating": None,
        "review_count": None,
        "price_range_min": None,
        "price_range_max": None,
        "currency": None,
        "specialization": None,
        "description": None,
        "logo_url": None,
        "address": None,
        "property_categories": None,
        "properties": [],
    }

    home_html = scrape_result.get("homepage_html") or ""
    if home_html:
        agency_block = await extract_agency_info(home_html, agency_url)
        if isinstance(agency_block, dict):
            for k, v in agency_block.items():
                if k == "properties":
                    continue
                if v is not None:
                    final[k] = v

        merge_footer_into_extracted(final, extract_footer_signals(home_html, agency_url))

    for page in scrape_result.get("property_pages") or []:
        html = page.get("html") or ""
        page_url = page.get("url") or ""
        if not html:
            continue
        prop = await extract_single_property(html, page_url)
        if prop:
            final["properties"].append(prop)

    seen: set[str] = set()
    deduped: list[dict] = []
    for p in final["properties"]:
        lu = (p.get("listing_url") or "").strip()
        key = (
            url_fingerprint(lu, agency_url)
            if lu
            else f"anon:{(p.get('title') or '')[:120]}:{p.get('price')}"
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)
    final["properties"] = deduped

    if not final["properties"]:
        grid_html = scrape_result.get("listings_html") or home_html
        if grid_html:
            final["properties"].extend(await extract_properties_from_listings(grid_html, agency_url))

    return final
