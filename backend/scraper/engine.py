import asyncio
import logging
import random
from urllib.parse import urlparse

from backend.config import settings
from backend.scraper.level1_httpx import scrape_level1
from backend.scraper.level2_playwright import scrape_level2
from backend.scraper.level3_proxy import scrape_level3
from backend.scraper.listing_discovery import extract_property_urls, find_listings_page

logger = logging.getLogger(__name__)

# Max 10 concurrent browser sessions across all async tasks
_semaphore = asyncio.Semaphore(10)


class ScraperEngine:
    """
    Layered scraping engine. Tries the cheapest method first and escalates
    only when the previous level fails to return usable HTML.

    Level 1 — httpx (no browser, ~0.5s, zero cost)
    Level 2 — Playwright + stealth (~3–5s)
    Level 3 — Playwright + residential proxy (~8–12s)
    """

    async def scrape(self, url: str) -> dict:
        async with _semaphore:
            return await self._scrape_inner(url)

    async def _scrape_inner(self, url: str) -> dict:
        # Level 1 — fast HTTP
        result = await scrape_level1(url)
        if result["success"]:
            logger.info("Scraped %s via Level 1", url)
            return {**result, "level": 1, "url": url}

        await asyncio.sleep(random.uniform(2, 5))

        # Level 2 — stealth browser
        result = await scrape_level2(url)
        if result["success"]:
            logger.info("Scraped %s via Level 2", url)
            return {**result, "level": 2, "url": url}

        await asyncio.sleep(random.uniform(2, 5))

        # Level 3 — proxy rotation
        result = await scrape_level3(url)
        if result["success"]:
            logger.info("Scraped %s via Level 3", url)
            return {**result, "level": 3, "url": url}

        logger.warning("All levels failed for %s", url)
        return {"html": None, "level": 0, "success": False, "url": url}


class MultiPageScraper:
    """
    Full-path crawl for one agency site: homepage → listings index (if found) →
    up to N property detail pages (same layered engine as single-page scrape).
    """

    def __init__(self, engine: ScraperEngine | None = None):
        self.engine = engine or ScraperEngine()

    async def scrape_agency_complete(self, agency_url: str) -> dict:
        agency_url = agency_url.strip()
        if not agency_url.startswith(("http://", "https://")):
            agency_url = "https://" + agency_url.lstrip("/")

        result: dict = {
            "homepage_html": None,
            "listings_html": None,
            "listings_url": None,
            "property_pages": [],
            "max_level": 0,
            "success": False,
        }

        homepage = await self.engine.scrape(agency_url)
        result["max_level"] = max(result["max_level"], homepage.get("level") or 0)

        if not homepage.get("success") or not homepage.get("html"):
            logger.warning("MultiPage: homepage failed for %s", agency_url)
            return result

        result["homepage_html"] = homepage["html"]
        result["success"] = True

        listings_idx_url = await find_listings_page(agency_url, homepage["html"])
        listings_html = homepage["html"]
        link_base = agency_url

        if listings_idx_url:
            lp = await self.engine.scrape(listings_idx_url)
            result["max_level"] = max(result["max_level"], lp.get("level") or 0)
            if lp.get("success") and lp.get("html"):
                listings_html = lp["html"]
                link_base = str(lp.get("url") or listings_idx_url)
            result["listings_url"] = listings_idx_url
        else:
            result["listings_url"] = agency_url

        result["listings_html"] = listings_html

        prop_urls = extract_property_urls(link_base, listings_html)
        max_detail = settings.scrape_max_property_detail_pages

        for prop_url in prop_urls[:max_detail]:
            await asyncio.sleep(random.uniform(0.8, 2.8))
            prop_page = await self.engine.scrape(prop_url)
            result["max_level"] = max(result["max_level"], prop_page.get("level") or 0)
            if prop_page.get("success") and prop_page.get("html"):
                result["property_pages"].append(
                    {
                        "url": prop_url,
                        "html": prop_page["html"],
                        "level": prop_page.get("level"),
                    }
                )

        logger.info(
            "MultiPage: %s — listings base=%s detail_pages=%d",
            urlparse(agency_url).netloc,
            link_base,
            len(result["property_pages"]),
        )
        return result
