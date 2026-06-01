import random
import logging
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
from backend.scraper.level1_httpx import USER_AGENTS

logger = logging.getLogger(__name__)

# Very small shells (SPAs / challenges) — retry with scroll; lower than L1 (1000) when merged with L1 elsewhere.
_MIN_USABLE_HTML = 500


async def scrape_level2(url: str, *, capture_screenshot: bool = False) -> dict:
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

            await page.goto(url, wait_until="domcontentloaded", timeout=55_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception:
                pass
            await page.wait_for_timeout(1200)

            # Simulate human scroll (lazy-loaded grids)
            await page.evaluate("window.scrollTo(0, 500)")
            await page.wait_for_timeout(1500)

            html = await page.content()
            if len(html) < _MIN_USABLE_HTML:
                try:
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(2500)
                    html = await page.content()
                except Exception as scroll_exc:
                    logger.debug("Level 2 scroll retry skip %s: %s", url, scroll_exc)

            shot: bytes | None = None
            if capture_screenshot and len(html) > 400:
                try:
                    shot = await page.screenshot(type="jpeg", quality=72, full_page=False)
                except Exception as shot_exc:
                    logger.debug("Screenshot skip %s: %s", url, shot_exc)
            await browser.close()

            if len(html) > _MIN_USABLE_HTML:
                logger.debug("Level 2 success: %s (%d chars)", url, len(html))
                out: dict = {"html": html, "success": True}
                if shot:
                    out["screenshot_jpeg"] = shot
                return out

            logger.debug("Level 2 insufficient content for %s", url)
    except Exception as exc:
        logger.debug("Level 2 failed for %s: %s", url, exc)
    return {"html": None, "success": False}
