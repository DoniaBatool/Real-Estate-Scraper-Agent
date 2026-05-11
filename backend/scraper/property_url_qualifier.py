"""Heuristic checks on raw HTML to guess whether a URL is a property listing worth LLM extraction."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Callable, Awaitable
from urllib.parse import parse_qsl, urlparse

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_REF_QUERY_KEYS = frozenset({"ref", "reference", "listing_id", "id", "property_id", "listingid", "code"})
_PHONE_RE = re.compile(
    r"(?:\+?\d{1,4}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)?\d{2,4}[\s\-]?\d{2,4}[\s\-]?\d{2,6}",
    re.I,
)
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_BED_RE = re.compile(
    r"(?:^|[^\w])(\d{1,2})\s*(?:bed(?:room)?s?|br\b|bd\b)(?:[^\w]|$)",
    re.I | re.M,
)
_BATH_RE = re.compile(
    r"(?:^|[^\w])(\d{1,2})\s*(?:bath(?:room)?s?|ba\b)(?:[^\w]|$)",
    re.I | re.M,
)
_SQM_RE = re.compile(r"(?:m²|m2|sqm|sq\.?\s*m)\s*[:.]?\s*(\d{2,5})\b", re.I)
_REF_INLINE_RE = re.compile(
    r"(?:reference|ref\.?|listing\s*#|property\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,40})",
    re.I,
)


def _url_has_reference_param(url: str) -> bool:
    try:
        q = parse_qsl(urlparse(url).query, keep_blank_values=True)
        for k, _ in q:
            if k.lower() in _REF_QUERY_KEYS:
                return True
        path = (urlparse(url).path or "").lower()
        # Single listing paths only — not /properties/ index listings grid
        if "/property/" in path or "/listing/" in path:
            return True
        if re.search(r"/[a-z]{1,4}\d[\w\-]*", path, re.I):
            return True
    except Exception:
        pass
    return False


def _walk_jsonld_types(obj: Any, types_out: list[str]) -> None:
    if obj is None:
        return
    if isinstance(obj, dict):
        t = obj.get("@type")
        if isinstance(t, str):
            types_out.append(t)
        elif isinstance(t, list):
            types_out.extend(str(x) for x in t if x)
        for v in obj.values():
            _walk_jsonld_types(v, types_out)
    elif isinstance(obj, list):
        for x in obj:
            _walk_jsonld_types(x, types_out)


def _jsonld_property_signals(html: str) -> tuple[bool, bool, bool]:
    """Returns (has_listing_like_type, has_identifier, has_agent_type)."""
    if not html:
        return False, False, False
    soup = BeautifulSoup(html, "html.parser")
    listing_like = False
    has_id = False
    has_agent = False
    for tag in soup.find_all("script", {"type": "application/ld+json"}):
        raw = tag.string or tag.get_text() or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        objs = data if isinstance(data, list) else [data]
        for obj in objs:
            types: list[str] = []
            _walk_jsonld_types(obj, types)
            tl = " ".join(types).lower()
            if any(
                x in tl
                for x in (
                    "residence",
                    "apartment",
                    "house",
                    "singlefamilyresidence",
                    "realestatelisting",
                    "product",
                    "offer",
                )
            ):
                listing_like = True
            if "realestateagent" in tl or "person" in tl:
                has_agent = True
            if isinstance(obj, dict):
                for key in ("sku", "productID", "identifier", "name", "url"):
                    v = obj.get(key)
                    if isinstance(v, str) and len(v.strip()) > 2:
                        has_id = True
    return listing_like, has_id, has_agent


def analyze_page_for_property_signals(html: str, url: str, *, require_agent: bool = False) -> dict[str, Any]:
    """
    Heuristic pass/fail for “likely property detail page” before expensive LLM extract.
    Not perfect — false negatives/positives possible.
    """
    low = (html or "").lower()
    text_blob = BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)[:80_000].lower()

    has_ref_url = _url_has_reference_param(url)
    has_ref_body = bool(_REF_INLINE_RE.search(html or "")) or bool(_REF_INLINE_RE.search(text_blob))
    has_ref = has_ref_url or has_ref_body

    has_email = bool(_EMAIL_RE.search(html or "")) or "mailto:" in low
    has_phone = "tel:" in low or bool(_PHONE_RE.search(text_blob))
    has_contact = has_email or has_phone

    has_bed = bool(_BED_RE.search(text_blob)) or bool(_BED_RE.search(low))
    has_bath = bool(_BATH_RE.search(text_blob)) or bool(_BATH_RE.search(low))
    has_sqm = bool(_SQM_RE.search(text_blob)) or bool(_SQM_RE.search(low))

    jl_listing, jl_id, jl_agent = _jsonld_property_signals(html or "")
    if jl_listing and jl_id:
        has_ref = True

    agent_kw = any(
        x in text_blob
        for x in (
            "listing agent",
            "property consultant",
            "sales associate",
            "real estate agent",
            "contact the agent",
            "listed by",
            "your agent",
        )
    )
    has_agent = jl_agent or agent_kw

    # Layout: typical listing facts
    has_layout = (has_bed and has_bath) or (has_bed or has_bath) and has_sqm or (has_sqm and (has_bed or has_bath))
    if jl_listing:
        has_layout = has_layout or has_sqm or has_bed or has_bath

    # Pass rule (balanced): listing-like facts + contact + reference signal
    core = (has_ref or jl_listing) and has_contact and (has_layout or jl_listing)
    if require_agent:
        core = core and has_agent

    score = 0
    if has_ref:
        score += 3
    if jl_listing:
        score += 2
    if has_bed:
        score += 1
    if has_bath:
        score += 1
    if has_sqm:
        score += 1
    if has_email:
        score += 2
    if has_phone:
        score += 2
    if has_agent:
        score += 2

    passed = bool(core)
    reason_parts: list[str] = []
    if not passed:
        if not (has_ref or jl_listing):
            reason_parts.append("no_reference_or_listing_schema")
        if not has_contact:
            reason_parts.append("no_email_or_phone")
        if not (has_layout or jl_listing):
            reason_parts.append("no_bed_bath_or_area")
        if require_agent and not has_agent:
            reason_parts.append("no_agent_signal")
    reason = "; ".join(reason_parts) if reason_parts else "ok"

    return {
        "passed": passed,
        "score": score,
        "signals": {
            "reference": has_ref,
            "jsonld_property": jl_listing,
            "bedrooms": has_bed,
            "bathrooms": has_bath,
            "area_sqm": has_sqm,
            "email": has_email,
            "phone": has_phone,
            "agent": has_agent,
        },
        "reason": reason,
    }


async def qualify_urls_batch(
    urls: list[str],
    scrape: Callable[[str], Awaitable[dict]],
    *,
    concurrency: int = 6,
    require_agent: bool = False,
) -> tuple[list[dict], list[dict]]:
    """
    scrape: async (url) -> dict with 'html' key (e.g. ScraperEngine.scrape).
    Returns (qualified, rejected) with url + analysis metadata.
    """
    sem = asyncio.Semaphore(max(1, min(concurrency, 12)))

    async def one(u: str) -> dict:
        u = (u or "").strip()
        if not u:
            return {"url": "", "analysis": {"passed": False, "score": 0, "signals": {}, "reason": "empty"}}
        async with sem:
            try:
                r = await scrape(u)
                html = (r.get("html") or "") if isinstance(r, dict) else ""
            except Exception as exc:
                logger.debug("qualify scrape fail %s: %s", u, exc)
                return {
                    "url": u,
                    "analysis": {
                        "passed": False,
                        "score": 0,
                        "signals": {},
                        "reason": f"scrape_error:{exc}",
                    },
                }
        return {"url": u, "analysis": analyze_page_for_property_signals(html, u, require_agent=require_agent)}

    tasks = [one(u) for u in urls if u and str(u).strip()]
    rows = await asyncio.gather(*tasks) if tasks else []
    qualified: list[dict] = []
    rejected: list[dict] = []
    for row in rows:
        u = row.get("url") or ""
        an = row.get("analysis") or {}
        sig = an.get("signals") or {}
        if an.get("passed"):
            qualified.append(
                {
                    "url": u,
                    "reference": None,
                    "preview": _preview_from_signals(sig),
                    "signals": sig,
                    "score": an.get("score"),
                }
            )
        else:
            rejected.append({"url": u, "reason": an.get("reason"), "signals": sig, "score": an.get("score")})
    return qualified, rejected


def _preview_from_signals(sig: dict) -> str | None:
    parts = [k for k, v in sig.items() if v]
    if not parts:
        return None
    return ", ".join(parts)[:200]
