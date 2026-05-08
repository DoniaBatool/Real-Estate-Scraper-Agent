import asyncio
import random
import logging
from backend.scraper.level1_httpx import scrape_level1
from backend.scraper.level2_playwright import scrape_level2
from backend.scraper.level3_proxy import scrape_level3

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
