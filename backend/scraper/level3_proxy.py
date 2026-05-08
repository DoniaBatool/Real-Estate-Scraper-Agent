import random
import logging
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from backend.config import settings
from backend.scraper.level1_httpx import USER_AGENTS

logger = logging.getLogger(__name__)


async def scrape_level3(url: str) -> dict:
    """
    Level 3: Playwright through a residential proxy for sites that block
    direct traffic. Skipped gracefully if proxy credentials are not configured.
    """
    if not (settings.proxy_host and settings.proxy_port):
        logger.warning("Level 3 skipped — PROXY_HOST/PROXY_PORT not configured")
        return {"html": None, "success": False}

    proxy_server = f"http://{settings.proxy_host}:{settings.proxy_port}"
    proxy_cfg: dict = {"server": proxy_server}
    if settings.proxy_username:
        proxy_cfg["username"] = settings.proxy_username
    if settings.proxy_password:
        proxy_cfg["password"] = settings.proxy_password

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, proxy=proxy_cfg)
            context = await browser.new_context(
                user_agent=random.choice(USER_AGENTS),
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            page = await context.new_page()
            await stealth_async(page)

            await page.goto(url, wait_until="networkidle", timeout=40_000)
            await page.evaluate("window.scrollTo(0, 500)")
            await page.wait_for_timeout(2000)

            html = await page.content()
            await browser.close()

            logger.debug("Level 3 success: %s (%d chars)", url, len(html))
            return {"html": html, "success": True}
    except Exception as exc:
        logger.debug("Level 3 failed for %s: %s", url, exc)
    return {"html": None, "success": False}
