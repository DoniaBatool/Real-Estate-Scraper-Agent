"""
Follow listing/detail URLs on an agency site to collect full property rows.
"""
from __future__ import annotations

import logging
from urllib.parse import urljoin

from backend.ai.extractor import extract_data
from backend.scraper.engine import ScraperEngine
from backend.scraper.html_signals import discover_listing_urls, url_fingerprint

logger = logging.getLogger(__name__)


def _richness(p: dict) -> int:
    n = 0
    for _k, v in p.items():
        if v is None or v == "" or v == []:
            continue
        n += 1
    return n


def dedupe_properties(rows: list[dict], base_url: str) -> list[dict]:
    """Keep richest row per listing_url fingerprint or title/price fallback."""
    best: dict[str, dict] = {}
    for p in rows:
        if not isinstance(p, dict):
            continue
        lu = p.get("listing_url")
        if lu:
            key = url_fingerprint(str(lu), base_url)
        else:
            t = (p.get("title") or "").strip().lower()[:120]
            pr = p.get("price")
            key = f"anon:{t}:{pr}"
        prev = best.get(key)
        if prev is None or _richness(p) > _richness(prev):
            best[key] = p
    return list(best.values())


async def collect_properties_deep(
    engine: ScraperEngine,
    site_url: str,
    main_html: str,
    main_extracted: dict,
    max_extra_pages: int,
    detail_extraction_max_tokens: int = 6000,
) -> list[dict]:
    """
    Start from properties + hrefs on the main page, scrape additional listing URLs
    (same domain) and merge AI-extracted rows.
    """
    merged: list[dict] = [p for p in (main_extracted.get("properties") or []) if isinstance(p, dict)]

    seen_fp: set[str] = {url_fingerprint(site_url, site_url)}
    ordered_candidates: list[str] = []

    def consider(raw_url: str | None) -> None:
        if not raw_url:
            return
        full = urljoin(site_url, raw_url.strip())
        fp = url_fingerprint(full, site_url)
        if fp in seen_fp:
            return
        seen_fp.add(fp)
        ordered_candidates.append(full)

    for p in merged:
        consider(p.get("listing_url"))

    for u in discover_listing_urls(main_html, site_url, max_urls=max_extra_pages * 4):
        consider(u)

    ordered_candidates = [
        u for u in ordered_candidates if url_fingerprint(u, site_url) != url_fingerprint(site_url, site_url)
    ]

    to_fetch = ordered_candidates[:max_extra_pages]

    for listing_url in to_fetch:
        try:
            sub = await engine.scrape(listing_url)
            if not sub.get("success") or not sub.get("html"):
                continue
            extra = await extract_data(sub["html"], listing_url, max_tokens=detail_extraction_max_tokens)
            if not extra:
                continue
            rows = extra.get("properties") or []
            if not rows and extra.get("agency_name"):
                # Model sometimes returns empty properties on sparse pages
                logger.debug("No properties array from listing page %s", listing_url)
            for p in rows:
                if isinstance(p, dict):
                    if not p.get("listing_url"):
                        p["listing_url"] = listing_url
                    merged.append(p)
        except Exception as exc:
            logger.warning("Deep scrape failed for %s: %s", listing_url, exc)

    return dedupe_properties(merged, site_url)
