import asyncio
import random
import re
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from backend.scraper.level1_httpx import scrape_level1
from backend.scraper.level2_playwright import scrape_level2

ABOUT_PATTERNS = [
    "/about",
    "/about-us",
    "/about_us",
    "/who-we-are",
    "/our-story",
    "/team",
    "/company",
    "/chi-siamo",
    "/uber-uns",
    "/a-propos",
    "/nosotros",
    "/sobre-nos",
]

LISTINGS_PATTERNS = [
    "/properties",
    "/listings",
    "/property",
    "/for-sale",
    "/for-rent",
    "/buy",
    "/rent",
    "/search",
    "/results",
    "/all-properties",
    "/property-for-sale",
    "/property-for-rent",
    "/residential",
    "/commercial",
    "/properties-for-sale",
    "/properties-for-rent",
    "/real-estate",
    "/our-properties",
    "/available-properties",
    "/buy-property",
    "/rent-property",
    "/sale",
    "/lettings",
    "/portfolio",
    # Extra CMS / locale paths (keep from prior versions)
    "/immobili",
    "/properti",
    "/immeuble",
    "/propiedades",
]

EXCLUDE_FROM_LISTINGS = [
    "/service",
    "/services",
    "/about",
    "/about-us",
    "/contact",
    "/team",
    "/blog",
    "/news",
    "/management",
    "/after-sales",
]

CONTACT_PATTERNS = [
    "/contact",
    "/contact-us",
    "/contacts",
    "/get-in-touch",
    "/reach-us",
    "/contatti",
]


def _listings_url_excluded(found_url: str) -> bool:
    """Skip service/about/contact-style pages mistaken for listing indexes."""
    u = found_url.lower()
    return any(excl in u for excl in EXCLUDE_FROM_LISTINGS)


async def find_listings_page(base_url: str, homepage_html: str = "") -> str | None:
    """
    Resolve the agency listings/search index URL.
    Uses LISTINGS_PATTERNS and skips EXCLUDE_FROM_LISTINGS (e.g. /service/...).
    """
    host = (urlparse(base_url).hostname or "").lower().removeprefix("www.")

    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        for path in LISTINGS_PATTERNS:
            try:
                found_url = urljoin(base_url, path)
                if _listings_url_excluded(found_url):
                    continue
                r = await client.head(found_url)
                if r.status_code == 200:
                    return found_url
            except Exception:
                continue

    if homepage_html:
        soup = BeautifulSoup(homepage_html, "html.parser")
        keywords = [p.strip("/") for p in LISTINGS_PATTERNS]

        for a_tag in soup.find_all("a", href=True):
            href = str(a_tag.get("href", ""))
            href_l = href.lower().strip()
            if not href_l or href_l in {"#", "/#"} or href_l.startswith(
                ("#", "javascript:", "mailto:", "tel:")
            ):
                continue
            full_url = urljoin(base_url, href)
            if _listings_url_excluded(full_url):
                continue
            fhost = (urlparse(full_url).hostname or "").lower().removeprefix("www.")
            if fhost != host:
                continue
            if any(kw in href_l for kw in keywords):
                return full_url
    return None


async def find_page_url(base_url: str, patterns: list[str], homepage_html: str = "") -> str | None:
    """Find matching page by probing common paths, then scanning homepage links."""
    host = (urlparse(base_url).hostname or "").lower().removeprefix("www.")

    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        for path in patterns:
            try:
                url = urljoin(base_url, path)
                r = await client.head(url)
                if r.status_code == 200:
                    return url
            except Exception:
                continue

    if homepage_html:
        soup = BeautifulSoup(homepage_html, "html.parser")
        keywords = [p.strip("/") for p in patterns]

        for a_tag in soup.find_all("a", href=True):
            href = str(a_tag.get("href", ""))
            text = a_tag.get_text(strip=True).lower()
            href_l = href.lower().strip()
            # Skip non-navigational anchors and pseudo links.
            if not href_l or href_l in {"#", "/#"} or href_l.startswith(
                ("#", "javascript:", "mailto:", "tel:")
            ):
                continue
            full_url = urljoin(base_url, href)
            fhost = (urlparse(full_url).hostname or "").lower().removeprefix("www.")
            if fhost != host:
                continue
            # Prefer real URL path matches; avoid matching by label text alone.
            if any(kw in href_l for kw in keywords):
                return full_url
    return None


async def extract_all_property_urls(base_url: str, listings_html: str, listings_url: str) -> list[str]:
    """Extract property detail URLs from listings page and optional next pages."""
    soup = BeautifulSoup(listings_html, "html.parser")
    host = (urlparse(base_url).hostname or "").lower().removeprefix("www.")
    urls: set[str] = set()

    property_patterns = [
        r"/propert",
        r"/listing/",
        r"/property/",
        r"/immobil",
        r"/casa/",
        r"/apartment",
        r"/villa/",
        r"/house/",
        r"/home/",
        r"/ref/",
        r"/ref=",
        r"[?&]id=\d",
        r"/\d{4,}",
        r"[?&]ref=",
        r"/sale/",
        r"/rent/",
    ]
    exclude_patterns = [
        "#",
        "mailto:",
        "tel:",
        "javascript:",
        "/service",
        "/services",
        "contact",
        "about",
        "blog",
        "news",
        "agent",
        "team",
        "privacy",
        "cookie",
        "login",
        "register",
        "account",
        "search?",
        "facebook",
        "twitter",
        "instagram",
        "linkedin",
    ]

    for a_tag in soup.find_all("a", href=True):
        href = str(a_tag.get("href", ""))
        if not href:
            continue
        full_url = urljoin(listings_url, href)
        fhost = (urlparse(full_url).hostname or "").lower().removeprefix("www.")
        if fhost != host:
            continue
        lf = full_url.lower()
        if any(ex in lf for ex in exclude_patterns):
            continue
        if any(re.search(p, full_url, re.I) for p in property_patterns):
            urls.add(full_url)

    next_page_urls: list[str] = []
    for a_tag in soup.find_all("a", href=True):
        href = str(a_tag.get("href", ""))
        text = a_tag.get_text(strip=True).lower()
        if any(x in text for x in ["next", "›", "»", "2", "page"]):
            full_url = urljoin(listings_url, href)
            fhost = (urlparse(full_url).hostname or "").lower().removeprefix("www.")
            if fhost == host and full_url != listings_url:
                next_page_urls.append(full_url)

    if len(urls) < 5 and next_page_urls:
        for next_url in next_page_urls[:2]:
            result = await scrape_level1(next_url)
            if not result.get("success"):
                result = await scrape_level2(next_url)
            if result.get("success"):
                more_soup = BeautifulSoup(result.get("html", ""), "html.parser")
                for a_tag in more_soup.find_all("a", href=True):
                    href = str(a_tag.get("href", ""))
                    full_url = urljoin(next_url, href)
                    lf = full_url.lower()
                    fhost = (urlparse(full_url).hostname or "").lower().removeprefix("www.")
                    if (
                        fhost == host
                        and not any(ex in lf for ex in exclude_patterns)
                        and any(re.search(p, full_url, re.I) for p in property_patterns)
                    ):
                        urls.add(full_url)

    return list(urls)


async def scrape_agency_deep(agency_url: str) -> dict:
    """Deep scrape homepage/footer/about/contact/listings + property detail pages."""
    result = {
        "homepage_html": None,
        "footer_html": None,
        "about_html": None,
        "contact_html": None,
        "listings_html": None,
        "property_pages": [],
    }

    async def smart_scrape(url: str) -> dict:
        r = await scrape_level1(url)
        if r.get("success") and len(r.get("html", "")) > 500:
            return r
        await asyncio.sleep(random.uniform(1, 2))
        return await scrape_level2(url)

    homepage_result = await smart_scrape(agency_url)
    if not homepage_result.get("success"):
        return result

    homepage_html = homepage_result.get("html", "")
    result["homepage_html"] = homepage_html

    soup = BeautifulSoup(homepage_html, "html.parser")
    footer = soup.find("footer")
    if footer:
        result["footer_html"] = str(footer)

    await asyncio.sleep(random.uniform(1, 2))

    about_url = await find_page_url(agency_url, ABOUT_PATTERNS, homepage_html)
    if about_url and about_url != agency_url:
        about_result = await smart_scrape(about_url)
        if about_result.get("success"):
            result["about_html"] = about_result.get("html")
        await asyncio.sleep(random.uniform(1, 2))

    contact_url = await find_page_url(agency_url, CONTACT_PATTERNS, homepage_html)
    if contact_url and contact_url != agency_url:
        contact_result = await smart_scrape(contact_url)
        if contact_result.get("success"):
            result["contact_html"] = contact_result.get("html")
        await asyncio.sleep(random.uniform(1, 2))

    listings_url = await find_listings_page(agency_url, homepage_html)
    if listings_url and listings_url != agency_url:
        listings_result = await smart_scrape(listings_url)
        if listings_result.get("success"):
            listings_html = listings_result.get("html", "")
            result["listings_html"] = listings_html
            property_urls = await extract_all_property_urls(agency_url, listings_html, listings_url)

            semaphore = asyncio.Semaphore(3)

            async def scrape_property(prop_url: str):
                async with semaphore:
                    await asyncio.sleep(random.uniform(1, 3))
                    r = await smart_scrape(prop_url)
                    if r.get("success") and len(r.get("html", "")) > 300:
                        return {"url": prop_url, "html": r.get("html", "")}
                    return None

            tasks = [scrape_property(url) for url in property_urls[:30]]
            property_results = await asyncio.gather(*tasks, return_exceptions=True)
            result["property_pages"] = [r for r in property_results if r and not isinstance(r, Exception)]

    return result
