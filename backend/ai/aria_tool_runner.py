"""
Execute ARIA tools — real-time web scraping via Stagehand + Browserbase.
No database lookups for properties. Everything is live.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from openai import AsyncOpenAI

from backend.config import settings
from backend.ai.aria_pure import _filter_by_prefs  # noqa: F401 — re-exported for callers

logger = logging.getLogger(__name__)
_llm = AsyncOpenAI(api_key=settings.openai_api_key)

# Stagehand lives in the Next.js frontend — we call it as an HTTP service
STAGEHAND_SEARCH_URL = f"{settings.frontend_url}/api/stagehand/search"
STAGEHAND_SCRAPE_URL = f"{settings.frontend_url}/api/stagehand/scrape-url"

# Apify
APIFY_BASE = "https://api.apify.com/v2"

# Domains to skip ONLY during automated agency discovery (find_agencies / live_search_properties).
# These are filtered from search results because they are not real estate agency sites.
# IMPORTANT: This list is NEVER applied to user-provided URLs.
# If a user explicitly shares a URL (even airbnb.com, booking.com, etc.) → always scrape it.
_SKIP_DOMAINS = {
    "facebook", "instagram", "twitter", "x.com", "youtube", "tiktok",
    "google", "wikipedia", "reddit", "yelp", "linkedin",
    "amazon", "ebay",
}


# ── Helpers ────────────────────────────────────────────────────────────────

async def _pre_check_url(target_url: str, timeout: float = 8.0) -> bool:
    """Quick HEAD/GET check to see if a site is reachable before launching Stagehand.

    Returns True if reachable, False if definitely unreachable (saves 35+ seconds
    of Playwright timeout on dead sites like alliance.mt).
    """
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=timeout, read=timeout, write=5.0, pool=5.0),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; bot/1.0)"},
        ) as client:
            resp = await client.head(target_url)
            # Any HTTP response (even 4xx/5xx) means the server is alive
            return True
    except (httpx.ConnectTimeout, httpx.ConnectError, httpx.ReadTimeout):
        return False
    except Exception:
        # Unknown errors — let Stagehand try anyway
        return True


async def _call_stagehand(url: str, payload: dict, timeout: float = 180.0) -> dict:
    """POST to a Stagehand Next.js route and return parsed JSON."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:500]
        logger.warning("Stagehand HTTP error %s: %s", exc.response.status_code, body)
        try:
            return exc.response.json()
        except Exception:
            return {"error": f"HTTP {exc.response.status_code}", "detail": body}
    except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
        # Stagehand took too long — treat as site unreachable so ARIA can move on
        target = payload.get("url", "unknown site")
        logger.warning("Stagehand timeout for %s: %s", target, exc)
        return {
            "skipped": True,
            "reason": "site_unreachable",
            "error": f"Stagehand timed out scraping {target}",
            "properties": [],
            "properties_found": 0,
        }
    except Exception as exc:
        logger.warning("Stagehand call failed: %s", exc)
        return {"error": str(exc)}


def _web_search_sync(query: str) -> list[dict]:
    """Sync DuckDuckGo search — called from executor."""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=6))
    except Exception as exc:
        logger.warning("DuckDuckGo failed: %s", exc)
        return []


async def _web_search(query: str) -> dict:
    """Try Tavily first, fall back to DuckDuckGo."""
    # Tavily
    tavily_key = getattr(settings, "tavily_api_key", "")
    if tavily_key and tavily_key.startswith("tvly-"):
        try:
            from tavily import TavilyClient
            client = TavilyClient(api_key=tavily_key)
            res = client.search(query=query, max_results=6, include_answer=True)
            return {
                "answer": res.get("answer", ""),
                "results": [
                    {"title": r.get("title", ""), "snippet": r.get("content", ""), "url": r.get("url", "")}
                    for r in res.get("results", [])
                ],
                "source": "tavily",
            }
        except Exception as exc:
            logger.warning("Tavily failed: %s", exc)

    # DuckDuckGo fallback
    import asyncio, functools
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, functools.partial(_web_search_sync, query))
    return {
        "results": [
            {"title": r.get("title", ""), "snippet": r.get("body", ""), "url": r.get("href", "")}
            for r in results
        ],
        "source": "duckduckgo",
    }


async def _find_agencies_apify(city: str, country: str, max_results: int = 8) -> list[dict]:
    """Use Apify Google-Search Scraper to find real estate agency websites."""
    api_key = getattr(settings, "apify_api_key", "")
    if not api_key:
        return []

    query = f"real estate agency {city} {country} property listings"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{APIFY_BASE}/acts/apify~google-search-scraper/run-sync-get-dataset-items",
                params={"token": api_key},
                json={
                    "queries": query,
                    "maxPagesPerQuery": 1,
                    "resultsPerPage": max_results + 3,
                    "countryCode": "",
                    "languageCode": "en",
                    "mobileResults": False,
                    "includeImages": False,
                    "saveHtml": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Apify search failed: %s", exc)
        return []

    agencies: list[dict] = []
    seen: set[str] = set()

    for item in data:
        for result in item.get("organicResults", []):
            url  = str(result.get("url", "")).strip()
            title = str(result.get("title", "")).strip()
            desc  = str(result.get("description", "")).strip()

            if not url.startswith("http"):
                continue
            domain = url.split("/")[2].lower().replace("www.", "")
            if any(s in domain for s in _SKIP_DOMAINS):
                continue

            base = "/".join(url.split("/")[:3])
            if base in seen:
                continue
            seen.add(base)

            clean_name = title.split("|")[0].split(" - ")[0].split(" – ")[0].strip()
            agencies.append({
                "name":        clean_name[:60],
                "website":     base,
                "description": desc[:120],
            })
            if len(agencies) >= max_results:
                break
        if len(agencies) >= max_results:
            break

    return agencies


async def _find_agencies_websearch(city: str, country: str, max_results: int = 8) -> list[dict]:
    """Fallback: use Tavily/DuckDuckGo to find agency websites."""
    queries = [
        f"real estate agency {city} {country} property listings",
        f"property for sale rent {city} {country} agency",
    ]
    agencies: list[dict] = []
    seen: set[str] = set()

    for q in queries:
        res = await _web_search(q)
        for r in res.get("results", []):
            url = str(r.get("url", "")).strip()
            if not url.startswith("http"):
                continue
            domain = url.split("/")[2].lower().replace("www.", "")
            if any(s in domain for s in _SKIP_DOMAINS):
                continue
            base = "/".join(url.split("/")[:3])
            if base in seen:
                continue
            seen.add(base)
            agencies.append({
                "name":        r.get("title", domain)[:60],
                "website":     base,
                "description": r.get("snippet", "")[:120],
            })
            if len(agencies) >= max_results:
                break
        if len(agencies) >= max_results:
            break

    return agencies


def _is_fake_url(u: str) -> bool:
    if not u:
        return True
    try:
        from urllib.parse import urlparse
        host = urlparse(u).hostname or ""
        bad_hosts = {"example.com", "placeholder.com", "via.placeholder.com", "dummyimage.com", "lorempixel.com"}
        return (
            host in bad_hosts
            or "lorem" in host
            or "/link1" in u
            or "/link2" in u
            or "fake" in host
        )
    except Exception:
        return True


def _is_real_img(u: str) -> bool:
    if not u or not u.startswith("http"):
        return False
    return not _is_fake_url(u)


def _format_property_list(properties: list[dict], limit: int = 20) -> list[dict]:
    """Normalise and limit the property list returned to ARIA."""
    clean = []
    for p in properties[:limit]:
        clean.append({
            "title":         p.get("title", ""),
            "property_type": p.get("property_type", ""),
            "category":      p.get("category", ""),
            "price":         p.get("price"),
            "currency":      p.get("currency", ""),
            "bedrooms":      p.get("bedrooms"),
            "bathrooms":     p.get("bathrooms"),
            "total_sqm":     p.get("total_sqm"),
            "locality":      p.get("locality", ""),
            "city":          p.get("city", ""),
            "country":       p.get("country", ""),
            "full_address":  p.get("full_address", ""),
            "description":   (p.get("description") or "")[:300],
            "listing_url":   p.get("listing_url", "") if not _is_fake_url(p.get("listing_url", "")) else "",
            "images":        [u for u in (p.get("images") or [])[:3] if _is_real_img(u)],
            "amenities":     (p.get("amenities") or [])[:8],
            "furnished":     p.get("furnished", ""),
            "year_built":    p.get("year_built"),
            "agency_name":   p.get("agency_name", ""),
            "agency_website":p.get("agency_website", ""),
        })
    return clean


# ── Main dispatcher ────────────────────────────────────────────────────────

async def execute_aria_tool(tool_name: str, raw_args: dict[str, Any]) -> str:
    """Returns a JSON string for the OpenAI Agents SDK tool result channel."""
    args = raw_args or {}

    # ── 1. live_search_properties ─────────────────────────────────────────
    if tool_name == "live_search_properties":
        city          = str(args.get("city") or "").strip()
        country       = str(args.get("country") or "").strip()
        property_type = str(args.get("property_type") or "any").strip()
        category      = str(args.get("category") or "any").strip()
        max_agencies  = int(args.get("max_agencies") or 4)
        max_agencies  = max(1, min(max_agencies, 6))

        if not city and not country:
            return json.dumps({"error": "Please provide at least city or country."})

        location_str = " ".join(filter(None, [city, country]))
        cat_str      = "rent" if "rent" in category.lower() else "sale"
        prop_str     = property_type if property_type and property_type != "any" else "property"

        # ── Step 1: Use Tavily/DuckDuckGo to find real estate website URLs ──
        # Skip only pure social/general sites during auto-discovery.
        # Portals like Airbnb, Booking, Bayut, PropertyFinder ARE valid sources.
        # (User-provided URLs bypass this list entirely — always scrape them.)
        SKIP_DOMAINS = _SKIP_DOMAINS  # use the module-level set

        agency_urls: list[str] = []
        queries = [
            f"{prop_str} for {cat_str} {location_str} real estate",
            f"property listings {location_str} {cat_str} agency site",
        ]

        for q in queries:
            if len(agency_urls) >= max_agencies:
                break
            res = await _web_search(q)
            for r in res.get("results", []):
                url = str(r.get("url", "")).strip()
                if not url.startswith("http"):
                    continue
                domain = url.split("/")[2].lower().replace("www.", "")
                # Only skip non-real-estate domains
                if any(skip in domain for skip in SKIP_DOMAINS):
                    continue
                # Use base URL so Stagehand lands on homepage/listings
                base = "/".join(url.split("/")[:3])
                bases_so_far = ["/".join(u.split("/")[:3]) for u in agency_urls]
                if base not in bases_so_far:
                    agency_urls.append(base)
                if len(agency_urls) >= max_agencies:
                    break

        if not agency_urls:
            return json.dumps({
                "status":  "no_agencies_found",
                "message": (
                    f"I couldn't automatically find agency websites for {location_str}. "
                    "Please share a specific agency website URL and I'll scrape it directly — "
                    "for example: 'scrape this site: https://www.example-agency.com'"
                ),
            })

        # ── Step 2: Scrape ONLY the first agency. STOP. Wait for user. ─────
        # STRICT FLOW: scrape #1 → show 5 results → ask user → user decides next step.
        # Never auto-advance to next agency. Never scrape more than one site per call.
        first_url      = agency_urls[0]
        remaining_urls = agency_urls[1:]

        # Pre-flight check before launching Stagehand
        if not await _pre_check_url(first_url, timeout=8.0):
            logger.info("Pre-flight: %s unreachable, returning site_unreachable", first_url)
            next_site = remaining_urls[0] if remaining_urls else None
            return json.dumps({
                "status": "site_unreachable",
                "city": city, "country": country,
                "skipped_site": first_url,
                "remaining_agencies": [{"website": u} for u in remaining_urls],
                "next_site": next_site,
                "note": (
                    f"⚠️ {first_url} could not be reached. "
                    f"Ask the user: shall I try the next site"
                    + (f" ({next_site})?" if next_site else "?")
                    + " 😊"
                ),
            })

        data = await _call_stagehand(STAGEHAND_SCRAPE_URL, {
            "url": first_url, "city": city, "country": country,
            "property_type": property_type, "category": category,
        }, timeout=130.0)

        # Browserbase not configured check
        if "not configured" in str(data.get("error", "")).lower():
            return json.dumps({
                "status": "browserbase_not_configured",
                "message": "Browserbase not configured. Add BROWSERBASE_API_KEY to frontend/.env.local.",
            })

        agency_info = data.get("agency") or {}
        agency_name = agency_info.get("name") or first_url.split("/")[2].replace("www.", "")
        props = data.get("properties") or []
        for p in props:
            p["agency_name"]    = p.get("agency_name") or agency_name
            p["agency_website"] = first_url

        # Hard-filter by user preferences
        filtered_props = _filter_by_prefs(
            props,
            category=category,
            property_type=property_type,
        )
        properties = _format_property_list(filtered_props, limit=5)

        # Site unreachable — tell ARIA, let user decide (don't auto-advance)
        if data.get("skipped") or data.get("reason") == "site_unreachable":
            next_site = remaining_urls[0] if remaining_urls else None
            return json.dumps({
                "status":            "site_unreachable",
                "city":              city,
                "country":           country,
                "skipped_site":      first_url,
                "remaining_agencies":[{"website": u} for u in remaining_urls],
                "next_site":         next_site,
                "note": (
                    f"⚠️ {first_url} could not be reached (connection timed out). "
                    f"Tell the user and ask: shall I try the next site"
                    + (f" ({next_site})" if next_site else "")
                    + "? Or would you like to provide your own URL? 😊"
                ),
            })

        next_site = remaining_urls[0] if remaining_urls else None

        return json.dumps({
            "status":            "success" if properties else "no_results",
            "city":              city,
            "country":           country,
            "current_agency":    {"name": agency_name, "website": first_url},
            "remaining_agencies": [{"website": u} for u in remaining_urls],
            "properties_found":  len(properties),
            "properties":        properties,
            "data_freshness":    "real-time — scraped live from agency websites",
            "next_site":         next_site,
            "note": (
                f"Showing up to 5 results from {agency_name} ({first_url}). "
                f"After presenting results, ALWAYS ask the user exactly this: "
                f"'📌 These results are from **{agency_name}**. "
                f"Would you like to: (1) See more from this same site, "
                f"(2) Move on to the next agency"
                + (f" ({next_site})" if next_site else "")
                + f", or (3) Give me a specific website URL you want me to search? 😊'"
            ),
        })

    # ── 2. find_agencies ─────────────────────────────────────────────────
    if tool_name == "find_agencies":
        city    = str(args.get("city") or "").strip()
        country = str(args.get("country") or "").strip()
        source  = str(args.get("source") or "agency").strip().lower()
        # source: "agency" | "owner" | "both"

        if not city and not country:
            return json.dumps({"error": "Please provide at least city or country."})

        location_str = " ".join(filter(None, [city, country]))

        # ── Owner / classified sites search ───────────────────────────────
        async def _find_owner_sites(max_results: int = 6) -> list[dict]:
            """Search for classified / FSBO / owner-listing sites for this location."""
            owner_queries = [
                f"property for sale by owner {location_str} classified site",
                f"{location_str} real estate OLX OR Facebook Marketplace OR classified property",
                f"FSBO {location_str} property owner listing site",
                f"{location_str} private property listing no agent",
            ]
            found: list[str] = []
            seen_bases: set[str] = set()
            # Known classified/marketplace domains to prioritize
            classified_keywords = [
                "olx", "facebook", "marketplace", "classified", "gumtree",
                "craigslist", "maltapark", "property24", "jiji", "dubizzle",
                "avito", "leboncoin", "immoscout", "willhaben", "subito",
                "kijiji", "trovit", "mitula", "nestoria", "zoopla",
            ]
            for q in owner_queries:
                if len(found) >= max_results:
                    break
                res = await _web_search(q)
                for r in res.get("results", []):
                    url = str(r.get("url", "")).strip()
                    if not url.startswith("http"):
                        continue
                    domain = url.split("/")[2].lower().replace("www.", "")
                    # Skip pure agency domains (no "agent" / "realty" / "estate" in name
                    # that are NOT classifieds)
                    is_classified = any(kw in domain for kw in classified_keywords)
                    is_agency_only = any(kw in domain for kw in [
                        "realtor", "remax", "century21", "kw.", "knightfrank",
                    ])
                    if is_agency_only and not is_classified:
                        continue
                    base = "/".join(url.split("/")[:3])
                    if base not in seen_bases:
                        seen_bases.add(base)
                        name = domain.replace("-", " ").replace(".", " ").title()
                        found.append({"name": name, "website": base,
                                      "type": "classified/owner-listed"})
                    if len(found) >= max_results:
                        break
            return found

        agencies: list[dict] = []
        owner_sites: list[dict] = []

        if source in ("agency", "both"):
            agencies = await _find_agencies_apify(city, country, max_results=6)
            if not agencies:
                agencies = await _find_agencies_websearch(city, country, max_results=6)

        if source in ("owner", "both"):
            owner_sites = await _find_owner_sites(max_results=6)

        all_sites = agencies + owner_sites

        if not all_sites:
            return json.dumps({
                "status":  "no_agencies_found",
                "city":    city,
                "country": country,
                "source":  source,
                "message": (
                    f"I couldn't find {'classified/owner listing' if source == 'owner' else 'agency'} "
                    f"websites for {location_str}. "
                    "Please share a specific website URL and I'll scrape it directly."
                ),
            })

        return json.dumps({
            "status":         "success",
            "city":           city,
            "country":        country,
            "source":         source,
            "agencies_found": len(all_sites),
            "agencies":       all_sites,
            "note": (
                "🏠 Owner/classified sites included — properties listed directly by owners, no agent fees!"
                if source in ("owner", "both") else
                "Agency listings returned."
            ),
        })

    # ── 3. scrape_website ─────────────────────────────────────────────────
    if tool_name == "scrape_website":
        url           = str(args.get("url") or "").strip()
        city          = str(args.get("city") or "").strip()
        country       = str(args.get("country") or "").strip()
        locality      = str(args.get("locality") or "").strip()
        property_type = str(args.get("property_type") or "any").strip()
        category      = str(args.get("category") or "any").strip()
        # These are all optional — omit if not provided
        bedrooms         = args.get("bedrooms")
        bathrooms        = args.get("bathrooms")
        min_price        = args.get("min_price")
        max_price        = args.get("max_price")
        amenities        = args.get("amenities")        # list[str] e.g. ["pool", "garage"]
        furnished        = str(args.get("furnished") or "").strip()
        min_total_sqm    = args.get("min_total_sqm")
        min_internal_sqm = args.get("min_internal_sqm")
        min_external_sqm = args.get("min_external_sqm")
        floor_number_arg = args.get("floor_number")
        free_text_prefs  = args.get("free_text_prefs")  # list[str] e.g. ["near school", "pet friendly"]

        if not url:
            return json.dumps({"error": "url is required"})
        if not url.startswith("http"):
            url = "https://" + url

        # ── Pre-flight reachability check (~8s max) ──────────────────────
        # Catches dead sites like alliance.mt before Stagehand wastes 35+ seconds
        reachable = await _pre_check_url(url, timeout=8.0)
        if not reachable:
            logger.info("Pre-flight: %s is unreachable, skipping Stagehand", url)
            return json.dumps({
                "status": "site_unreachable",
                "url": url,
                "properties_found": 0,
                "properties": [],
                "note": (
                    f"⚠️ {url} could not be reached (connection refused or timed out). "
                    "Tell the user this site is unavailable and ask: shall I try the next agency?"
                ),
            })

        payload: dict[str, Any] = {
            "url":           url,
            "city":          city,
            "country":       country,
            "locality":      locality,
            "property_type": property_type,
            "category":      category,
        }
        if bedrooms is not None:
            payload["bedrooms"] = bedrooms
        if bathrooms is not None:
            payload["bathrooms"] = bathrooms
        if min_price is not None:
            payload["min_price"] = min_price
        if max_price is not None:
            payload["max_price"] = max_price
        if amenities:
            payload["amenities"] = amenities
        if furnished:
            payload["furnished"] = furnished
        if min_total_sqm is not None:
            payload["min_total_sqm"] = min_total_sqm
        if min_internal_sqm is not None:
            payload["min_internal_sqm"] = min_internal_sqm
        if min_external_sqm is not None:
            payload["min_external_sqm"] = min_external_sqm
        if floor_number_arg is not None:
            payload["floor_number"] = floor_number_arg
        if free_text_prefs:
            payload["free_text_prefs"] = free_text_prefs

        data = await _call_stagehand(STAGEHAND_SCRAPE_URL, payload)

        # Site was unreachable (ERR_CONNECTION_TIMED_OUT etc.) — tell ARIA to skip it
        if data.get("skipped") or data.get("reason") == "site_unreachable":
            return json.dumps({
                "status": "site_unreachable",
                "url": url,
                "properties_found": 0,
                "properties": [],
                "note": f"⚠️ {url} could not be reached (connection timed out or refused). "
                        "Call scrape_website again with the NEXT agency URL from the list.",
            })

        if "error" in data and not data.get("properties"):
            return json.dumps({
                **data,
                "url": url,
                "note": "No results from this agency. Try calling scrape_website with the next agency URL.",
            })

        agency_info = data.get("agency") or {}
        agency_name = agency_info.get("name") or url.split("/")[2].replace("www.", "")

        # Hard-filter by user preferences before returning
        raw_props = data.get("properties") or []
        filtered  = _filter_by_prefs(
            raw_props,
            locality=locality,
            category=category,
            property_type=property_type,
            bedrooms=int(bedrooms) if bedrooms is not None else None,
            bathrooms=int(bathrooms) if bathrooms is not None else None,
            min_price=float(min_price) if min_price is not None else None,
            max_price=float(max_price) if max_price is not None else None,
            amenities=amenities if amenities else None,
            furnished=furnished,
            min_total_sqm=float(min_total_sqm) if min_total_sqm is not None else None,
            min_internal_sqm=float(min_internal_sqm) if min_internal_sqm is not None else None,
            min_external_sqm=float(min_external_sqm) if min_external_sqm is not None else None,
            floor_number=int(floor_number_arg) if floor_number_arg is not None else None,
            free_text_prefs=free_text_prefs if free_text_prefs else None,
        )
        properties = _format_property_list(filtered, limit=10)
        return json.dumps({
            "status":           "success" if properties else "no_results",
            "url":              url,
            "agency_name":      agency_name,
            "properties_found": len(properties),
            "properties":       properties,
            "agency":           agency_info,
            "data_freshness":   "real-time — just scraped",
            "note": (
                f"Showing up to 5 results from {agency_name} ({url}). "
                f"After presenting results, ALWAYS end with this exact message: "
                f"'📌 These results are from **{agency_name}**. "
                f"Would you like to: (1) See more from this same site, "
                f"(2) Move on to the next agency in the list, "
                f"or (3) Give me a specific website URL you want me to search? 😊'"
            ),
        })

    # ── 4. web_search ─────────────────────────────────────────────────────
    if tool_name == "web_search":
        query = str(args.get("query") or "").strip()
        if not query:
            return json.dumps({"error": "query is required"})
        result = await _web_search(query)
        return json.dumps(result)

    # ── 5. compare_properties ─────────────────────────────────────────────
    if tool_name == "compare_properties":
        properties = args.get("properties") or []
        criteria   = str(args.get("criteria") or "price, size, location, investment value")

        if len(properties) < 2:
            return json.dumps({"error": "Provide at least 2 properties to compare."})

        prompt = f"""You are a senior real estate agent. Compare these {len(properties)} properties
and return ONLY valid JSON (no markdown, no explanation).

Use ALL available data from the properties provided (price, bedrooms, bathrooms, size, amenities,
description, location, furnished status, floor, features, agent contact, etc.).
If a field is missing/null for a property, write "N/A".

Return this exact JSON structure:
{{
  "comparison_table": [
    {{"criteria": "Price", "values": ["EUR 1,300,000", "EUR 975,000"]}},
    {{"criteria": "Bedrooms", "values": ["2", "3"]}},
    {{"criteria": "Bathrooms", "values": ["2", "3"]}},
    {{"criteria": "Size (m²)", "values": ["N/A", "N/A"]}},
    {{"criteria": "Price per m²", "values": ["N/A", "N/A"]}},
    {{"criteria": "Location", "values": ["Sliema, Malta", "Rabat, Malta"]}},
    {{"criteria": "Property Type", "values": ["Apartment", "Apartment"]}},
    {{"criteria": "Furnished", "values": ["Yes", "Finished"]}},
    {{"criteria": "Floor", "values": ["N/A", "N/A"]}},
    {{"criteria": "Key Features", "values": ["Sea Views, Terrace, Lift, Ensuite", "Infinity Pool, Terrace, Lift, Garage"]}},
    {{"criteria": "Description", "values": ["Short summary of prop 1", "Short summary of prop 2"]}},
    {{"criteria": "Agency", "values": ["Owners Best", "Owners Best"]}},
    {{"criteria": "Agent Contact", "values": ["+356 21 49 22 99", "+356 21 49 22 99"]}},
    {{"criteria": "Listing URL", "values": ["https://...", "https://..."]}}
  ],
  "pros_cons": [
    {{"property": "exact property title", "pros": ["pro1", "pro2", "pro3"], "cons": ["con1", "con2"]}},
    {{"property": "exact property title", "pros": ["pro1", "pro2", "pro3"], "cons": ["con1", "con2"]}}
  ],
  "recommendation": "2-3 sentence recommendation explaining which to choose and why",
  "best_for_investment": "exact property title",
  "best_for_living": "exact property title",
  "best_value": "exact property title"
}}

Focus on: {criteria}
Properties data: {json.dumps(properties, default=str, ensure_ascii=False)}"""

        try:
            resp = await _llm.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=3000,
                response_format={"type": "json_object"},
            )
            content = (resp.choices[0].message.content or "").strip()
            return json.dumps(json.loads(content))
        except Exception as exc:
            return json.dumps({"error": str(exc), "properties": properties})

    # ── 6. market_insights ────────────────────────────────────────────────
    if tool_name == "market_insights":
        city         = str(args.get("city") or "").strip()
        country      = str(args.get("country") or "").strip()
        property_type = str(args.get("property_type") or "").strip()
        aspect       = str(args.get("aspect") or "general market overview").strip()

        queries = [
            f"real estate market prices {city} {country} 2025 2026",
            f"property investment {city} {country} outlook rental yield",
        ]
        if property_type:
            queries.append(f"{property_type} prices {city} {country}")

        all_results: list[dict] = []
        for q in queries[:2]:
            res = await _web_search(q)
            all_results.extend(res.get("results", []))

        return json.dumps({
            "city":         city,
            "country":      country,
            "property_type": property_type,
            "aspect":       aspect,
            "market_data":  all_results[:8],
            "note":         "Sourced from live web search — always up to date",
        })

    # ── 7. get_property_details ───────────────────────────────────────────
    if tool_name == "get_property_details":
        agency_url    = str(args.get("agency_url") or "").strip()
        property_title = str(args.get("property_title") or "").strip()
        property_price = args.get("property_price")
        property_city  = str(args.get("property_city") or "").strip()

        if not agency_url:
            return json.dumps({"error": "agency_url is required"})

        details_url = f"{settings.frontend_url}/api/stagehand/property-details"
        data = await _call_stagehand(details_url, {
            "agency_url":     agency_url,
            "property_title": property_title,
            "property_price": property_price,
            "property_city":  property_city,
        }, timeout=150.0)

        if "error" in data:
            return json.dumps(data)

        return json.dumps({
            "status":         "success",
            "title":          data.get("title", ""),
            "price":          data.get("price"),
            "currency":       data.get("currency", "EUR"),
            "listing_url":    data.get("listing_url", ""),
            "description":    data.get("description", ""),
            "full_address":   data.get("full_address", ""),
            "locality":       data.get("locality", ""),
            "bedrooms":       data.get("bedrooms"),
            "bathrooms":      data.get("bathrooms"),
            "total_sqm":      data.get("total_sqm"),
            "floor_number":   data.get("floor_number"),
            "furnished":      data.get("furnished", ""),
            "features":       data.get("features", []),
            "images_count":   len(data.get("images") or []),
            "agent":          data.get("agent", {}),
            "agency":         data.get("agency", {}),
            "data_freshness": "real-time — just fetched from property page",
        })

    return json.dumps({"error": f"Unknown tool: {tool_name}"})
