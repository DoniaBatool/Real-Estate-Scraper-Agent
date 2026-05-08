"""
Tests for the layered scraper engine.
Level 1 and 2 are tested with a real public URL (httpbin.org).
Level 3 is tested in offline / no-proxy mode.
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from backend.scraper.level1_httpx import scrape_level1
from backend.scraper.level2_playwright import scrape_level2
from backend.scraper.engine import ScraperEngine


# ---------------------------------------------------------------------------
# Level 1 — httpx
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_level1_success():
    result = await scrape_level1("https://httpbin.org/html")
    assert result["success"] is True
    assert result["html"] is not None
    assert len(result["html"]) > 100


@pytest.mark.asyncio
async def test_level1_404_returns_failure():
    result = await scrape_level1("https://httpbin.org/status/404")
    assert result["success"] is False


@pytest.mark.asyncio
async def test_level1_bad_url_returns_failure():
    result = await scrape_level1("https://this-domain-definitely-does-not-exist-xyz.com")
    assert result["success"] is False


# ---------------------------------------------------------------------------
# Level 2 — Playwright stealth (skipped in CI if playwright not installed)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_level2_success():
    pytest.importorskip("playwright")
    result = await scrape_level2("https://httpbin.org/html")
    assert result["success"] is True
    assert result["html"] is not None


# ---------------------------------------------------------------------------
# Engine — mocked levels
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_engine_uses_level1_when_successful():
    good = {"html": "<html>content</html>", "success": True}

    with patch("backend.scraper.engine.scrape_level1", return_value=good) as mock_l1, \
         patch("backend.scraper.engine.scrape_level2") as mock_l2, \
         patch("backend.scraper.engine.scrape_level3") as mock_l3:

        engine = ScraperEngine()
        result = await engine.scrape("https://example.com")

        assert result["success"] is True
        assert result["level"] == 1
        mock_l1.assert_called_once()
        mock_l2.assert_not_called()
        mock_l3.assert_not_called()


@pytest.mark.asyncio
async def test_engine_falls_back_to_level2():
    fail = {"html": None, "success": False}
    good = {"html": "<html>content</html>", "success": True}

    with patch("backend.scraper.engine.scrape_level1", return_value=fail), \
         patch("backend.scraper.engine.scrape_level2", return_value=good), \
         patch("backend.scraper.engine.scrape_level3") as mock_l3, \
         patch("backend.scraper.engine.asyncio.sleep"):  # skip real delay

        engine = ScraperEngine()
        result = await engine.scrape("https://example.com")

        assert result["success"] is True
        assert result["level"] == 2
        mock_l3.assert_not_called()


@pytest.mark.asyncio
async def test_engine_returns_failure_when_all_levels_fail():
    fail = {"html": None, "success": False}

    with patch("backend.scraper.engine.scrape_level1", return_value=fail), \
         patch("backend.scraper.engine.scrape_level2", return_value=fail), \
         patch("backend.scraper.engine.scrape_level3", return_value=fail), \
         patch("backend.scraper.engine.asyncio.sleep"):

        engine = ScraperEngine()
        result = await engine.scrape("https://example.com")

        assert result["success"] is False
        assert result["level"] == 0


# ---------------------------------------------------------------------------
# Captcha detection
# ---------------------------------------------------------------------------

def test_captcha_detection_positive():
    from backend.scraper.captcha import _has_captcha
    assert _has_captcha("<div class='recaptcha'>") is True
    assert _has_captcha("Please solve this captcha") is True


def test_captcha_detection_negative():
    from backend.scraper.captcha import _has_captcha
    assert _has_captcha("<html><body>Normal page content</body></html>") is False
