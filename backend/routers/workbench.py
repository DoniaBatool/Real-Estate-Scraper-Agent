"""Manual scraping workbench API."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
from collections import deque
from datetime import datetime, timezone
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from backend.ai.extractor import call_openai, parse_json_safely, parse_json_universal
from backend.config import settings
from backend.database.connection import _get_engine
from backend.database import crud
from backend.discovery.apify_client import discover_agencies_sync
from backend.scraper.engine import ScraperEngine

logger = logging.getLogger(__name__)

# Run in browser after "Show full description" — reads expanded About This Home text from the live DOM.
_HOQ_LIVE_ABOUT_DESC_JS = """
() => {
  const clean = (s) => (s || "").replace(/\\r/g, "").trim();
  const stripToggle = (t) =>
    t.replace(/\\s*(show|hide)\\s+full\\s+description\\s*/gi, " ").replace(/\\s+/g, " ").trim();

  const heads = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
  for (const h of heads) {
    if (!/about\\s+this\\s+home/i.test(clean(h.textContent || ""))) continue;

    let el = h.nextElementSibling;
    const parts = [];
    while (el) {
      const tag = (el.tagName || "").toLowerCase();
      if (/^h[1-4]$/.test(tag)) {
        const ht = clean(el.textContent || "");
        if (!/about\\s+this\\s+home/i.test(ht)) break;
      }
      const block = clean(el.innerText || el.textContent || "");
      if (block.length > 40 && !/^show\\s+full\\s+description$/i.test(block)) parts.push(block);
      el = el.nextElementSibling;
    }
    if (parts.length) {
      const nl = String.fromCharCode(10);
      const joined = stripToggle(parts.join(nl + nl));
      if (joined.length >= 120) return joined;
    }

    const sec = h.closest("section") || h.closest("article") || h.parentElement;
    if (!sec) continue;
    const c = sec.cloneNode(true);
    c.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    c.querySelectorAll("a, button, [role='button']").forEach((n) => {
      const tx = clean(n.textContent || "");
      if (/show|hide\\s+full\\s+description/i.test(tx)) n.remove();
    });
    let out = clean(c.innerText || "");
    out = out.replace(/^[\\s\\n]*about\\s+this\\s+home\\s*/i, "");
    out = stripToggle(out);
    if (out.length >= 120) return out;
  }
  return null;
}
"""


def _hoq_normalize_about_description(text: str) -> str:
    t = text.strip()
    t = re.sub(r"(?im)^\s*(show|hide)\s+full\s+description\s*$", "", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


router = APIRouter(prefix="/api/workbench", tags=["workbench"])

_engine_singleton = ScraperEngine()

COMPREHENSIVE_EXTRACT_PROMPT = """
You are an expert web data extractor.
Extract EVERY SINGLE piece of information
visible on this webpage.

This could be a real estate property page,
an about page, a contact page, or any other page.

INSTRUCTIONS:
1. Look at ALL text, numbers, labels on the page
2. Extract every data point you can find
3. Create appropriate field names for each
4. Return as flat JSON object (no nested objects
   except arrays)
5. Field names: lowercase with underscores
   e.g. "price_eur", "floor_number", "agent_name"

For real estate pages, look for:
- reference_number (REF: XXXX)
- title, subtitle
- price (number only), price_text (formatted)
- currency
- property_type (apartment/villa/etc)
- category (sale/rent)
- status (on market/sold/etc)
- badge (sole agency/new/etc)
- bedrooms (int)
- bathrooms (int)
- internal_sqm (float)
- external_sqm (float)
- total_sqm (float)
- plot_sqm (float)
- floor_number
- total_floors
- year_built
- furnished (yes/no/part)
- condition (new/good/etc)
- locality
- town
- region
- country
- full_address
- latitude (from map if present)
- longitude (from map if present)
- description (FULL text, not truncated)
- features (array of strings)
- amenities (array of strings)
- energy_rating
- permit_number
- agent_name
- agent_phone
- agent_email
- agency_name
- listing_date
- last_updated
- views_count
- all_images (array of all image URLs found)
- floor_plan_url
- virtual_tour_url
- video_url
- listing_url (current page URL)

For contact/about pages look for:
- company_name, owner_name, founded_year
- address, phone, email, whatsapp
- facebook_url, instagram_url, linkedin_url
- twitter_url, youtube_url
- opening_hours, description
- team_members (array)
- services (array)

RULES:
- Extract EVERY visible data point
- Use null for missing fields
- Arrays for multiple values
- Numbers as numbers (not strings)
- Full URLs for images (not relative)
- Return ONLY valid JSON, no markdown

Page URL: {url}

HTML Content:
{html}
"""


async def smart_scrape(url: str) -> dict:
    """Layered scrape via ScraperEngine (httpx → Playwright → proxy)."""
    r = await _engine_singleton.scrape(url)
    html = r.get("html") or ""
    ok = bool(r.get("success")) and len(html.strip()) > 0
    return {"success": ok, "html": html}


def _normalize_base(url: str) -> str:
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u.rstrip("/")


def _norm_netloc(netloc: str) -> str:
    return netloc.lower().replace("www.", "")


def _is_internal(href: str, base_netloc: str) -> bool:
    try:
        p = urlparse(href)
        if p.scheme not in ("http", "https"):
            return False
        hn = _norm_netloc(p.netloc)
        bn = _norm_netloc(base_netloc)
        return hn == bn or hn.endswith("." + bn)
    except Exception:
        return False


def _norm_crawl_key(url: str) -> str:
    """Normalize URL for visit deduplication (fragment stripped; host lowercased)."""
    u = (url or "").split("#")[0].strip()
    if not u:
        return ""
    try:
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            return ""
        host = (p.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = p.path or "/"
        query = p.query
        return f"{p.scheme.lower()}://{host}{path}" + (f"?{query}" if query else "")
    except Exception:
        return u.rstrip("/").lower()


_ASSET_OR_SKIP_SUFFIX = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".pdf",
    ".zip",
    ".rar",
    ".css",
    ".js",
    ".mjs",
    ".map",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".webm",
    ".mp3",
    ".xml",
)


def _should_enqueue_for_crawl(href: str) -> bool:
    """Skip binaries / assets when enqueueing URLs for the site crawl."""
    if not href or href.strip().lower().startswith("javascript:"):
        return False
    low = href.lower().split("?")[0]
    if any(low.endswith(sfx) for sfx in _ASSET_OR_SKIP_SUFFIX):
        return False
    if "mailto:" in href or "tel:" in href:
        return False
    return True


def _store_link(store: dict[str, dict], url: str, text: str, is_nav: bool) -> None:
    u = (url or "").split("#")[0].strip()
    if not u:
        return
    key = u.rstrip("/") or u
    text = (text or "").strip()[:80]
    if key not in store:
        store[key] = {"url": key, "text": text, "is_nav": bool(is_nav)}
        return
    cur = store[key]
    if len(text) > len(cur.get("text") or ""):
        cur["text"] = text
    cur["is_nav"] = bool(cur.get("is_nav")) or bool(is_nav)


_EXCLUDE_FRAGMENTS = (
    "#",
    "mailto:",
    "tel:",
    "javascript:",
    "facebook.com",
    "twitter.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "whatsapp.com",
    "/wp-admin",
    "/wp-login",
    "/wp-content/uploads",
    ".pdf",
    ".jpg",
    ".png",
    ".zip",
)

_MUST_EXCLUDE_PATHS = (
    "/service/",
    "/services/",
    "/management",
    "/after-sales",
    "/valuation",
    "/registration",
    "/blog/",
    "/news/",
    "/careers",
    "/privacy",
    "/terms",
    "/cookie",
    "/login",
    "/register",
    "/sitemap",
    "/tag/",
    "/category/",
)

_LISTING_SIGNALS = (
    "/properties",
    "/listings",
    "/for-sale",
    "/for-rent",
    "/buy",
    "/rent",
    "/sale",
    "/search",
    "/results",
    "/all-properties",
)

_PROPERTY_SIGNALS = (
    "/property/",
    "/listing/",
    "/villa/",
    "/apartment/",
    "/penthouse/",
    "/studio/",
    "/house/",
    "/home/",
    "/ref/",
    "/ref=",
)


def _bucket_for_link(url: str, text: str) -> str:
    u = url.lower()
    t = text.lower()

    if any(excl in u for excl in _MUST_EXCLUDE_PATHS):
        return "other_pages"

    if any(sig in u for sig in _LISTING_SIGNALS):
        return "listing_pages"

    if any(sig in u for sig in _PROPERTY_SIGNALS):
        return "property_pages"
    if re.search(r"/[a-z0-9][a-z0-9-]*-\d+/?$", u) or re.search(r"/\d{4,}/?$", u):
        return "property_pages"

    if any(x in u or x in t for x in ("about", "team", "who-we-are", "our-story", "meet")):
        return "about_pages"

    if any(x in u or x in t for x in ("contact", "reach", "get-in-touch", "find-us", "location")):
        return "contact_pages"

    return "other_pages"


def _group_classified_links(
    merged: dict[str, dict],
    website_url: str,
) -> dict[str, list[dict]]:
    grouped = {
        "property_pages": [],
        "listing_pages": [],
        "about_pages": [],
        "contact_pages": [],
        "other_pages": [],
    }
    seen: set[str] = set()
    home = website_url.split("#")[0].strip().rstrip("/")

    for _k, link_obj in merged.items():
        url = link_obj.get("url") or ""
        if not url:
            continue
        ul = url.lower()
        if any(excl in ul for excl in _EXCLUDE_FRAGMENTS):
            continue
        if url in seen:
            continue
        seen.add(url)
        if url.rstrip("/") == home:
            continue

        text = str(link_obj.get("text") or "")

        bucket = _bucket_for_link(url, text)
        grouped[bucket].append(
            {
                "url": url,
                "text": text,
                "is_nav": bool(link_obj.get("is_nav")),
            }
        )

    for key in grouped:
        grouped[key].sort(key=lambda x: x.get("url", ""))

    return grouped


class DiscoverBody(BaseModel):
    city: str
    country: str


class FetchUrlsBody(BaseModel):
    website_url: str
    """Breadth-first Playwright crawl; stops after this many pages successfully loaded."""
    max_pages: int = Field(default=120, ge=1, le=800)


FetchUrlsRequest = FetchUrlsBody


class ExtractBody(BaseModel):
    urls: list[str] = Field(default_factory=list)


class SaveBody(BaseModel):
    data: list[dict] = Field(default_factory=list)
    agency_name: str
    city: str
    country: str
    website_url: str = ""


class ExportExcelBody(BaseModel):
    data: list[dict] = Field(default_factory=list)
    filename: str = "workbench-export"


@router.post("/discover")
async def workbench_discover(body: DiscoverBody):
    """Apify Google Places search for real estate agencies; country is fixed to Malta."""
    city = (body.city or "").strip()
    if not city:
        raise HTTPException(status_code=400, detail="city is required")
    if not (settings.apify_api_token or "").strip():
        raise HTTPException(
            status_code=503,
            detail="APIFY_API_TOKEN is not set on the server. Add it to backend/.env and restart uvicorn.",
        )
    loop = asyncio.get_running_loop()
    try:
        agencies = await loop.run_in_executor(None, lambda: discover_agencies_sync(city, "Malta"))
    except Exception as exc:
        logger.exception("Apify discover failed for city=%s", city)
        raise HTTPException(
            status_code=502,
            detail=f"Apify discovery failed: {exc}",
        ) from exc
    return agencies


@router.post("/fetch-urls")
async def workbench_fetch_urls(request: FetchUrlsRequest):
    """
    Breadth-first Playwright crawl on the same registrable domain: visits up to ``max_pages`` HTML
    pages and collects every internal ``<a href>`` (same behaviour as a shallow site map).
    Falls back to httpx + BeautifulSoup on the homepage only if Playwright fails completely.
    """
    website_url = request.website_url.strip()
    if not website_url.startswith(("http://", "https://")):
        website_url = "https://" + website_url

    parsed = urlparse(website_url)
    autocorrect_note: str | None = None
    # Common typo seen in Malta domains: ".com.m" (missing trailing "t")
    if (parsed.netloc or "").lower().endswith(".com.m"):
        fixed_host = parsed.netloc[:-1] + "t"
        parsed = parsed._replace(netloc=fixed_host)
        website_url = urlunparse(parsed)
        autocorrect_note = f"Input host looked invalid, auto-corrected to {fixed_host}"

    domain = parsed.netloc
    if not domain:
        return {
            "website_url": website_url,
            "total_urls": 0,
            "domain": "",
            "groups": {
                "property_pages": [],
                "listing_pages": [],
                "about_pages": [],
                "contact_pages": [],
                "other_pages": [],
            },
            "error": "Invalid website_url",
        }

    base = website_url.split("#")[0].rstrip("/")
    crawl_domain = domain
    max_pages = min(max(1, request.max_pages), 800)
    merged: dict[str, dict] = {}
    playwright_error: str | None = None
    pages_visited = 0

    try:
        from playwright.async_api import async_playwright
        from playwright_stealth import stealth_async

        seed = base if urlparse(base).path not in ("", "/") else (base + "/")
        _store_link(merged, seed, "Seed page", True)

        queue: deque[str] = deque([seed])
        scheduled: set[str] = set()
        sk = _norm_crawl_key(seed)
        if sk:
            scheduled.add(sk)
        visited_ok: set[str] = set()
        failed_keys: set[str] = set()

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    ),
                    locale="en-US",
                )
                page = await context.new_page()
                await stealth_async(page)

                while queue and pages_visited < max_pages:
                    page_url = queue.popleft()
                    nk = _norm_crawl_key(page_url)
                    if not nk or nk in visited_ok or nk in failed_keys:
                        continue

                    try:
                        await page.goto(page_url, wait_until="domcontentloaded", timeout=28_000)
                        await page.wait_for_timeout(450)
                        final_url = (page.url or page_url).strip()
                        final_host = urlparse(final_url).netloc or ""
                        if final_host and _is_internal(final_url, domain):
                            crawl_domain = final_host

                        link_objs = await page.evaluate(
                            """() => {
                              const els = Array.from(document.querySelectorAll('a[href]'));
                              return els.map(el => ({
                                href: el.href,
                                text: (el.innerText || '').trim().slice(0, 120),
                              }));
                            }"""
                        )
                    except Exception as nav_exc:
                        logger.debug("Workbench crawl skip %s: %s", page_url, nav_exc)
                        failed_keys.add(nk)
                        continue

                    visited_ok.add(nk)
                    pages_visited += 1

                    for link_obj in link_objs or []:
                        href = (link_obj or {}).get("href") or ""
                        if not href or not _should_enqueue_for_crawl(href):
                            continue
                        if not _is_internal(href, crawl_domain):
                            continue
                        clean = href.split("#")[0].strip()
                        tx = str((link_obj or {}).get("text") or "")
                        _store_link(merged, clean, tx, False)
                        if not _should_enqueue_for_crawl(clean):
                            continue
                        ck = _norm_crawl_key(clean)
                        if (
                            ck
                            and ck not in visited_ok
                            and ck not in failed_keys
                            and ck not in scheduled
                            and len(queue) < 8000
                        ):
                            scheduled.add(ck)
                            queue.append(clean)

                    await asyncio.sleep(0.28)

            finally:
                await browser.close()

    except Exception as exc:
        playwright_error = str(exc)
        logger.error("Playwright fetch-urls error: %s", exc)
        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=headers) as client:
                r = await client.get(base + "/")
                if r.status_code != 200:
                    r = await client.get(base)
                if r.status_code == 200 and len(r.text) > 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    for a in soup.find_all("a", href=True):
                        raw = (a.get("href") or "").strip()
                        if not raw:
                            continue
                        href = urljoin(base + "/", raw)
                        if _is_internal(href, crawl_domain):
                            _store_link(merged, href, a.get_text(strip=True)[:80], False)
        except Exception as exc2:
            logger.error("Workbench fetch-urls httpx fallback failed: %s", exc2)

    groups = _group_classified_links(merged, base)
    total = sum(len(v) for v in groups.values())

    warning: str | None = None
    if total == 0 and playwright_error:
        if "Executable doesn't exist" in playwright_error or "BrowserType.launch" in playwright_error:
            warning = (
                "Playwright Chromium is not installed. In your project venv run: "
                "python -m playwright install chromium — then restart the API and try again."
            )
        else:
            warning = (
                f"Playwright failed ({playwright_error[:220]}). "
                "HTTP fallback returned no usable links (many sites need a real browser)."
            )
    elif total == 0:
        warning = (
            "No internal links matched filters. The homepage may be mostly JavaScript "
            "or links point outside this domain."
        )

    out: dict = {
        "website_url": base,
        "total_urls": total,
        "domain": crawl_domain,
        "groups": groups,
        "pages_visited": pages_visited,
        "crawl_max_pages": max_pages,
        "all_urls": sorted(merged.keys()),
    }
    if warning:
        out["warning"] = warning
    if autocorrect_note:
        out["autocorrect_note"] = autocorrect_note
    return out


@router.post("/extract")
async def workbench_extract(body: ExtractBody):
    urls = [u.strip() for u in body.urls if u and u.strip()]
    if not urls:
        return {"results": [], "total": 0}

    if not settings.openai_api_key:
        return {
            "results": [
                {
                    "url": u,
                    "success": False,
                    "error": "OPENAI_API_KEY is not configured",
                    "data": None,
                    "kind": None,
                }
                for u in urls
            ],
            "total": 0,
        }

    sem = asyncio.Semaphore(4)
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def one(url: str) -> dict:
        async with sem:
            try:
                result = await smart_scrape(url)
                if not result.get("success"):
                    return {
                        "url": url,
                        "success": False,
                        "error": "Empty HTML (scrape failed)",
                        "data": None,
                        "kind": None,
                    }

                html = result["html"]
                soup = BeautifulSoup(html, "html.parser")

                json_ld = ""
                for tag in soup.find_all("script", {"type": "application/ld+json"}):
                    json_ld += (tag.string or "") + "\n"

                meta_data: dict[str, str] = {}
                for meta in soup.find_all("meta"):
                    name = meta.get("name") or meta.get("property") or ""
                    content = meta.get("content") or ""
                    if name and content:
                        meta_data[str(name)] = str(content)

                combined = f"""PAGE URL: {url}

JSON-LD STRUCTURED DATA (most accurate):
{json_ld[:3000] if json_ld else "None"}

META TAGS:
{json.dumps(meta_data, indent=2)[:2000]}

HTML CONTENT:
{html[:15000]}
"""

                prompt = COMPREHENSIVE_EXTRACT_PROMPT.format(url=url, html=combined)

                response = await client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a precise web data extractor. Return only valid JSON.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=4000,
                    temperature=0,
                )
                raw = response.choices[0].message.content or ""
                extracted = parse_json_safely(raw)

                if isinstance(extracted, dict) and extracted:
                    extracted["_source_url"] = url
                    extracted["_scraped_at"] = datetime.now(timezone.utc).isoformat()
                    return {
                        "url": url,
                        "success": True,
                        "error": None,
                        "data": extracted,
                        "kind": "comprehensive",
                    }

                return {
                    "url": url,
                    "success": False,
                    "error": "LLM returned empty or invalid JSON",
                    "data": None,
                    "kind": None,
                }
            except Exception as exc:
                logger.exception("Workbench extract failed for %s", url)
                return {"url": url, "success": False, "error": str(exc), "data": None, "kind": None}

    results = await asyncio.gather(*[one(u) for u in urls])
    ok_n = sum(1 for r in results if r.get("success"))
    return {"results": list(results), "total": ok_n}


class UniversalDiscoverPropertiesBody(BaseModel):
    listing_url: str = ""


class UniversalExtractPropertiesBody(BaseModel):
    urls: list[str] = Field(default_factory=list)
    listing_url: str = ""


class UniversalExtractSingleBody(BaseModel):
    url: str = ""


class QualifyPropertyUrlsBody(BaseModel):
    urls: list[str] = Field(default_factory=list, max_length=500)
    require_agent: bool = False
    concurrency: int = Field(default=6, ge=1, le=12)


class MatchReferenceUrlsBody(BaseModel):
    reference: str = ""
    urls: list[str] = Field(default_factory=list)
    max_scan: int = Field(default=400, ge=1, le=2000)
    max_matches: int = Field(default=25, ge=1, le=200)
    concurrency: int = Field(default=6, ge=1, le=12)


def _ref_variants(ref: str) -> set[str]:
    r = (ref or "").strip().lower()
    if not r:
        return set()
    out = {r}
    out.add(r.replace(" ", ""))
    out.add(r.replace("-", ""))
    out.add(r.replace("_", ""))
    out.add(r.replace(" ", "-"))
    out.add(r.replace(" ", "_"))
    return {x for x in out if x}


@router.post("/match-reference-urls")
async def workbench_match_reference_urls(body: MatchReferenceUrlsBody):
    """
    Find crawl URLs likely belonging to a selected property reference.
    First checks URL text; then scans HTML content for the reference tokens.
    """
    ref = (body.reference or "").strip()
    urls = [u.strip() for u in (body.urls or []) if u and str(u).strip()]
    if not ref or not urls:
        return {"reference": ref, "matched": [], "scanned": 0}

    max_scan = min(len(urls), body.max_scan)
    urls = urls[:max_scan]
    variants = _ref_variants(ref)

    sem = asyncio.Semaphore(body.concurrency)

    async def one(u: str) -> dict | None:
        ul = u.lower()
        if any(v in ul for v in variants):
            return {"url": u, "source": "url"}
        async with sem:
            try:
                r = await _engine_singleton.scrape(u)
                html = (r.get("html") or "").lower()
            except Exception:
                return None
        if not html:
            return None
        # Light normalization to catch variants in text/markup.
        h_compact = html.replace(" ", "").replace("-", "").replace("_", "")
        for v in variants:
            if v in html or v.replace(" ", "") in h_compact or v.replace("-", "") in h_compact:
                return {"url": u, "source": "html"}
        return None

    rows = await asyncio.gather(*[one(u) for u in urls])
    matched = [r for r in rows if r]
    # Prefer direct URL matches first.
    matched.sort(key=lambda x: 0 if (x or {}).get("source") == "url" else 1)
    matched = matched[: body.max_matches]
    return {"reference": ref, "matched": matched, "scanned": max_scan}


@router.post("/qualify-property-urls")
async def workbench_qualify_property_urls(body: QualifyPropertyUrlsBody):
    """
    Quick HTML/JSON-LD scan per URL (ScraperEngine) — keep URLs that look like property detail pages
    (reference, contact, bed/bath/area) before expensive LLM extract-single.
    """
    from backend.scraper.property_url_qualifier import qualify_urls_batch

    urls = [u.strip() for u in (body.urls or []) if u and str(u).strip()][:500]
    if not urls:
        return {"qualified_total": 0, "rejected_total": 0, "qualified": [], "rejected_sample": []}

    qualified, rejected = await qualify_urls_batch(
        urls,
        _engine_singleton.scrape,
        concurrency=body.concurrency,
        require_agent=body.require_agent,
    )
    return {
        "qualified_total": len(qualified),
        "rejected_total": len(rejected),
        "qualified": qualified,
        "rejected_sample": rejected[:40],
    }


@router.post("/discover-properties")
async def workbench_discover_properties(body: UniversalDiscoverPropertiesBody):
    from backend.scraper.universal_extractor import extract_property_urls_from_listing

    listing_url = (body.listing_url or "").strip()
    if not listing_url:
        return {"total": 0, "properties": [], "error": "listing_url is required"}
    # Prevent runaway multi-page Playwright crawls from hanging the UI indefinitely.
    discover_timeout_sec = 720.0
    try:
        return await asyncio.wait_for(extract_property_urls_from_listing(listing_url), timeout=discover_timeout_sec)
    except asyncio.TimeoutError:
        logger.warning("discover-properties timed out after %ss for %s", discover_timeout_sec, listing_url)
        return {
            "total": 0,
            "properties": [],
            "listing_pages_scanned": None,
            "error": (
                "Discovery timed out (12 min limit). Paste your agency’s property search / listings URL "
                "(not only the homepage), or fewer pages may finish faster."
            ),
        }


@router.post("/extract-properties")
async def workbench_extract_properties(body: UniversalExtractPropertiesBody):
    from backend.scraper.universal_extractor import extract_property_detail_universal

    urls = [u.strip() for u in (body.urls or []) if u and str(u).strip()]
    if not urls:
        return {"results": [], "total": 0}

    if not settings.openai_api_key:
        return {
            "results": [
                {"url": u, "success": False, "error": "OPENAI_API_KEY is not configured", "result": None}
                for u in urls
            ],
            "total": 0,
        }

    results: list[dict] = []
    seen_ref: set[str] = set()

    def _meaningful_row(d: dict) -> bool:
        return any(
            d.get(k) is not None and str(d.get(k)).strip() != ""
            for k in ("title", "reference_number", "price", "bedrooms", "internal_sqm", "total_sqm")
        )

    for u in urls:
        try:
            data = await extract_property_detail_universal(u, take_screenshot=False)
            if not isinstance(data, dict):
                results.append({"url": u, "success": False, "error": "Invalid response", "result": data})
                continue
            if data.get("error") is not None and not _meaningful_row(data):
                results.append(
                    {"url": u, "success": False, "error": str(data.get("error")), "result": data},
                )
                continue
            ref = str(data.get("reference_number") or data.get("reference") or "").strip()
            key = ref.lower() if ref else u
            if key in seen_ref:
                continue
            seen_ref.add(key)
            results.append({"url": u, "success": True, "error": None, "result": data})
        except Exception as exc:
            logger.exception("extract-properties failed for %s", u)
            results.append({"url": u, "success": False, "error": str(exc), "result": None})

    ok = sum(1 for r in results if r.get("success"))
    return {"results": results, "total": ok}


@router.post("/extract-single")
async def workbench_extract_single(body: UniversalExtractSingleBody):
    from backend.scraper.universal_extractor import extract_property_detail_universal

    u = (body.url or "").strip()
    if not u:
        return {"result": None, "url": "", "error": "url is required"}
    data = await extract_property_detail_universal(u, take_screenshot=True)
    return {"result": data, "url": u}


@router.post("/save")
async def workbench_save(body: SaveBody):
    from backend.routers.scraper import _build_property_row

    website = (body.website_url or "").strip()
    if not website.startswith("http"):
        website = "https://" + website.lstrip("/")

    saved_props = 0
    _, session_factory = _get_engine()
    async with session_factory() as db:
        agency_payload = {
            "name": body.agency_name.strip() or "Workbench Import",
            "website_url": website,
            "city": body.city,
            "country": body.country,
            "scrape_level": 2,
            "scrape_status": "done",
        }
        agency = await crud.upsert_agency(db, agency_payload)
        if not agency:
            return {"saved": 0, "error": "Could not save agency"}

        for row in body.data:
            if not isinstance(row, dict):
                continue
            inner = row.get("data") if isinstance(row.get("data"), dict) else row
            if not isinstance(inner, dict) or not inner.get("title"):
                continue
            pr = _build_property_row(inner, agency.id, body.city, body.country)
            if pr.get("title"):
                await crud.create_property(db, pr)
                saved_props += 1

    return {"saved": saved_props}


def _flatten_row(obj: dict, prefix: str = "") -> dict[str, object]:
    flat: dict[str, object] = {}
    for k, v in obj.items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict):
            flat.update(_flatten_row(v, key + "."))
        elif isinstance(v, list):
            flat[key] = ", ".join(str(x) for x in v[:80])
        else:
            flat[key] = v
    return flat


@router.post("/export-excel")
async def workbench_export_excel(body: ExportExcelBody):
    rows_in = body.data or []
    if not rows_in:
        buf = io.BytesIO()
        wb = Workbook()
        ws = wb.active
        ws.title = "Data"
        ws.append(["(empty)"])
        wb.save(buf)
        buf.seek(0)
        name = re.sub(r"[^\w.\-]", "_", body.filename or "export") + ".xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    flat_rows = []
    for r in rows_in:
        if not isinstance(r, dict):
            continue
        data = r.get("data") if isinstance(r.get("data"), dict) else r
        base = {"source_url": r.get("url", "")}
        if isinstance(data, dict):
            merged = {**base, **_flatten_row(data)}
        else:
            merged = dict(base)
        flat_rows.append(merged)

    keys: list[str] = []
    seen: set[str] = set()
    for fr in flat_rows:
        for k in fr.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)

    wb = Workbook()
    ws = wb.active
    ws.title = "Export"
    header_font = Font(bold=True)
    for col, key in enumerate(keys, start=1):
        cell = ws.cell(row=1, column=col, value=key)
        cell.font = header_font
    for ri, fr in enumerate(flat_rows, start=2):
        for ci, key in enumerate(keys, start=1):
            ws.cell(row=ri, column=ci, value=fr.get(key))

    ws.freeze_panes = "A2"
    for ci, key in enumerate(keys, start=1):
        max_len = len(str(key))
        for row in ws.iter_rows(min_col=ci, max_col=ci, min_row=1, max_row=min(ws.max_row, 500)):
            for c in row:
                if c.value is not None:
                    max_len = max(max_len, len(str(c.value)))
        ws.column_dimensions[get_column_letter(ci)].width = min(max_len + 2, 60)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe_name = re.sub(r"[^\w.\-]", "_", body.filename or "workbench-export") + ".xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ---------------------------------------------------------------------------
# Homes of Quality (HOQ) — dedicated listing + detail scraper
# ---------------------------------------------------------------------------

HOQ_DETAIL_BASE = "https://www.homesofquality.com.mt/listing-page/?reference="

HOQ_LIST_PROMPT = """
Extract EVERY property listing card from this HTML — the grid usually has ~10 listings per page.
This is homesofquality.com.mt (Homes of Quality). Do not skip cards; do not duplicate the same reference.

For each distinct property card, one JSON object with these keys (use null when unknown):
- reference: string exactly as on site — formats include "90-9269064", "HQ927191", "SL926935", "30-200693" (from "Ref:" / "REF:" labels)
- title: string
- property_type: e.g. Apartment, Villa
- status: e.g. On Market, Sold
- category: sale or rent (lowercase)
- price: number only
- currency: e.g. EUR
- bedrooms: int
- bathrooms: int
- internal_sqm: number or null
- locality: string
- description_preview: short snippet or null
- main_image_url: absolute https URL for the main/cover photo (from img src, srcset largest, or data-src)
- all_images: array of absolute image URLs if visible
- listing_url: must be https://www.homesofquality.com.mt/listing-page/?reference={reference}
  URL-encode the reference if it contains special characters.
- badge: e.g. SOLE AGENCY, NEW, or null

Return ONLY a JSON array. One row per unique reference. No markdown.
"""


HOQ_DETAIL_PROMPT = """
Extract complete property details from this individual property page on homesofquality.com.mt

The HTML may already include the FULL property description (any "Show full description" section has been expanded server-side).
Copy the ENTIRE description text — do not summarize or truncate.

Look in contact/agent/footer areas for listing agent details (name next to photo or heading, phone, email).

total_sqm must be the TOTAL built/living area from the specifications section (labeled Total / Total area — often internal + external). Do not set total_sqm equal to internal_sqm unless the page only shows one combined figure.

From the specifications / details tables (or bullet lists), extract room counts or labels and dimensions where shown: air conditioning, balconies, kitchen (description or type), living room, dining room, floor number, heating, lift, swimming pool, and per-room sizes.

For EACH of these keys, use a JSON array of strings (never a single merged paragraph): one array element per distinct room row on the page that has a size — bedroom_dimensions, kitchen_dimensions, living_room_dimensions, dining_room_dimensions. Examples of labels to preserve as separate entries: Main bedroom, Bedroom 1/2/3, Kitchen, Kitchen/breakfast, Open-plan kitchen, Living room, Sitting room, Dining room, Dining area. Scan the whole specs section row-by-row; do not skip rooms because there are several of the same category (e.g. three bedrooms with three areas → three strings). If only one room of that type has a size, use a one-element array. If that room type has no sizes on the page, use null.

Extract EVERY piece of information visible. Return ONE flat JSON object:
{
  "reference": "REF number",
  "title": "full property title",
  "property_type": "Apartment/Villa/etc",
  "status": "On Market/Sold/etc",
  "badge": "SOLE AGENCY/NEW/etc",
  "category": "sale/rent",
  "price": 540000,
  "currency": "EUR",
  "price_text": "€540,000",
  "bedrooms": 2,
  "bathrooms": 2,
  "internal_sqm": 150,
  "external_sqm": 50,
  "total_sqm": 200,
  "floor_level": "4th floor",
  "floor_number": "4",
  "furnished": "furnished/unfurnished",
  "locality": "",
  "town": "",
  "region": "Malta",
  "full_address": "",
  "latitude": null,
  "longitude": null,
  "description": "COMPLETE full description text from About This Home / body (not a preview)",
  "air_conditioning": null,
  "balconies": null,
  "kitchen": null,
  "living_room": null,
  "dining_room": null,
  "heating": null,
  "lift": null,
  "swimming_pool": null,
  "dining_room_dimensions": null,
  "living_room_dimensions": null,
  "kitchen_dimensions": null,
  "bedroom_dimensions": null,
  "features": ["..."],
  "amenities": ["..."],
  "all_images": ["full url1"],
  "floor_plan_url": null,
  "virtual_tour_url": null,
  "agent_name": null,
  "agent_phone": null,
  "agent_email": null,
  "listing_date": null,
  "listing_url": "full URL of this page"
}

Extract ALL images from carousel/gallery — full absolute URLs only.
Return ONLY valid JSON. No markdown.
"""


class HoqListBody(BaseModel):
    url: str = "https://www.homesofquality.com.mt/latest-properties/"
    page: int = 1
    # Consecutive listing pages to fetch (merged, deduped by reference). Max 100 per request.
    page_count: int = Field(1, ge=1, le=100)


class HoqDetailBody(BaseModel):
    references: list[str] = Field(default_factory=list)


def _hoq_build_list_url(url: str, page: int) -> str:
    """HOQ pagination: page 1 = canonical URL (no listings_page). Page 2+ = ?listings_page=N&sort="""
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u.lstrip("/")
    parsed = urlparse(u)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    pg = max(1, int(page))

    if pg <= 1:
        # First grid matches https://www.homesofquality.com.mt/latest-properties/ — no listings_page param.
        q.pop("listings_page", None)
        new_query = urlencode(sorted(q.items())) if q else ""
        return urlunparse(parsed._replace(query=new_query))

    q["listings_page"] = str(pg)
    if "sort" not in q:
        q["sort"] = ""
    new_query = urlencode(sorted(q.items()))
    return urlunparse(parsed._replace(query=new_query))


def _hoq_abs_media_url(u: str | None) -> str | None:
    if not u or not isinstance(u, str):
        return None
    u = u.strip().strip('"').strip("'")
    if not u or u.startswith("data:"):
        return None
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("/"):
        return urljoin("https://www.homesofquality.com.mt/", u)
    if u.startswith("http://") or u.startswith("https://"):
        return u
    return urljoin("https://www.homesofquality.com.mt/", "/" + u.lstrip("/"))


def _hoq_normalize_reference(raw: object) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    m = re.search(r"REF(?:ERENCE)?[:\s#]*([A-Za-z0-9\-]+)", s, re.I)
    if m:
        return m.group(1).strip()
    if re.fullmatch(r"[A-Za-z0-9\-]+", s):
        return s
    m2 = re.search(r"([A-Za-z]{0,6}\d[\w\-]*)", s)
    return m2.group(1).strip() if m2 else None


def _hoq_normalize_list_item(item: dict) -> dict:
    ref = _hoq_normalize_reference(item.get("reference") or item.get("ref"))
    if ref:
        item["reference"] = ref
        item["listing_url"] = f"{HOQ_DETAIL_BASE}{quote(ref, safe='')}"
    mi = _hoq_abs_media_url(item.get("main_image_url") if isinstance(item.get("main_image_url"), str) else None)
    imgs_raw = item.get("all_images")
    fixed_imgs: list[str] = []
    if isinstance(imgs_raw, list):
        for x in imgs_raw:
            if not isinstance(x, str):
                continue
            for part in re.split(r"[,\s]+", x):
                abs_u = _hoq_abs_media_url(part.strip())
                if abs_u and abs_u not in fixed_imgs:
                    fixed_imgs.append(abs_u)
    item["all_images"] = fixed_imgs
    if not mi and fixed_imgs:
        mi = fixed_imgs[0]
    item["main_image_url"] = mi
    return item


def _hoq_dedupe_rows(rows: list[dict]) -> list[dict]:
    """Drop duplicate references only; keep rows even if reference missing (LLM sometimes omits format)."""
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        ref = r.get("reference")
        if isinstance(ref, str) and ref.strip():
            if ref in seen:
                continue
            seen.add(ref)
        out.append(r)
    return out


def _hoq_parse_total_pages(html: str) -> int | None:
    h = html.replace("&amp;", "&")
    nums = [int(x) for x in re.findall(r"listings_page=(\d+)", h, flags=re.I)]
    if nums:
        return max(nums)
    m = re.search(r"\.\.\.\s*(\d{1,4})\s*Next", html, flags=re.I)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return None


def _hoq_html_for_llm(html: str, max_chars: int = 160_000) -> str:
    """Strip chrome and scripts so the model sees listing cards, not only the first 20k chars of <head>."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    main_el = (
        soup.select_one("main")
        or soup.select_one("#primary")
        or soup.select_one(".site-main")
        or soup.select_one("[class*='listing']")
        or soup.body
    )
    blob = str(main_el or soup)
    if len(blob) < 6000 and soup.body:
        blob = str(soup.body)[:max_chars]
    return blob[:max_chars]


def _hoq_detect_has_next_page(html: str, page: int, total_pages: int | None) -> bool:
    if total_pages is not None:
        return page < total_pages
    h = html.replace("&amp;", "&")
    nxt = page + 1
    if re.search(rf"listings_page={nxt}[\"&\s<>]", h):
        return True
    if re.search(rf"/page/{nxt}/", h):
        return True
    soup = BeautifulSoup(html, "html.parser")
    if soup.select_one('a[rel="next"]'):
        return True
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        if f"listings_page={nxt}" in href or f"/page/{nxt}" in href or f"paged={nxt}" in href:
            return True
        t = (a.get_text() or "").strip().lower()
        if t in ("next", "›", "»") and ("page" in href.lower() or "paged" in href.lower() or "listings_page" in href):
            return True
    return False


async def _hoq_try_expand_description(page: object) -> bool:
    """Reveal full listing copy on HOQ pages (truncated until 'Show full description' is clicked)."""
    clicked = False
    try:
        ab = page.locator("text=/About This Home/i").first
        if await ab.count() > 0:
            await ab.scroll_into_view_if_needed(timeout=8000)
            await page.wait_for_timeout(450)
    except Exception:
        logger.debug("HOQ: scroll to About This Home skipped")

    try:
        await page.click("text=/Show full description/i", timeout=12_000)
        await page.wait_for_timeout(2200)
        clicked = True
    except Exception:
        pass

    patterns = (
        re.compile(r"show\s+full\s+description", re.I),
        re.compile(r"read\s+full\s+description", re.I),
    )
    if not clicked:
        for pat in patterns:
            try:
                loc = page.get_by_text(pat).first
                await loc.wait_for(state="visible", timeout=8000)
                await loc.scroll_into_view_if_needed(timeout=6000)
                await loc.click(timeout=10_000)
                await page.wait_for_timeout(2200)
                clicked = True
                break
            except Exception:
                continue
    if not clicked:
        try:
            btn = page.get_by_role("button", name=re.compile(r"full\s+description", re.I))
            if await btn.count() > 0:
                b = btn.first
                await b.scroll_into_view_if_needed(timeout=6000)
                await b.click(timeout=10_000)
                await page.wait_for_timeout(2200)
                clicked = True
        except Exception:
            pass
    if not clicked:
        try:
            link = page.get_by_role("link", name=re.compile(r"full\s+description", re.I))
            if await link.count() > 0:
                lk = link.first
                await lk.scroll_into_view_if_needed(timeout=6000)
                await lk.click(timeout=10_000)
                await page.wait_for_timeout(2200)
                clicked = True
        except Exception:
            pass
    if not clicked:
        try:
            did = await page.evaluate(
                """() => {
                  const cand = Array.from(
                    document.querySelectorAll("a,button,[role='button'],span,div,p")
                  );
                  for (const el of cand) {
                    const t = (el.innerText || el.textContent || "").trim();
                    if (/show\\s+full\\s+description/i.test(t) && t.length < 100) {
                      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                      return true;
                    }
                  }
                  return false;
                }"""
            )
            if did:
                await page.wait_for_timeout(2200)
                clicked = True
        except Exception:
            logger.debug("HOQ: JS click Show full description failed")
    return clicked


def _hoq_extract_full_description_from_html(html: str) -> str | None:
    """Pull the expanded property body copy from HOQ HTML (About This Home / paragraphs near the toggle)."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.body
    if not root:
        return None

    best = ""
    for h in root.find_all(["h2", "h3", "h4"]):
        ht = (h.get_text() or "").strip()
        if not re.search(r"about\s+this\s+home", ht, re.I):
            continue
        blob_parts: list[str] = []
        cur = h
        for _ in range(35):
            nxt = cur.next_sibling
            while nxt is not None and not getattr(nxt, "name", None):
                nxt = nxt.next_sibling
            if nxt is None:
                break
            nm = (nxt.name or "").lower()
            if nm in ("h1", "h2", "h3", "h4"):
                break
            t = " ".join(nxt.get_text(" ", strip=True).split())
            if len(t) > 35:
                blob_parts.append(t)
            cur = nxt
        joined = "\n\n".join(blob_parts)
        if len(joined) > len(best):
            best = joined

    toggle_rx = re.compile(r"(show|hide)\s+full\s+description", re.I)
    for el in root.find_all(["a", "button", "span", "div"]):
        tx = (el.get_text() or "").strip()
        if not tx or len(tx) > 140:
            continue
        if not toggle_rx.search(tx):
            continue
        cur = el
        for _ in range(14):
            if cur is None:
                break
            paras: list[str] = []
            for p in cur.find_all("p"):
                t = " ".join((p.get_text() or "").split())
                if len(t) > 30:
                    paras.append(t)
            joined = "\n\n".join(paras)
            if len(joined) > len(best):
                best = joined
            cur = getattr(cur, "parent", None)

    if len(best) < 180:
        for h in root.find_all(["h2", "h3", "h4", "div", "span"]):
            ht = (h.get_text() or "").strip()
            if not re.search(r"about\s+this\s+home", ht, re.I):
                continue
            sec = h.find_parent(["section", "article", "div"]) or h.parent
            if not sec:
                continue
            paras = []
            for p in sec.find_all("p"):
                t = " ".join((p.get_text() or "").split())
                if len(t) > 30:
                    paras.append(t)
            blob = "\n\n".join(paras)
            if len(blob) > len(best):
                best = blob

    out = best.strip()
    return out if len(out) > 60 else None


def _hoq_parse_sqm_token(raw: str) -> float | None:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().replace(" ", "").replace("\xa0", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and s.rfind(",") > len(s) - 4:
        s = s.replace(",", ".")
    elif "," in s:
        s = s.replace(",", "")
    try:
        v = float(s)
        if 8.0 <= v <= 80000.0:
            return v
    except ValueError:
        pass
    return None


def _hoq_extract_total_sqm_from_html(html: str) -> float | None:
    """Read total floor area (m²) from HOQ listing-page HTML — specs table / labels, not LLM."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.body
    if not root:
        return None
    blob = root.get_text("\n", strip=True)

    for dt in root.find_all("dt"):
        lab = (dt.get_text() or "").strip().lower()
        if "total" not in lab:
            continue
        if "internal" in lab and "total" not in lab:
            continue
        dd = dt.find_next_sibling("dd")
        if dd:
            m = re.search(r"([\d][\d.,]*)", dd.get_text() or "")
            if m:
                v = _hoq_parse_sqm_token(m.group(1))
                if v:
                    return v

    for rx in (
        r"(?im)[^\n]{0,48}\btotal\s+area\b[^\n]{0,24}?([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sq\.?\s*m|sqm)?",
        r"(?i)total\s+area\s*[:\-]?\s*([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sqm)?",
        r"(?i)total\s+(?:m\s*)?(?:²|2)\s*[:\-]?\s*([\d][\d.,]*)",
        r"(?i)total\s+(?:size|surface|floor\s*area)\s*[:\-]?\s*([\d][\d.,]*)",
        r"(?i)\b([\d][\d.,]*)\s*m\s*(?:²|2)\s*(?:total|overall)\b",
    ):
        m = re.search(rx, blob)
        if m:
            v = _hoq_parse_sqm_token(m.group(1))
            if v:
                return v

    for row in root.find_all(["tr", "div", "li"]):
        t = " ".join((row.get_text() or "").split())
        tl = t.lower()
        if "total" not in tl:
            continue
        if "internal" in tl and "total" not in tl:
            continue
        if not any(x in tl for x in ("m²", "m2", "sqm", "sq m")):
            continue
        m = re.search(r"([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sqm|sq\.?\s*m)", t, re.I)
        if m:
            v = _hoq_parse_sqm_token(m.group(1))
            if v:
                return v

    return None


def _hoq_extract_internal_sqm_from_html(html: str) -> float | None:
    """Internal / living area (m²) from HOQ listing-page HTML — specifications section."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.body
    if not root:
        return None
    blob = root.get_text("\n", strip=True)

    for dt in root.find_all("dt"):
        lab = (dt.get_text() or "").strip().lower()
        if "external" in lab and "internal" not in lab:
            continue
        if not any(k in lab for k in ("internal", "living", "interior")):
            continue
        if "total" in lab and "internal" not in lab:
            continue
        dd = dt.find_next_sibling("dd")
        if dd:
            m = re.search(r"([\d][\d.,]*)", dd.get_text() or "")
            if m:
                v = _hoq_parse_sqm_token(m.group(1))
                if v:
                    return v

    for rx in (
        r"(?i)internal\s+area\s*[:\-]?\s*([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sqm)?",
        r"(?i)internal\s+(?:m\s*)?(?:²|2)\s*[:\-]?\s*([\d][\d.,]*)",
        r"(?i)living\s+(?:area|space)?\s*[:\-]?\s*([\d][\d.,]*)",
        r"(?i)\bliving\s+area\s*[:\-]?\s*([\d][\d.,]*)",
        r"(?im)[^\n]{0,52}\binternal\s+area\b[^\n]{0,28}?([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sq\.?\s*m|sqm)?",
    ):
        m = re.search(rx, blob)
        if m:
            v = _hoq_parse_sqm_token(m.group(1))
            if v:
                return v

    for row in root.find_all(["tr", "div", "li"]):
        t = " ".join((row.get_text() or "").split())
        tl = t.lower()
        if not any(k in tl for k in ("internal", "living")):
            continue
        if "external" in tl and "internal" not in tl:
            continue
        if not any(x in tl for x in ("m²", "m2", "sqm", "sq m")):
            continue
        if "total" in tl and "internal" not in tl:
            continue
        m = re.search(r"([\d][\d.,]*)\s*(?:m\s*(?:²|2)|sqm|sq\.?\s*m)", t, re.I)
        if m:
            v = _hoq_parse_sqm_token(m.group(1))
            if v:
                return v

    return None


def _hoq_supplement_detail_from_html(html: str, data: dict) -> None:
    """Fill agent_email / agent_phone / agent_name from DOM when the LLM skipped them."""
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("main") or soup.body
    if not root:
        return
    blob = root.get_text("\n", strip=True)

    if not data.get("agent_email"):
        for a in root.select('a[href^="mailto:"]'):
            href = (a.get("href") or "").strip()
            em = href.replace("mailto:", "").split("?")[0].strip()
            if "@" in em and "." in em.split("@", 1)[-1]:
                data["agent_email"] = em
                break

    if not data.get("agent_phone"):
        for a in root.select('a[href^="tel:"]'):
            href = (a.get("href") or "").strip()
            ph = href.replace("tel:", "").split("?")[0].strip()
            digits = re.sub(r"\D", "", ph)
            if len(digits) >= 7:
                data["agent_phone"] = ph
                break

    if not data.get("agent_name"):
        m = re.search(r"(?:listing\s+)?agent\s*[:\-]\s*([^\n\r]{3,90})", blob, re.I)
        if m:
            data["agent_name"] = m.group(1).strip()

    if not data.get("agent_name"):
        for a in root.select('a[href^="mailto:"]'):
            card = a.find_parent(["div", "section", "article", "li"])
            if not card:
                continue
            for tag in card.find_all(["h2", "h3", "h4", "strong"]):
                t = (tag.get_text() or "").strip()
                if 4 <= len(t) <= 90 and re.search(r"[A-Za-zÀ-ž]{2,}", t):
                    low = t.lower()
                    if not any(x in low for x in ("description", "about this", "property", "contact us")):
                        data["agent_name"] = t.split("\n")[0].strip()
                        return


async def _hoq_playwright_html(
    url: str,
    *,
    scroll: bool,
    wait_images: bool,
    detail_expand_description: bool = False,
    detail_capture: dict | None = None,
) -> tuple[str | None, str | None]:
    try:
        from playwright.async_api import async_playwright
        from playwright_stealth import stealth_async
    except ImportError as exc:
        return None, f"Playwright not available: {exc}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await stealth_async(page)
            # `networkidle` often never fires (analytics, websockets, long-polling) → 30s timeout.
            # DOM + brief settle + scroll is enough to capture listing HTML.
            await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            try:
                await page.wait_for_load_state("load", timeout=15_000)
            except Exception:
                logger.debug("HOQ: load event wait skipped or timed out")
            await page.wait_for_timeout(2500)
            try:
                await page.locator("text=/Ref:/i").first.wait_for(timeout=18_000)
            except Exception:
                logger.debug("HOQ: Ref marker wait skipped (page may differ)")
            await page.wait_for_timeout(1200)
            if detail_expand_description:
                try:
                    await page.evaluate("window.scrollBy(0, 550)")
                    await page.wait_for_timeout(500)
                except Exception:
                    logger.debug("HOQ detail: pre-expand scroll skipped")
                await _hoq_try_expand_description(page)
            if wait_images:
                try:
                    await page.wait_for_selector("img[src]", timeout=8000)
                except Exception:
                    logger.debug("HOQ: img selector wait skipped")
            if scroll:
                await page.evaluate(
                    """async () => {
                      for (let i = 0; i < 10; i++) {
                        window.scrollBy(0, 900);
                        await new Promise(r => setTimeout(r, 450));
                      }
                    }"""
                )
            if detail_expand_description:
                await _hoq_try_expand_description(page)
            if detail_expand_description and detail_capture is not None:
                try:
                    await page.wait_for_timeout(500)
                    live = await page.evaluate(_HOQ_LIVE_ABOUT_DESC_JS)
                    if isinstance(live, str) and len(live.strip()) >= 80:
                        detail_capture["about_home_description"] = live.strip()
                except Exception:
                    logger.debug("HOQ: live About This Home text evaluate failed", exc_info=True)
            html = await page.content()
            return html, None
        except Exception as exc:
            logger.exception("HOQ Playwright failed for %s", url)
            return None, str(exc)
        finally:
            await browser.close()


async def scrape_hoq_listing_page(url: str, page: int = 1) -> tuple[list[dict], bool, str | None, int | None]:
    list_url = _hoq_build_list_url(url, page)
    html, err = await _hoq_playwright_html(list_url, scroll=True, wait_images=True)
    if err or not html:
        return [], False, err or "Empty HTML", None

    if not settings.openai_api_key:
        return [], False, "OPENAI_API_KEY is not configured", None

    total_pages = _hoq_parse_total_pages(html)
    html_in = _hoq_html_for_llm(html)
    try:
        raw = await call_openai(HOQ_LIST_PROMPT, html_in, max_tokens=12_000)
    except Exception as exc:
        logger.exception("HOQ list OpenAI failed")
        return [], False, str(exc), total_pages

    parsed = parse_json_universal(raw)
    rows: list[dict] = []
    if isinstance(parsed, list):
        rows = [x for x in parsed if isinstance(x, dict)]
    elif isinstance(parsed, dict):
        inner = parsed.get("properties") or parsed.get("listings") or parsed.get("items")
        if isinstance(inner, list):
            rows = [x for x in inner if isinstance(x, dict)]

    normalized = [_hoq_normalize_list_item(dict(r)) for r in rows]
    normalized = _hoq_dedupe_rows(normalized)
    has_more = _hoq_detect_has_next_page(html, page, total_pages)
    return normalized, has_more, None, total_pages


def _hoq_normalize_dimension_field(data: dict, plural_key: str, singular_key: str) -> None:
    """Coerce a room-dimension field to list[str]; merge legacy singular key."""
    raw = data.get(plural_key)
    legacy = data.pop(singular_key, None)

    lines: list[str] = []

    def _consume(val: object) -> None:
        if val is None:
            return
        if isinstance(val, list):
            for x in val:
                if x is None:
                    continue
                s = str(x).strip()
                if s:
                    lines.append(s)
            return
        if isinstance(val, dict):
            for k, v in val.items():
                vs = str(v).strip() if v is not None else ""
                if vs:
                    lines.append(f"{str(k).strip()}: {vs}")
            return
        s = str(val).strip()
        if not s:
            return
        if "\n" in s or "\r" in s:
            for ln in re.split(r"[\n\r]+", s):
                t = ln.strip()
                if t:
                    lines.append(t)
            return
        lines.append(s)

    _consume(raw)
    if not lines:
        _consume(legacy)

    # Model sometimes merges multiple rooms into one string; split on ; or |
    if len(lines) == 1 and lines[0] and re.search(r"[;|]", lines[0]):
        parts = [p.strip() for p in re.split(r"\s*[;|]\s*", lines[0]) if p.strip()]
        if len(parts) > 1:
            lines = parts

    if lines:
        data[plural_key] = lines
    else:
        data.pop(plural_key, None)


def _hoq_normalize_all_room_dimensions(data: dict) -> None:
    for plural, singular in (
        ("bedroom_dimensions", "bedroom_dimension"),
        ("kitchen_dimensions", "kitchen_dimension"),
        ("living_room_dimensions", "living_room_dimension"),
        ("dining_room_dimensions", "dining_room_dimension"),
    ):
        _hoq_normalize_dimension_field(data, plural, singular)


async def scrape_hoq_detail(reference_or_url: str) -> tuple[dict | None, str | None]:
    s = reference_or_url.strip()
    if s.startswith("http"):
        detail_url = s
        ref_key = None
        for part in urlparse(s).query.split("&"):
            if part.startswith("reference="):
                ref_key = _hoq_normalize_reference(unquote(part.split("=", 1)[1]))
                break
        if ref_key is None:
            ref_key = _hoq_normalize_reference(s)
    else:
        ref_n = _hoq_normalize_reference(s)
        if not ref_n:
            return None, "Invalid reference"
        detail_url = f"{HOQ_DETAIL_BASE}{quote(ref_n, safe='')}"
        ref_key = ref_n

    _detail_cap: dict[str, str] = {}
    html, err = await _hoq_playwright_html(
        detail_url,
        scroll=True,
        wait_images=True,
        detail_expand_description=True,
        detail_capture=_detail_cap,
    )
    if err or not html:
        return None, err or "Empty HTML"

    if not settings.openai_api_key:
        return None, "OPENAI_API_KEY is not configured"

    html_for_model = _hoq_html_for_llm(html, max_chars=160_000)

    try:
        raw = await call_openai(HOQ_DETAIL_PROMPT, html_for_model, max_tokens=12000)
    except Exception as exc:
        return None, str(exc)

    data = parse_json_safely(raw)
    if not data:
        return None, "LLM returned empty or invalid JSON"

    ag = data.get("agent")
    if isinstance(ag, dict):
        data.pop("agent", None)
        if not data.get("agent_name"):
            data["agent_name"] = ag.get("name") or ag.get("full_name")
        if not data.get("agent_email"):
            data["agent_email"] = ag.get("email")
        if not data.get("agent_phone"):
            data["agent_phone"] = ag.get("phone") or ag.get("mobile") or ag.get("tel")

    _hoq_normalize_all_room_dimensions(data)

    _hoq_supplement_detail_from_html(html, data)

    live_about = _detail_cap.get("about_home_description")
    if isinstance(live_about, str) and len(live_about.strip()) >= 80:
        data["description"] = _hoq_normalize_about_description(live_about)
    else:
        dom_desc = _hoq_extract_full_description_from_html(html)
        if dom_desc:
            data["description"] = _hoq_normalize_about_description(dom_desc)

    dom_total = _hoq_extract_total_sqm_from_html(html)
    if dom_total is not None:
        data["total_sqm"] = dom_total

    dom_int = _hoq_extract_internal_sqm_from_html(html)
    if dom_int is not None:
        data["internal_sqm"] = dom_int

    data["listing_url"] = detail_url
    if ref_key:
        data.setdefault("reference", ref_key)
    imgs = data.get("all_images")
    if isinstance(imgs, list):
        fixed: list[str] = []
        for x in imgs:
            if not isinstance(x, str):
                continue
            u = _hoq_abs_media_url(x)
            if u:
                fixed.append(u)
        data["all_images"] = fixed
    mi = data.get("main_image_url")
    if isinstance(mi, str):
        data["main_image_url"] = _hoq_abs_media_url(mi)

    return data, None


@router.get("/hoq/ping")
async def hoq_ping():
    """Sanity check — if this 404s, the API process needs a restart (HOQ routes not loaded)."""
    return {"ok": True, "module": "workbench.hoq"}


@router.post("/hoq/scrape-list")
async def hoq_scrape_list(body: HoqListBody):
    start = max(1, int(body.page or 1))
    n_pages = max(1, min(100, int(body.page_count or 1)))
    merged: list[dict] = []
    seen: set[str] = set()
    last_err: str | None = None
    total_pages_hint: int | None = None
    last_url = _hoq_build_list_url(body.url, start)
    last_has_more = False
    last_fetched = start - 1

    for i in range(n_pages):
        p = start + i
        props, page_has_more, err, tp = await scrape_hoq_listing_page(body.url, p)
        last_url = _hoq_build_list_url(body.url, p)
        last_fetched = p
        if tp is not None:
            total_pages_hint = tp
        if err:
            last_err = err
            break
        last_has_more = page_has_more
        for row in props:
            ref = row.get("reference")
            if not ref or not isinstance(ref, str) or ref in seen:
                continue
            seen.add(ref)
            merged.append(row)
        if i < n_pages - 1:
            await asyncio.sleep(0.8)

    if total_pages_hint is not None:
        global_has_more = last_fetched < total_pages_hint
    else:
        global_has_more = last_has_more

    out: dict = {
        "properties": merged,
        "has_more": bool(global_has_more),
        "page": start,
        "page_count": n_pages,
        "pages_fetched": max(0, last_fetched - start + 1) if last_err is None else 0,
        "total_pages": total_pages_hint,
        "url_used": last_url,
    }
    if last_err:
        out["error"] = last_err
    return out


@router.post("/hoq/scrape-detail")
async def hoq_scrape_detail(body: HoqDetailBody):
    refs = [str(r).strip() for r in body.references if r and str(r).strip()]
    if not refs:
        return {"results": [], "total": 0}

    results: list[dict] = []
    for i, ref in enumerate(refs):
        if i > 0:
            await asyncio.sleep(2)
        try:
            data, err = await scrape_hoq_detail(ref)
            if err:
                results.append(
                    {
                        "reference": ref,
                        "success": False,
                        "error": err,
                        "data": None,
                    }
                )
            elif data:
                results.append(
                    {
                        "reference": data.get("reference") or ref,
                        "success": True,
                        "error": None,
                        "data": data,
                    }
                )
            else:
                results.append(
                    {
                        "reference": ref,
                        "success": False,
                        "error": "Empty extraction",
                        "data": None,
                    }
                )
        except Exception as exc:
            logger.exception("HOQ detail failed for %s", ref)
            results.append({"reference": ref, "success": False, "error": str(exc), "data": None})

    ok = sum(1 for r in results if r.get("success"))
    return {"results": results, "total": ok}
