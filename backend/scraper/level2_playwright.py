import random
import logging
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from backend.scraper.level1_httpx import USER_AGENTS

logger = logging.getLogger(__name__)


async def scrape_level2(url: str) -> dict:
    """
    Level 2: headless Chromium with playwright-stealth to bypass basic bot detection.
    Waits for network idle, scrolls to simulate human behaviour, then returns the DOM.
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=random.choice(USER_AGENTS),
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            page = await context.new_page()
            await stealth_async(page)

            await page.goto(url, wait_until="networkidle", timeout=30_000)

            # Simulate human scroll
            await page.evaluate("window.scrollTo(0, 500)")
            await page.wait_for_timeout(2000)

            html = await page.content()
            await browser.close()

            if len(html) > 1000:
                logger.debug("Level 2 success: %s (%d chars)", url, len(html))
                return {"html": html, "success": True}

            logger.debug("Level 2 insufficient content for %s", url)
    except Exception as exc:
        logger.debug("Level 2 failed for %s: %s", url, exc)
    return {"html": None, "success": False}
