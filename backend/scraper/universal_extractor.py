"""Universal listing discovery + property detail extraction for /workbench/extract."""
from __future__ import annotations

import asyncio
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
from backend.scraper.html_signals import discover_listing_urls, url_fingerprint
from backend.scraper.level2_playwright import scrape_level2

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

For real estate PROPERTY DETAIL pages also fill when visible:
- reference_number, title, price (number), price_text, currency
- property_type, category (sale/rent), status, badge
- bedrooms, bathrooms, internal_sqm, external_sqm, total_sqm
- locality, town, region, country, full_address
- floor_number, floor_level, furnished
- has_airconditioning (bool), heating, has_lift (bool), has_pool (bool)
- balconies (text or number), kitchens (int), living_rooms (int), dining_rooms (int)
- dining_room_dims, living_room_dims, kitchen_dims (text or semicolon-separated if multiple)
- bedroom_dims (object keyed by bedroom label OR string listing each bedroom size)
- agent_name, agent_phone, agent_email, agency_name
- description, features (array), amenities (array), all_images (array of absolute URLs)
- listing_url (same as page URL)

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
    """Prefer Playwright for JS-rendered grids; fall back to ScraperEngine."""
    try:
        r2 = await scrape_level2(url)
        html = (r2.get("html") or "").strip()
        if html and len(html) > 800:
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
        for k, v in q:
            if k.lower() in ("reference", "ref", "listing_id", "id", "property_id"):
                s = unquote(v).strip()
                if s:
                    return s
        path = urlparse(url).path or ""
        m = re.search(r"(?:reference|ref)[_=]([A-Za-z0-9\-]+)", url, re.I)
        if m:
            return m.group(1).strip()
        m2 = re.search(r"/([A-Za-z]{1,4}\d[\w\-]*)", path)
        if m2:
            return m2.group(1).strip()
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
            email = a.get("href", "").replace("mailto:", "").strip() or None
    if not phone:
        a = soup.select_one("a[href^='tel:']")
        if a and a.get("href"):
            phone = a.get("href", "").replace("tel:", "").strip() or None
    return {"agent_name": name, "agent_phone": phone, "agent_email": email}


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
    out["reference_number"] = (
        pairs.get("reference number")
        or pairs.get("reference")
        or _extract_reference_from_url(url)
    )
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
    out["total_sqm"] = _to_float_if_possible(pairs.get("total size (m2)") or pairs.get("total size"))
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

    # Images: prefer og:image then property gallery images on same host.
    og_img = soup.select_one("meta[property='og:image'], meta[name='og:image']")
    imgs: list[str] = []
    if og_img and og_img.get("content"):
        imgs.append(urljoin(url, str(og_img.get("content")).strip()))
    for im in soup.select("img[src]"):
        src = (im.get("src") or "").strip()
        if not src:
            continue
        full = urljoin(url, src)
        low = full.lower()
        if any(x in low for x in ("logo", "icon", "sprite", "placeholder")):
            continue
        if any(ext in low for ext in (".jpg", ".jpeg", ".png", ".webp")):
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
    "total_sqm",
    "property_type",
    "category",
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


async def extract_property_detail_universal(property_url: str, take_screenshot: bool = False) -> dict:
    """
    Scrape one property URL and run comprehensive LLM extraction.
    take_screenshot reserved for future Playwright screenshot augmentation.
    """
    url = _normalize_listing_url(property_url)
    html = ""
    # Deep-extract path requests Playwright-backed fetch to get fully rendered listing details.
    if take_screenshot:
        try:
            r2 = await scrape_level2(url)
            html = (r2.get("html") or "").strip()
            if not html:
                logger.warning("Playwright returned empty HTML for %s; falling back to ScraperEngine", url)
        except Exception as exc:
            logger.warning("Playwright scrape failed for %s (%s); falling back to ScraperEngine", url, exc)
            html = ""
    if not html:
        try:
            r = await _engine.scrape(url)
        except Exception as exc:
            logger.exception("extract_property_detail_universal scrape failed")
            return {"error": str(exc), "listing_url": url}
        html = (r.get("html") or "").strip()

    if not html or len(html.strip()) < 200:
        return {"error": "Empty or minimal HTML", "listing_url": url}

    deterministic = _deterministic_property_extract(html, url)
    if not settings.openai_api_key:
        if deterministic:
            deterministic["_source_url"] = url
            deterministic["_scraped_at"] = datetime.now(timezone.utc).isoformat()
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
    ref = extracted.get("reference_number") or extracted.get("reference") or _extract_reference_from_url(url)
    if ref is not None:
        extracted.setdefault("reference_number", ref)

    return extracted
