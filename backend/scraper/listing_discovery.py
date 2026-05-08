"""
Discover listings index URLs and individual property detail URLs from HTML.
Uses BeautifulSoup + heuristics (same-domain only).
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

COMMON_LISTING_PATHS = [
    "/properties",
    "/listings",
    "/for-sale",
    "/for-rent",
    "/property",
    "/real-estate",
    "/homes",
    "/apartments",
    "/buy",
    "/sale",
    "/rent",
    "/search",
    "/results",
    "/property-for-sale",
    "/property-for-rent",
    "/all-properties",
    "/available-properties",
    "/buying",
    "/lettings",
    "/catalog",
    "/inventory",
]

NAV_KEYWORDS = (
    "propert",
    "listing",
    "for sale",
    "for rent",
    "buy",
    "homes",
    "apartments",
    "search",
    "browse",
    "letting",
    "sale",
    "rent",
    "inventory",
)

PROPERTY_URL_PATTERNS = [
    re.compile(r"/propert", re.I),
    re.compile(r"/listing", re.I),
    re.compile(r"/home[s]?/", re.I),
    re.compile(r"/house[s]?/", re.I),
    re.compile(r"/apartment", re.I),
    re.compile(r"/villa", re.I),
    re.compile(r"/penthouse", re.I),
    re.compile(r"/studio", re.I),
    re.compile(r"/detail", re.I),
    re.compile(r"[?&](id|ref|listing|property)=", re.I),
    re.compile(r"/\d{3,}(?:[/_-][a-z0-9-]+)?/?$", re.I),
]

EXCLUDE_URL_SNIPPETS = (
    "mailto:",
    "tel:",
    "javascript:",
    "#",
    "/contact",
    "/about",
    "/blog",
    "/news",
    "/privacy",
    "/cookie",
    "/terms",
    "/career",
    "/team",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "youtube.com",
)


def _normalize_host(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        return ""


def _same_site(base_url: str, candidate: str) -> bool:
    return _normalize_host(base_url) == _normalize_host(candidate) and bool(_normalize_host(candidate))


async def _probe_url(client: httpx.AsyncClient, url: str) -> str | None:
    """GET URL; return final URL if response looks like HTML listing index."""
    try:
        r = await client.get(url, follow_redirects=True, timeout=15)
        if r.status_code != 200:
            return None
        ct = (r.headers.get("content-type") or "").lower()
        if "html" not in ct and "text" not in ct:
            return None
        if len(r.text) < 600:
            return None
        return str(r.url)
    except Exception as exc:
        logger.debug("probe failed %s: %s", url, exc)
        return None


async def find_listings_page(base_url: str, homepage_html: str) -> str | None:
    """
    Prefer fast probes of common paths, then scan homepage <a> tags for listing-related links.
    """
    base_url = base_url.strip().split("#")[0]
    if not base_url.endswith("/"):
        base_parsed = urlparse(base_url)
        if not base_parsed.path or base_parsed.path == "":
            base_url = base_url.rstrip("/") + "/"

    headers = {
        "User-Agent": random.choice(
            [
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
            ]
        ),
        "Accept": "text/html,application/xhtml+xml",
    }

    async with httpx.AsyncClient(headers=headers) as client:
        sem = asyncio.Semaphore(8)

        async def try_path(path: str) -> str | None:
            async with sem:
                candidate = urljoin(base_url, path)
                return await _probe_url(client, candidate)

        results = await asyncio.gather(*[try_path(p) for p in COMMON_LISTING_PATHS])
        for r in results:
            if r:
                logger.info("Found listings page via path probe: %s", r)
                return r

    if not homepage_html:
        return None

    soup = BeautifulSoup(homepage_html, "html.parser")
    candidates: list[str] = []
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        text = (a.get_text() or "").lower()
        h_low = href.lower()
        if not any(kw in h_low or kw in text for kw in NAV_KEYWORDS):
            continue
        full = urljoin(base_url, href)
        full, _ = urldefrag(full)
        if _same_site(base_url, full) and not any(x in full.lower() for x in ("mailto:", "tel:", "javascript:")):
            candidates.append(full)

    if candidates:
        picked = candidates[0]
        logger.info("Found listings page via nav link: %s", picked)
        return picked

    return None


def extract_property_urls(page_base_url: str, listings_html: str, max_collect: int = 400) -> list[str]:
    """
    Collect same-domain links that look like individual listing detail URLs.
    """
    if not listings_html:
        return []

    soup = BeautifulSoup(listings_html, "html.parser")
    urls: set[str] = set()
    base_host = _normalize_host(page_base_url)

    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href:
            continue
        full, _ = urldefrag(urljoin(page_base_url, href))
        low = full.lower()

        if _normalize_host(full) != base_host:
            continue
        if any(snippet in low for snippet in EXCLUDE_URL_SNIPPETS):
            continue
        if any(low.endswith(ext) for ext in (".jpg", ".png", ".pdf", ".zip", ".css", ".js")):
            continue

        matched = any(p.search(full) for p in PROPERTY_URL_PATTERNS)
        if not matched:
            continue

        urls.add(full)
        if len(urls) >= max_collect:
            break

    # Regex / path-heuristic URLs (footer, cards) — merge
    try:
        from backend.scraper.html_signals import discover_listing_urls

        for u in discover_listing_urls(listings_html, page_base_url, max_urls=max_collect):
            if _normalize_host(u) == base_host:
                urls.add(u.split("#")[0])
    except Exception as exc:
        logger.debug("discover_listing_urls merge skipped: %s", exc)

    return list(urls)[:max_collect]
