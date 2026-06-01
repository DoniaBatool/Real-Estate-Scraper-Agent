"""Universal listing discovery + property detail extraction for /workbench/extract."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from collections import deque
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, unquote, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup
from openai import AsyncOpenAI

from backend.ai.extractor import parse_json_safely
from backend.config import settings
from backend.scraper.engine import ScraperEngine
from backend.scraper.html_signals import (
    discover_listing_urls,
    reference_slug_looks_like_catalog_hub,
    should_skip_href_for_property_extract,
    url_fingerprint,
)
from backend.scraper.level2_playwright import scrape_level2
from backend.scraper.email_normalize import sanitize_email_field
from backend.scraper.phone_normalize import normalize_phone_display
from backend.scraper.reference_sniffer import (
    collect_reference_tokens_from_html,
    token_plausible_property_reference,
)

logger = logging.getLogger(__name__)

_engine = ScraperEngine()

# Safety cap: max distinct listing-index URLs to load (pagination).
MAX_LISTING_PAGES_TO_CRAWL = 35
# Pause between listing pages (polite + lets JS listing grids settle).
LISTING_PAGE_DELAY_SEC = 0.75

# Mirrors workbench COMPREHENSIVE_EXTRACT_PROMPT — keep in sync for extract-single UX.
UNIVERSAL_DETAIL_PROMPT = """
You are an expert web data extractor.
Extract EVERY SINGLE piece of information visible on this webpage.

This could be a real estate property page, an about page, a contact page, or any other page.

INSTRUCTIONS:
1. Look at ALL text, numbers, labels on the page
2. Extract every data point you can find
3. Create appropriate field names for each
4. Return as flat JSON object (no nested objects except arrays)
5. Field names: lowercase with underscores

PROPERTY DETAIL PAGES (critical):
- Every filled field must describe THIS listing only (the same URL as Page URL). Do not mix data from related listings, search results sidebars, ads, or site footers.
- reference_number, internal_sqm, external_sqm, total_sqm, floor_level, main_image (first hero/gallery photo), and all_images must match the main property block / feature table for this listing, not generic site images.

For real estate PROPERTY DETAIL pages also fill when visible:
- reference_number (same value whether the page labels it "Reference", "REF", "Ref.", "Listing ID", "Property code", "Property ID", or it appears only in the URL as ?ref= / ?reference=, or as a UUID in the path e.g. /listings/bd199e03-16e1-4dad-ac3e-658adced81ad)
- title, price (number), price_text, currency
- property_type, category (sale/rent), status, badge
- bedrooms, bathrooms, internal_sqm, external_sqm, total_sqm
- locality, town, region, country, full_address
- floor_number, floor_level, furnished
- has_airconditioning (bool), heating, has_lift (bool), has_pool (bool)
- balconies (text or number), kitchens (int), living_rooms (int), dining_rooms (int)
- dining_room_dims, living_room_dims, kitchen_dims (text or semicolon-separated if multiple)
- bedroom_dims (object keyed by bedroom label OR string listing each bedroom size)
- agent_name, agent_phone, agent_email, agency_name (estate agency / listing agent only)
- owner_name, owner_phone, owner_email (property owner, vendor, landlord, or seller — NOT the agency agent)
- price_per_night (number or short text e.g. "€120/night" for holiday lets)
- price_per_month (number or short text e.g. "€1,800/month" for long lets)
- has_wifi (bool) when WiFi / internet / WLAN is clearly stated for this listing
- description, features (array), amenities (array), main_image (single absolute URL: primary listing photo), all_images (array of absolute URLs)
- listing_url (same as page URL)

AGENT vs OWNER:
- If the page shows both an agent and an owner/vendor, map agency staff to agent_* and the owner/vendor to owner_*.
- If only one contact block exists, use the visible label ("Agent", "Listed by", "Owner", "Vendor"); if ambiguous, fill agent_* and leave owner_* null.

RULES:
- Use null for missing fields
- Numbers as JSON numbers
- Full URLs for images (resolve relative to page URL)
- Return ONLY valid JSON, no markdown

Page URL: {url}

JSON-LD STRUCTURED DATA (snippets):
{json_ld}

META TAGS:
{meta_json}

HTML CONTENT:
{html}
"""


def _compress_html_for_llm(html: str, max_chars: int = 28_000) -> str:
    """
    Strip heavy tags and prefer main/article content so OpenAI requests stay under TPM/context limits.
    ~28k chars is typically well below tier TPM bursts vs sending 120k+ chars of raw HTML.
    """
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "template"]):
        tag.decompose()
    main_el = (
        soup.select_one("main")
        or soup.select_one("article")
        or soup.select_one("[role='main']")
        or soup.select_one(
            ".property-detail, .listing-detail, .single-property, #property, .property, .listing"
        )
        or soup.body
    )
    blob = str(main_el or soup)
    if len(blob) < 2000:
        blob = str(soup.body or soup)
    return blob[:max_chars]


def _normalize_listing_url(url: str) -> str:
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u.split("#")[0].strip()


def _host_key(netloc: str) -> str:
    h = (netloc or "").lower()
    return h[4:] if h.startswith("www.") else h


_PAGE_QUERY_KEYS = frozenset(
    {"page", "p", "pagenum", "listings_page", "currentpage", "pn", "pg", "paged"}
)


def _href_suggests_pagination(href: str) -> bool:
    low = href.lower()
    return any(
        x in low
        for x in (
            "page=",
            "pagenum=",
            "listings_page=",
            "currentpage=",
            "paged=",
            "offset=",
            "start=",
            "/page/",
        )
    )


def _synthetic_next_listing_url(current: str) -> str | None:
    """Increment common pagination query keys or /page/N/ path segments."""
    p = urlparse(current)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    for key in list(q.keys()):
        if key.lower() not in _PAGE_QUERY_KEYS:
            continue
        try:
            n = int(str(q[key]).strip())
        except ValueError:
            continue
        q[key] = str(n + 1)
        return urlunparse(p._replace(query=urlencode(sorted(q.items()))))
    path = p.path or ""
    m = re.search(r"/page/(\d+)/?", path, re.I)
    if m:
        n = int(m.group(1))
        new_path = re.sub(r"/page/\d+", f"/page/{n + 1}", path, count=1, flags=re.I)
        return urlunparse(p._replace(path=new_path))
    if not any(k.lower() in _PAGE_QUERY_KEYS for k in q):
        q2 = dict(q)
        q2["page"] = "2"
        return urlunparse(p._replace(query=urlencode(sorted(q2.items()))))
    return None


def _pagination_urls(html: str, current_url: str, host_k: str, fp_base: str) -> list[str]:
    """Discover next/prev listing index URLs from anchors (same host only)."""
    soup = BeautifulSoup(html, "html.parser")
    found: list[str] = []
    seen_fp: set[str] = set()

    def add(href: str | None) -> None:
        if not href or href.startswith("#"):
            return
        full = urljoin(current_url, href).split("#")[0].strip()
        if _host_key(urlparse(full).netloc) != host_k:
            return
        fp = url_fingerprint(full, fp_base)
        if fp in seen_fp:
            return
        seen_fp.add(fp)
        found.append(full)

    for sel in ('a[rel="next"]', 'link[rel="next"]'):
        for el in soup.select(sel):
            add(el.get("href"))

    nav_selectors = (
        ".pagination a",
        ".page-numbers a",
        "nav.navigation a",
        "ul.pager a",
        ".pager a",
        "nav[aria-label*='pagination' i] a",
        ".pagination__link",
        "a.page-link",
    )
    next_labels = frozenset(
        {"next", "›", "»", "...", "older", "weiter", "siguiente", "suivant", "volgende"}
    )
    for sel in nav_selectors:
        for a in soup.select(sel):
            href = a.get("href")
            text = " ".join((a.get_text() or "").split()).strip().lower()
            if text in next_labels or (href and _href_suggests_pagination(href)):
                add(href)

    for a in soup.select("a[href]"):
        href = a.get("href")
        if href and _href_suggests_pagination(href):
            add(href)

    return found


def _collect_property_candidates_from_html(
    html: str,
    page_url: str,
    fp_base: str,
    seen_fp: set[str],
    ordered: list[str],
    url_preview: dict[str, str],
) -> None:
    raw_urls = discover_listing_urls(html, page_url, max_urls=800)
    soup = BeautifulSoup(html, "html.parser")
    extra: set[str] = set()
    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        full = urljoin(page_url, href).split("#")[0].strip()
        low = full.lower()
        if "listing-page" in low or "reference=" in low or "/property/" in low:
            extra.add(full)

    for u in list(dict.fromkeys(raw_urls)) + list(extra):
        pu = urlparse(u)
        if should_skip_href_for_property_extract(pu.path or "", pu.query or ""):
            continue
        fp = url_fingerprint(u, fp_base)
        if fp in seen_fp:
            continue
        seen_fp.add(fp)
        ordered.append(u)

    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        if not href:
            continue
        full = urljoin(page_url, href).split("#")[0].strip()
        if full not in ordered:
            continue
        t = " ".join((a.get_text() or "").split())[:200]
        if t and (full not in url_preview or len(t) > len(url_preview.get(full, ""))):
            url_preview[full] = t


async def _fetch_listing_page_html(url: str) -> tuple[str | None, str | None]:
    """Prefer Playwright for JS-rendered grids; fast HTTP when the page is mostly static HTML."""
    try:
        from backend.scraper.level1_httpx import scrape_level1

        r1 = await scrape_level1(url)
        h = (r1.get("html") or "").strip()
        if h and len(h) > 3500:
            return h, None
    except Exception:
        pass
    try:
        r2 = await scrape_level2(url)
        html = (r2.get("html") or "").strip()
        if html and len(html) > 500:
            return html, None
    except Exception as exc:
        logger.debug("scrape_level2 listing failed %s: %s", url, exc)
    try:
        r = await _engine.scrape(url)
        html = (r.get("html") or "").strip()
        if html:
            return html, None
        return None, "Empty HTML (scrape failed)"
    except Exception as exc:
        logger.exception("listing scrape failed")
        return None, str(exc)


def _extract_reference_from_url(url: str) -> str | None:
    try:
        q = parse_qsl(urlparse(url).query, keep_blank_values=True)
        ref_keys = (
            "reference",
            "ref",
            "refs",
            "listing_id",
            "listingid",
            "property_id",
            "propertyid",
            "refno",
            "reference_no",
            "referenceno",
            "code",
            "listing_ref",
        )
        for k, v in q:
            if k.lower() in ref_keys:
                s = unquote(v).strip()
                if s:
                    return s
        path = urlparse(url).path or ""
        m = re.search(r"(?:reference|ref)[_=]([A-Za-z0-9\-]+)", url, re.I)
        if m:
            return m.group(1).strip()
        # Airbnb (and similar): /rooms/<numeric listing id> — no letters in segment.
        m_rooms = re.search(r"/rooms/(\d{6,30})(?:/|\?|$)", path + "/", re.I)
        if m_rooms:
            return m_rooms.group(1).strip()
        # Letify / many platforms: /listings/<uuid> or /listing/<uuid>
        m_uuid = re.search(
            r"/(?:listings?|properties?)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|\?|$)",
            path + "/",
            re.I,
        )
        if m_uuid:
            return m_uuid.group(1).strip()
        low = path.lower()
        if any(
            x in low
            for x in (
                "/property/",
                "/properties/",
                "/listing/",
                "/listings/",
                "/rent/",
                "/sale/",
                "/detail",
            )
        ):
            m_hex = re.search(r"/([0-9a-f]{8})(?:/|$|\?|#)", path, re.I)
            if m_hex:
                return m_hex.group(1).strip()
        m2 = re.search(r"/([A-Za-z]{1,4}\d[\w\-]*)", path)
        if m2:
            tok = m2.group(1).strip()
            if not reference_slug_looks_like_catalog_hub(tok):
                return tok
    except Exception:
        pass
    return None


def _to_int_if_possible(v: str | None) -> int | None:
    if not v:
        return None
    s = str(v).strip().replace(",", "")
    m = re.search(r"-?\d+", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except Exception:
        return None


def _to_float_if_possible(v: str | None) -> float | None:
    if not v:
        return None
    s = str(v).strip().replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _extract_feature_table_pairs(soup: BeautifulSoup) -> dict[str, str]:
    """
    Extract key/value pairs from generic feature tables (works for Perry "Property Features").
    """
    out: dict[str, str] = {}
    for row in soup.select("table tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            continue
        key = " ".join(cells[0].get_text(" ", strip=True).split()).strip(": ").lower()
        val = " ".join(cells[1].get_text(" ", strip=True).split()).strip()
        if key and val and key not in out:
            out[key] = val
    return out


# Normalised first-column labels that mean "property reference" in feature tables.
_REF_PAIR_LABELS = frozenset(
    {
        "ref",
        "reference",
        "reference number",
        "reference no",
        "reference no.",
        "listing ref",
        "listing ref.",
        "listing reference",
        "property ref",
        "property reference",
        "listing id",
        "listing id.",
        "property id",
        "property code",
        "listing code",
        "sku",
        "unit ref",
        "unit reference",
    }
)


def _reference_from_feature_pairs(pairs: dict[str, str]) -> str | None:
    """Map table header variants (REF / Ref. / Reference number) to one reference string."""
    for label, val in pairs.items():
        if not val or not str(val).strip():
            continue
        lab = label.strip().lower().replace(".", "").strip(":").strip()
        if lab in _REF_PAIR_LABELS:
            cand = str(val).strip()
            if token_plausible_property_reference(cand):
                return cand
    return None


_ROOM_DIM_VALUE_HINT = re.compile(
    r"(?:\d+\s*[x×*]\s*\d+|\d+(?:\.\d+)?\s*m\s*[²2]|m\s*[²2]|\d+\s*m\b)",
    re.I,
)


def _value_looks_like_room_dimensions(val: str) -> bool:
    s = val.strip()
    if len(s) < 2 or not re.search(r"\d", s):
        return False
    return bool(_ROOM_DIM_VALUE_HINT.search(s))


def _extract_room_dimension_maps_from_pairs(
    pairs: dict[str, str],
) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    """Pull bedroom/bathroom size rows from generic feature tables (e.g. Bedroom 1 → 4.2m x 3.1m)."""
    beds: dict[str, str] = {}
    baths: dict[str, str] = {}
    for raw_k, raw_v in pairs.items():
        k = raw_k.strip().lower()
        v = str(raw_v).strip()
        if not v:
            continue
        mb = re.match(r"^bedroom\s*(?:no\.?\s*)?(\d+)\s*$", k)
        if mb and _value_looks_like_room_dimensions(v):
            beds[f"Bedroom {mb.group(1)}"] = v
            continue
        mb2 = re.match(r"^bedroom\s*(?:no\.?\s*)?(\d+)\s*(?:dimensions?|sizes?|area)\s*$", k)
        if mb2:
            beds[f"Bedroom {mb2.group(1)}"] = v
            continue
        mt = re.match(r"^bathroom\s*(?:no\.?\s*)?(\d+)\s*$", k)
        if mt and _value_looks_like_room_dimensions(v):
            baths[f"Bathroom {mt.group(1)}"] = v
            continue
        mt2 = re.match(r"^bathroom\s*(?:no\.?\s*)?(\d+)\s*(?:dimensions?|sizes?|area)\s*$", k)
        if mt2:
            baths[f"Bathroom {mt2.group(1)}"] = v
            continue
    return (beds if beds else None, baths if baths else None)


def _pair_float_first(pairs: dict[str, str], *keys: str) -> float | None:
    """First non-empty table cell among known header variants (keys are lowercased like pairs)."""
    for k in keys:
        kk = k.lower()
        if kk not in pairs:
            continue
        v = _to_float_if_possible(pairs[kk])
        if v is not None and v > 0:
            return v
    return None


def _pair_float_matching(
    pairs: dict[str, str], *, must: str, must_not: tuple[str, ...], any_of: tuple[str, ...]
) -> float | None:
    for pk, pv in pairs.items():
        pl = pk.lower().replace("²", "2").replace("³", "3")
        if must not in pl:
            continue
        if any(b in pl for b in must_not):
            continue
        if any_of and not any(a in pl for a in any_of):
            continue
        v = _to_float_if_possible(pv)
        if v is not None and v > 0:
            return v
    return None


def _agent_from_contact_sidebar(soup: BeautifulSoup) -> dict[str, str | None]:
    """
    Perry-style sidebar: 'Contact Agent' then person name on its own line, optional job title below.
    """
    out: dict[str, str | None] = {"agent_name": None, "agent_phone": None, "agent_email": None}
    skip_titles = {
        "franchise owner",
        "senior consultant",
        "sales associate",
        "branch manager",
        "property consultant",
        "real estate agent",
        "letting agent",
        "listing agent",
        "contact agent",
    }
    mail_re = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
    for node in soup.find_all(string=re.compile(r"contact\s+(the\s+)?listing\s+agent|contact\s+agent\b", re.I)):
        card = node.parent
        for _ in range(10):
            if not card:
                break
            if card.name in ("aside", "section") or (
                card.name == "div"
                and len(card.get_text(" ", strip=True)) > 30
                and len(card.get_text(" ", strip=True)) < 4000
            ):
                break
            card = card.parent
        if not card:
            card = node.parent
        for a in card.select("a[href^='mailto:']"):
            em = sanitize_email_field(a.get("href", ""))
            if em:
                out["agent_email"] = em
                break
        for a in card.select("a[href^='tel:']"):
            ph = normalize_phone_display(a.get("href", "").replace("tel:", "").split("?")[0])
            if ph:
                out["agent_phone"] = ph
                break
        lines = [ln.strip() for ln in card.get_text("\n").splitlines() if ln.strip()]
        for ln in lines:
            m = mail_re.search(ln)
            if m and not out["agent_email"]:
                out["agent_email"] = m.group(0).strip()
            phm = re.search(r"(\+?\d[\d\s().-]{8,})", ln)
            if phm and not out["agent_phone"]:
                out["agent_phone"] = normalize_phone_display(phm.group(1).strip())
        for i, ln in enumerate(lines):
            low = ln.lower()
            if "contact" in low and "agent" in low:
                continue
            if "following options" in low:
                continue
            if "@" in ln or "mailto" in low:
                continue
            if re.search(r"\d{4,}", ln) and "(" in ln:
                continue
            if not re.match(r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}$", ln) or len(ln) > 70:
                continue
            if low in skip_titles:
                continue
            if i + 1 < len(lines) and lines[i + 1].strip().lower() in skip_titles:
                out["agent_name"] = ln
                break
            if i > 0 and "contact" in lines[i - 1].lower():
                out["agent_name"] = ln
                break
        if out["agent_name"]:
            break
    return out


def _extract_contact_agent_block(soup: BeautifulSoup) -> dict[str, str | None]:
    name = None
    phone = None
    email = None
    blk = (
        soup.find(string=re.compile(r"contact agent", re.I))
        or soup.find(string=re.compile(r"contact the listing agent", re.I))
    )
    if blk:
        root = blk.parent if hasattr(blk, "parent") else None
        if root is not None:
            scope = root.find_parent() or root
            txt = scope.get_text("\n", strip=True)[:4000]
            m_name = re.search(r"\n([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\n", txt)
            if m_name:
                name = m_name.group(1).strip()
            m_phone = re.search(r"(\+\d[\d\s()\-]{6,})", txt)
            if m_phone:
                phone = m_phone.group(1).strip()
            m_mail = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", txt)
            if m_mail:
                email = m_mail.group(1).strip()
    if not email:
        a = soup.select_one("a[href^='mailto:']")
        if a and a.get("href"):
            email = sanitize_email_field(a.get("href", "").strip())
    if not phone:
        a = soup.select_one("a[href^='tel:']")
        if a and a.get("href"):
            phone = a.get("href", "").replace("tel:", "").split("?")[0].strip() or None
    phone = normalize_phone_display(phone)
    out = {"agent_name": name, "agent_phone": phone, "agent_email": email}
    side = _agent_from_contact_sidebar(soup)
    for k in ("agent_name", "agent_phone", "agent_email"):
        if not out.get(k) and side.get(k):
            out[k] = side[k]
    return out


def _deterministic_property_extract(html: str, url: str) -> dict:
    """
    Rule-based extraction fallback/enrichment for pages where LLM misses obvious fields.
    """
    soup = BeautifulSoup(html, "html.parser")
    pairs = _extract_feature_table_pairs(soup)
    agent = _extract_contact_agent_block(soup)
    text = soup.get_text(" ", strip=True)

    out: dict = {"listing_url": url}
    # Title / locality / type from headings + URL slug
    h1 = soup.find("h1")
    h1_txt = " ".join((h1.get_text(" ", strip=True) if h1 else "").split())
    if h1_txt:
        out["title"] = h1_txt
    m_loc = re.search(r"/(?:sales|rentals?|for-sale|for-rent|property)/([^/?#]+)/", url, re.I)
    if m_loc:
        loc = unquote(m_loc.group(1)).replace("-", " ").strip()
        if loc:
            out["locality"] = loc.title()
    if not out.get("locality"):
        # Common Perry page starts title with locality token, e.g. "Birguma ..."
        m_head_loc = re.match(r"([A-Za-z][A-Za-z\s'\-]{2,32})\b", h1_txt or "")
        if m_head_loc:
            out["locality"] = m_head_loc.group(1).strip()
    ref_inline: str | None = None
    m_ir = re.search(
        r"(?:\bReference\b|\bRef\b|listing\s*#|property\s*#)\s*[:#]?\s*"
        r"([A-Za-z0-9][A-Za-z0-9\-_/]{2,40})\b",
        text,
        re.I,
    )
    if m_ir:
        cand_ir = m_ir.group(1).strip()
        if token_plausible_property_reference(cand_ir):
            ref_inline = cand_ir
    if ref_inline is None:
        m_pipe = re.search(r"\bRef\s*\|\s*([A-Za-z0-9][A-Za-z0-9\-]{2,20})\b", text, re.I)
        if m_pipe:
            cand_p = m_pipe.group(1).strip()
            if token_plausible_property_reference(cand_p):
                ref_inline = cand_p
    content_scope = (
        soup.select_one(
            "main, article, [role='main'], .property-detail, .single-property, "
            "#property, .listing-detail, .property--content, .property-content, .inner-content"
        )
        or soup.body
    )
    scope_html = str(content_scope) if content_scope else html
    dom_refs = collect_reference_tokens_from_html(scope_html)
    best_dom: str | None = None
    if dom_refs:
        def _ref_dom_score(t: str) -> tuple:
            ts = t.strip()
            if re.fullmatch(r"\d{5,8}", ts):
                return (4, len(ts))
            if re.fullmatch(r"\d{9,12}", ts):
                return (3, len(ts))
            if re.search(r"[A-Za-z]", ts) and re.search(r"\d", ts):
                return (2, len(ts))
            return (1, len(ts))

        best_dom = max(dom_refs, key=lambda t: _ref_dom_score(t))
    url_ref = _extract_reference_from_url(url)
    out["reference_number"] = (
        _reference_from_feature_pairs(pairs)
        or ref_inline
        or best_dom
        or url_ref
    )
    rf = str(out.get("reference_number") or "").strip()
    if url_ref and rf and url_ref.upper() != rf.upper():
        ul = url.lower()
        if url_ref.lower() in ul and rf.lower() not in ul and token_plausible_property_reference(url_ref):
            out["reference_number"] = url_ref
    out["property_type"] = pairs.get("property type")
    if not out.get("property_type"):
        # Try nearby heading text like "Villa", "Apartment"
        m_pt = re.search(
            r"\b(villa|apartment|penthouse|townhouse|house of character|maisonette|farmhouse|bungalow|studio|office|shop|hotel)\b",
            text,
            re.I,
        )
        if m_pt:
            out["property_type"] = m_pt.group(1).title()
    out["category"] = pairs.get("property")
    out["bedrooms"] = _to_int_if_possible(pairs.get("bedrooms"))
    out["bathrooms"] = _to_int_if_possible(pairs.get("no of bathrooms") or pairs.get("bathrooms"))
    if out.get("bedrooms") is None:
        m = re.search(r"\b(\d{1,2})\s*bedrooms?\b", text, re.I)
        if m:
            out["bedrooms"] = _to_int_if_possible(m.group(1))
    if out.get("bathrooms") is None:
        m = re.search(r"\b(\d{1,2})\s*(?:bathrooms?|baths?)\b", text, re.I)
        if m:
            out["bathrooms"] = _to_int_if_possible(m.group(1))
    out["kitchens"] = _to_int_if_possible(pairs.get("kitchen"))
    out["living_rooms"] = _to_int_if_possible(pairs.get("living room"))
    out["dining_rooms"] = _to_int_if_possible(pairs.get("dining room"))
    out["sitting_room"] = _to_int_if_possible(pairs.get("sitting room"))
    out["hallway"] = _to_int_if_possible(pairs.get("hallway"))
    out["laundry"] = pairs.get("laundry")
    out["garage"] = pairs.get("garage")
    out["garage_capacity"] = _to_int_if_possible(pairs.get("garage capacity"))
    out["yard"] = pairs.get("yard")
    out["roof"] = pairs.get("roof")
    out["terrace"] = pairs.get("terraces") or pairs.get("terrace")
    out["internal_sqm"] = (
        _pair_float_first(
            pairs,
            "internal size (m2)",
            "internal size",
            "internal area (m2)",
            "internal area",
            "interior size (m2)",
            "interior area (m2)",
            "living area (m2)",
            "living area",
            "internal floor area (m2)",
        )
        or _pair_float_matching(
            pairs,
            must="internal",
            must_not=("external", "total", "plot", "price"),
            any_of=("size", "area", "m2", "sqm", "meter"),
        )
    )
    out["external_sqm"] = (
        _pair_float_first(
            pairs,
            "external size (m2)",
            "external size",
            "external area (m2)",
            "external area",
            "terrace area (m2)",
            "balcony area (m2)",
        )
        or _pair_float_matching(
            pairs,
            must="external",
            must_not=("internal",),
            any_of=("size", "area", "m2", "sqm", "meter"),
        )
    )
    out["total_sqm"] = (
        _pair_float_first(
            pairs,
            "total size (m2)",
            "total size",
            "total area (m2)",
            "total area",
            "total floor area (m2)",
            "gross internal area (m2)",
            "property size (m2)",
            "built up area (m2)",
            "built-up area (m2)",
        )
        or _pair_float_matching(
            pairs,
            must="total",
            must_not=("internal", "external", "plot", "price"),
            any_of=("size", "area", "m2", "sqm", "meter"),
        )
    )
    fl_raw = pairs.get("floor level") or pairs.get("floor") or pairs.get("level") or pairs.get("which floor")
    if fl_raw:
        fs = str(fl_raw).strip()
        if fs and re.search(r"[^\d.\s]", fs):
            out["floor_level"] = fs
        else:
            fn = _to_int_if_possible(fs)
            if fn is not None and out.get("floor_number") is None:
                out["floor_number"] = fn
    out["has_pool"] = (pairs.get("swimming pool") or "").lower() in ("yes", "true", "1")
    out["has_airconditioning"] = (pairs.get("airconditioning") or "").lower() in ("yes", "true", "1")
    m_price = re.search(r"(€\s*[\d,]+(?:\.\d+)?)", text)
    out["price_text"] = m_price.group(1).replace(" ", "") if m_price else None
    out["price"] = _to_float_if_possible((pairs.get("price") or "") or (m_price.group(1) if m_price else None))
    out["currency"] = "EUR" if m_price else None
    if out.get("category"):
        c = str(out["category"]).strip().lower()
        if "sale" in c:
            out["category"] = "sale"
        elif "rent" in c or "let" in c:
            out["category"] = "rent"
    out["furnished"] = "yes" if "furnished" in (h1_txt or "").lower() or "furnished" in text.lower() else None
    out["has_lift"] = True if re.search(r"\blift\b", text, re.I) else None
    out["heating"] = pairs.get("heating")
    out["balconies"] = pairs.get("balconies") or pairs.get("terraces")

    bd_map, bt_map = _extract_room_dimension_maps_from_pairs(pairs)
    if bd_map:
        out["bedroom_dims"] = bd_map
    if bt_map:
        out["bathroom_dims"] = bt_map

    # Images: prefer in-page gallery inside main listing scope; avoid site-wide og:image first.
    scope = content_scope or soup.body
    imgs: list[str] = []
    seen_img: set[str] = set()
    gallery_selectors = (
        ".property-gallery img[src]",
        ".gallery img[src]",
        ".swiper-slide img[src]",
        ".slick-slide img[src]",
        ".carousel img[src]",
        "[class*='gallery'] img[src]",
        "[class*='slider'] img[src]",
        ".fotorama__stage img[src]",
        ".photos img[src]",
        ".property-images img[src]",
    )
    for sel in gallery_selectors:
        for im in scope.select(sel):
            src = (im.get("src") or "").strip()
            if not src or src.startswith("data:"):
                continue
            full = urljoin(url, src)
            low = full.lower()
            if any(x in low for x in ("logo", "icon", "sprite", "placeholder", "avatar", "favicon")):
                continue
            if not any(ext in low for ext in (".jpg", ".jpeg", ".png", ".webp")):
                continue
            if full not in seen_img:
                seen_img.add(full)
                imgs.append(full)
    if not imgs:
        og_scope = scope.select_one("meta[property='og:image'], meta[name='og:image']") or soup.select_one(
            "meta[property='og:image'], meta[name='og:image']"
        )
        if og_scope and og_scope.get("content"):
            ou = urljoin(url, str(og_scope.get("content")).strip())
            if ou not in seen_img:
                seen_img.add(ou)
                imgs.append(ou)
    if not imgs:
        for im in scope.select("img[src]"):
            src = (im.get("src") or "").strip()
            if not src or src.startswith("data:"):
                continue
            full = urljoin(url, src)
            low = full.lower()
            if any(x in low for x in ("logo", "icon", "sprite", "placeholder", "avatar")):
                continue
            if any(ext in low for ext in (".jpg", ".jpeg", ".png", ".webp")):
                if full not in seen_img:
                    seen_img.add(full)
                    imgs.append(full)
    if imgs:
        dedup = list(dict.fromkeys(imgs))
        out["all_images"] = dedup[:20]
        out["main_image"] = dedup[0]
    out.update(agent)

    # Drop empty placeholders so merge logic can prefer meaningful values.
    clean: dict = {}
    for k, v in out.items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        clean[k] = v
    return clean


_NUMERIC_ZERO_EMPTY_KEYS = {
    "price",
    "bedrooms",
    "bathrooms",
    "internal_sqm",
    "external_sqm",
    "total_sqm",
    "kitchens",
    "living_rooms",
    "dining_rooms",
    "floor_number",
}

_DETERMINISTIC_PRIORITY_KEYS = {
    # counts and hard feature-table facts should prefer deterministic parser over LLM guesses
    "reference_number",
    "bedrooms",
    "bathrooms",
    "kitchens",
    "living_rooms",
    "dining_rooms",
    "sitting_room",
    "hallway",
    "garage_capacity",
    "internal_sqm",
    "external_sqm",
    "total_sqm",
    "floor_level",
    "floor_number",
    "property_type",
    "category",
    "bedroom_dims",
    "bathroom_dims",
    "agent_name",
    "agent_phone",
    "agent_email",
    "main_image",
    "all_images",
}


def _is_empty_like_for_merge(v, key: str | None = None) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        s = v.strip().lower()
        return s in {"", "-", "—", "n/a", "na", "null", "none"}
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        if key and key in _NUMERIC_ZERO_EMPTY_KEYS and v <= 0:
            return True
        return False
    if isinstance(v, list):
        return len(v) == 0
    if isinstance(v, dict):
        return len(v) == 0
    return False


async def extract_property_urls_from_listing(listing_url: str) -> dict:
    """
    Crawl listing index URL(s) across pagination (Playwright-first), merge unique property links.
    Output: {total, properties: [{url, reference, preview}], listing_pages_scanned?, error?}
    """
    base = _normalize_listing_url(listing_url)
    fp_base = base
    parsed0 = urlparse(base)
    host_k = _host_key(parsed0.netloc or "")

    queue: deque[str] = deque([base])
    scheduled: set[str] = {url_fingerprint(base, fp_base)}
    visited_pages: set[str] = set()

    ordered: list[str] = []
    seen_prop_fp: set[str] = set()
    url_preview: dict[str, str] = {}
    pages_fetched: list[str] = []
    last_scrape_error: str | None = None

    while queue and len(visited_pages) < MAX_LISTING_PAGES_TO_CRAWL:
        page_url = queue.popleft()
        pfp = url_fingerprint(page_url, fp_base)
        scheduled.discard(pfp)
        if pfp in visited_pages:
            continue

        html, err = await _fetch_listing_page_html(page_url)
        if err:
            last_scrape_error = err
            continue
        if not html:
            continue

        visited_pages.add(pfp)
        pages_fetched.append(page_url)
        n_before = len(ordered)
        _collect_property_candidates_from_html(html, page_url, fp_base, seen_prop_fp, ordered, url_preview)
        added_here = len(ordered) - n_before

        for nu in _pagination_urls(html, page_url, host_k, fp_base):
            nfp = url_fingerprint(nu, fp_base)
            if nfp in visited_pages or nfp in scheduled:
                continue
            scheduled.add(nfp)
            queue.append(nu)

        # Avoid chasing ?page=2,3,… when the URL is not a listings index (e.g. agency homepage).
        synth = _synthetic_next_listing_url(page_url)
        if synth and added_here > 0:
            nfp = url_fingerprint(synth, fp_base)
            if nfp not in visited_pages and nfp not in scheduled:
                scheduled.add(nfp)
                queue.append(synth)

        await asyncio.sleep(LISTING_PAGE_DELAY_SEC)

    properties: list[dict] = []
    seen_ref: set[str] = set()
    for u in ordered:
        ref = _extract_reference_from_url(u)
        dedupe_key = (ref or u).lower()
        if dedupe_key in seen_ref:
            continue
        seen_ref.add(dedupe_key)
        properties.append(
            {
                "url": u,
                "reference": ref,
                "preview": url_preview.get(u, "") or None,
            }
        )

    out: dict = {
        "total": len(properties),
        "properties": properties,
        "listing_pages_scanned": len(pages_fetched),
    }
    if not properties:
        if last_scrape_error:
            out["error"] = last_scrape_error
        elif pages_fetched:
            out["error"] = (
                "No property listing links found on that URL. Paste the agency page that lists "
                "properties for sale/rent (search or catalogue), not only the homepage."
            )
    return out


_VISION_TOPUP_KEYS = (
    "reference_number",
    "title",
    "property_type",
    "bedrooms",
    "bathrooms",
    "internal_sqm",
    "external_sqm",
    "total_sqm",
    "floor_level",
    "locality",
    "price_text",
    "price",
    "currency",
    "agent_name",
    "agent_phone",
    "owner_name",
    "owner_phone",
    "price_per_night",
    "price_per_month",
    "has_wifi",
)


def _needs_vision_topup(row: dict) -> bool:
    """Run screenshot model when HTML path still lacks a plausible ref or title."""
    ref = str(row.get("reference_number") or row.get("reference") or "").strip()
    if ref and token_plausible_property_reference(ref):
        return False
    tit = str(row.get("title") or "").strip()
    if len(tit) >= 10:
        return False
    return True


async def _vision_fill_sparse_property(listing_url: str, jpeg_bytes: bytes) -> dict[str, object]:
    """GPT-4o-family vision pass for sites where ref/title live only in rendered layout."""
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"
    user_txt = f"""Context URL: {listing_url}

This JPEG is the top of a property listing page in a browser.
Return ONLY valid JSON (no markdown). Use null for anything not clearly readable.

{{
  "reference_number": null,
  "title": null,
  "property_type": null,
  "bedrooms": null,
  "bathrooms": null,
  "internal_sqm": null,
  "external_sqm": null,
  "total_sqm": null,
  "floor_level": null,
  "locality": null,
  "price_text": null,
  "currency": null,
  "agent_name": null,
  "agent_phone": null,
  "owner_name": null,
  "owner_phone": null,
  "price_per_night": null,
  "price_per_month": null,
  "has_wifi": null
}}

reference_number: listing / property ID (often near labels like Ref, Reference, Ref |, Property ID, ID). 4–8 digit numbers and short alphanumeric codes are common and valid.
property_type: short English label (Apartment, Villa, Hotel, Penthouse, etc.).
bedrooms / bathrooms / internal_sqm / external_sqm / total_sqm: JSON numbers only when clearly shown (m² / sqm labels).
floor_level: string or number as printed (e.g. "3rd", "Ground", "Level 2") when visible.
agent_* = estate agent; owner_* = property owner/vendor if clearly separate on the page.
has_wifi: true/false only if clearly stated.
"""
    vision_model = "gpt-4o-mini"
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.chat.completions.create(
        model=vision_model,
        messages=[
            {
                "role": "system",
                "content": "You read real-estate listing screenshots and return compact JSON only.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_txt},
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                ],
            },
        ],
        max_tokens=900,
        temperature=0,
    )
    raw = response.choices[0].message.content or ""
    parsed = parse_json_safely(raw)
    return parsed if isinstance(parsed, dict) else {}


def _reference_from_mailto_query_blob(extracted: dict[str, object]) -> str | None:
    """mailto:?subject=…&body=<listing URL> — recover property id from body when ref is missing."""
    v = extracted.get("agent_email")
    if not isinstance(v, str) or "body=" not in v.lower():
        return None
    try:
        s = v.strip()
        low = s.lower()
        if low.startswith("mailto:"):
            i = s.find("?")
            q = s[i + 1 :] if i >= 0 else ""
        elif s.startswith("?"):
            q = s[1:]
        else:
            q = s
        body_val = None
        for k2, val in parse_qsl(q, keep_blank_values=True):
            if k2.lower() == "body":
                body_val = val
                break
        if not body_val:
            return None
        listing_url = unquote(body_val.strip())
        uref = _extract_reference_from_url(listing_url)
        if uref and token_plausible_property_reference(uref):
            return uref
        m = re.search(r"-(\d{4,12})(?:/|$)", listing_url, re.I)
        if m:
            tok = m.group(1)
            if tok and token_plausible_property_reference(tok):
                return tok
    except Exception:
        return None
    return None


def _normalize_phone_fields_inplace(data: dict[str, object]) -> None:
    """Decode tel: / pasted values where spaces became %20 in the string."""
    for k in ("agent_phone", "owner_phone"):
        n = normalize_phone_display(data.get(k))
        if n:
            data[k] = n


def _sanitize_email_fields_inplace(data: dict[str, object]) -> None:
    """Drop mailto query junk (?subject=&body=) and keep only real addresses."""
    for k in ("agent_email", "owner_email"):
        if k not in data:
            continue
        data[k] = sanitize_email_field(data.get(k))


async def extract_property_detail_universal(property_url: str, take_screenshot: bool = False) -> dict:
    """
    Scrape one property URL and run comprehensive LLM extraction.
    When take_screenshot is True (workbench extract-single), uses Playwright with an optional
    JPEG screenshot and a small vision model pass if the HTML pipeline still misses ref/title.
    """
    url = _normalize_listing_url(property_url)
    html = ""
    jpeg_bytes: bytes | None = None
    # Deep-extract path requests Playwright-backed fetch to get fully rendered listing details.
    if take_screenshot:
        try:
            r2 = await scrape_level2(url, capture_screenshot=True)
            html = (r2.get("html") or "").strip()
            shot = r2.get("screenshot_jpeg")
            if isinstance(shot, (bytes, bytearray)):
                jpeg_bytes = bytes(shot)
            if not html:
                logger.warning("Playwright returned empty HTML for %s; falling back to ScraperEngine", url)
        except Exception as exc:
            logger.warning("Playwright scrape failed for %s (%s); falling back to ScraperEngine", url, exc)
            html = ""
    playwright_thin = take_screenshot and bool(html) and len(html) < 4000
    if not html or playwright_thin:
        try:
            r = await _engine.scrape(url)
            h2 = (r.get("html") or "").strip()
            if h2 and (not html or len(h2) > len(html)):
                html = h2
        except Exception as exc:
            logger.exception("extract_property_detail_universal scrape failed")
            if not html:
                return {"error": str(exc), "listing_url": url}

    if not html or len(html.strip()) < 200:
        return {"error": "Empty or minimal HTML", "listing_url": url}

    deterministic = _deterministic_property_extract(html, url)
    if not settings.openai_api_key:
        if deterministic:
            deterministic["_source_url"] = url
            deterministic["_scraped_at"] = datetime.now(timezone.utc).isoformat()
            _normalize_phone_fields_inplace(deterministic)
            _sanitize_email_fields_inplace(deterministic)
            return deterministic
        return {"error": "OPENAI_API_KEY is not configured", "listing_url": url}

    soup = BeautifulSoup(html, "html.parser")
    json_ld_parts: list[str] = []
    for tag in soup.find_all("script", {"type": "application/ld+json"}):
        json_ld_parts.append(tag.string or "")
    json_ld = "\n".join(json_ld_parts)[:4000]

    meta_data: dict[str, str] = {}
    for meta in soup.find_all("meta"):
        name = meta.get("name") or meta.get("property") or ""
        content = meta.get("content") or ""
        if name and content:
            meta_data[str(name)] = str(content)

    model = (settings.openai_model or "gpt-4o-mini").strip()

    async def _call_llm(html_blob: str, use_model: str) -> str:
        combined = UNIVERSAL_DETAIL_PROMPT.format(
            url=url,
            json_ld=json_ld if json_ld else "None",
            meta_json=json.dumps(meta_data, indent=2)[:2500],
            html=html_blob,
        )
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model=use_model,
            messages=[
                {"role": "system", "content": "You are a precise web data extractor. Return only valid JSON."},
                {"role": "user", "content": combined},
            ],
            max_tokens=4096,
            temperature=0,
        )
        return response.choices[0].message.content or ""

    html_blob = _compress_html_for_llm(html, max_chars=28_000)
    try:
        raw = await _call_llm(html_blob, model)
    except Exception as exc:
        err_txt = str(exc).lower()
        retry_smaller = any(
            x in err_txt for x in ("429", "rate_limit", "too large", "tokens", "tpm", "context_length")
        )
        if retry_smaller:
            logger.warning("Universal extract retry with smaller HTML and gpt-4o-mini: %s", exc)
            try:
                smaller = _compress_html_for_llm(html, max_chars=14_000)
                raw = await _call_llm(smaller, "gpt-4o-mini")
            except Exception as exc2:
                logger.exception("OpenAI universal extract failed after retry")
                return {"error": str(exc2), "listing_url": url}
        else:
            logger.exception("OpenAI universal extract failed")
            return {"error": str(exc), "listing_url": url}

    extracted = parse_json_safely(raw)
    if not isinstance(extracted, dict) or not extracted:
        if deterministic:
            deterministic["_source_url"] = url
            deterministic["_scraped_at"] = datetime.now(timezone.utc).isoformat()
            _normalize_phone_fields_inplace(deterministic)
            _sanitize_email_fields_inplace(deterministic)
            return deterministic
        return {"error": "LLM returned empty or invalid JSON", "listing_url": url}

    # Prefer deterministic values when LLM gave empty/placeholder/zero fields.
    # For priority keys (e.g. bedrooms/bathrooms), deterministic parser wins even if LLM is non-empty.
    for k, v in deterministic.items():
        if k in _DETERMINISTIC_PRIORITY_KEYS and not _is_empty_like_for_merge(v, k):
            extracted[k] = v
            continue
        if _is_empty_like_for_merge(extracted.get(k), k) and not _is_empty_like_for_merge(v, k):
            extracted[k] = v
        else:
            extracted.setdefault(k, v)

    extracted.setdefault("listing_url", url)
    extracted["_source_url"] = url
    extracted["_scraped_at"] = datetime.now(timezone.utc).isoformat()
    rn = extracted.get("reference_number") or extracted.get("reference")
    url_ref = _extract_reference_from_url(url)
    out_ref: str | None = None
    if isinstance(rn, str) and rn.strip():
        s = rn.strip()
        out_ref = s if token_plausible_property_reference(s) else (url_ref or s)
    elif rn not in (None, ""):
        out_ref = str(rn).strip() or None
    if out_ref is None:
        out_ref = url_ref
    if out_ref is not None:
        extracted["reference_number"] = out_ref
    cur_ref = str(extracted.get("reference_number") or "").strip()
    mail_ref = _reference_from_mailto_query_blob(extracted)
    if mail_ref and token_plausible_property_reference(mail_ref):
        if not cur_ref or not token_plausible_property_reference(cur_ref):
            extracted["reference_number"] = mail_ref

    if take_screenshot and jpeg_bytes and settings.openai_api_key and _needs_vision_topup(extracted):
        try:
            patch = await _vision_fill_sparse_property(url, jpeg_bytes)
            for k in _VISION_TOPUP_KEYS:
                if k not in patch:
                    continue
                pv = patch[k]
                if k == "reference_number":
                    if not isinstance(pv, str) or not pv.strip():
                        continue
                    pvs = pv.strip()
                    if not token_plausible_property_reference(pvs):
                        continue
                    cur = str(extracted.get("reference_number") or "").strip()
                    if not cur or not token_plausible_property_reference(cur):
                        extracted["reference_number"] = pvs
                    continue
                if _is_empty_like_for_merge(extracted.get(k), k) and not _is_empty_like_for_merge(pv, k):
                    extracted[k] = pv
        except Exception as exc:
            logger.warning("Vision listing top-up failed for %s: %s", url, exc)

    _normalize_phone_fields_inplace(extracted)
    _sanitize_email_fields_inplace(extracted)
    return extracted
