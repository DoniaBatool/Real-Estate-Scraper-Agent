import asyncio
import logging
import httpx
from backend.config import settings

logger = logging.getLogger(__name__)

CAPTCHA_SIGNALS = ("captcha", "recaptcha", "hcaptcha", "cf-challenge", "challenge-form")


def _has_captcha(html: str) -> bool:
    lower = html.lower()
    return any(sig in lower for sig in CAPTCHA_SIGNALS)


async def solve_captcha(page) -> bool:
    """
    Detect a CAPTCHA on the current Playwright page and attempt to solve it
    via the 2captcha API. Returns True if solved (or not needed), False otherwise.
    """
    try:
        html = await page.content()
    except Exception:
        return False

    if not _has_captcha(html):
        return True  # no CAPTCHA — nothing to solve

    logger.info("CAPTCHA detected on %s", page.url)

    if not settings.captcha_api_key:
        logger.warning("CAPTCHA_API_KEY not set — cannot auto-solve, skipping page")
        return False

    # Locate the sitekey from the page source
    sitekey = _extract_sitekey(html)
    if not sitekey:
        logger.warning("Could not extract reCAPTCHA sitekey from page")
        return False

    token = await _request_2captcha_solution(sitekey, page.url)
    if not token:
        return False

    # Inject the solved token into the page
    try:
        await page.evaluate(
            f"""
            document.getElementById('g-recaptcha-response').innerHTML = '{token}';
            if (typeof ___grecaptcha_cfg !== 'undefined') {{
                Object.entries(___grecaptcha_cfg.clients).forEach(([k, v]) => {{
                    if (v && v.aa && v.aa.callback) v.aa.callback('{token}');
                }});
            }}
            """
        )
        await page.wait_for_timeout(2000)
        logger.info("CAPTCHA solved and injected successfully")
        return True
    except Exception as exc:
        logger.error("CAPTCHA token injection failed: %s", exc)
        return False


def _extract_sitekey(html: str) -> str | None:
    import re
    patterns = [
        r'data-sitekey=["\']([^"\']+)["\']',
        r'sitekey["\s]*:["\s]*["\']([^"\']+)["\']',
        r'recaptcha/api2/anchor\?.*?&k=([^&"\']+)',
    ]
    for pat in patterns:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


async def _request_2captcha_solution(sitekey: str, page_url: str) -> str | None:
    """Submit to 2captcha and poll for the result (max ~90 seconds)."""
    api_key = settings.captcha_api_key
    submit_url = "http://2captcha.com/in.php"
    result_url = "http://2captcha.com/res.php"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(submit_url, data={
                "key": api_key,
                "method": "userrecaptcha",
                "googlekey": sitekey,
                "pageurl": page_url,
                "json": 1,
            })
            data = r.json()
            if data.get("status") != 1:
                logger.error("2captcha submission failed: %s", data)
                return None

            captcha_id = data["request"]
            logger.info("2captcha job submitted, id=%s", captcha_id)

            # Poll every 5 seconds for up to 90 seconds
            for _ in range(18):
                await asyncio.sleep(5)
                res = await client.get(result_url, params={
                    "key": api_key,
                    "action": "get",
                    "id": captcha_id,
                    "json": 1,
                })
                res_data = res.json()
                if res_data.get("status") == 1:
                    logger.info("2captcha solved successfully")
                    return res_data["request"]
                if res_data.get("request") != "CAPCHA_NOT_READY":
                    logger.error("2captcha error: %s", res_data)
                    return None

    except Exception as exc:
        logger.error("2captcha request error: %s", exc)
    return None
