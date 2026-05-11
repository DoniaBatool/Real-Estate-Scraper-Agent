"""Execute ARIA OpenAI tools against DB, scraper, and web search."""
from __future__ import annotations

import asyncio
import functools
import json
import logging
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import crud
from backend.discovery.apify_client import discover_agencies_sync
from backend.scraper.engine import MultiPageScraper, ScraperEngine
from backend.ai.extractor import extract_from_multipage

logger = logging.getLogger(__name__)
_llm_client = AsyncOpenAI(api_key=settings.openai_api_key)


def _ddg_sync(query: str) -> list[dict]:
    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=5))
    except Exception as exc:
        logger.warning("DuckDuckGo search failed: %s", exc)
        return []


async def execute_aria_tool(db: AsyncSession, tool_name: str, raw_args: dict[str, Any]) -> str:
    """Returns JSON string for the assistant message tool channel."""

    args = raw_args or {}

    if tool_name == "search_database":
        limit = int(args.get("limit") or 10)
        props = await crud.search_properties(
            db,
            city=args.get("city"),
            country=args.get("country"),
            property_type=args.get("property_type"),
            min_bedrooms=args.get("min_bedrooms"),
            max_bedrooms=args.get("max_bedrooms"),
            min_price=args.get("min_price"),
            max_price=args.get("max_price"),
            locality=args.get("locality"),
            category=args.get("category"),
            agency_name=args.get("agency_name"),
            limit=limit,
        )
        agencies = await crud.search_agencies(
            db,
            city=args.get("city"),
            country=args.get("country"),
            limit=min(limit, 25),
        )
        payload = {
            "properties_found": len(props),
            "properties": [
                {
                    "title": p.title,
                    "property_type": p.property_type,
                    "bedrooms": p.bedrooms,
                    "bathrooms": p.bathroom_count,
                    "total_sqm": p.total_sqm,
                    "price": p.price,
                    "price_per_sqm": p.price_per_sqm,
                    "currency": p.currency,
                    "locality": p.locality,
                    "city": p.city,
                    "images": list(p.images or [])[:8] if p.images else [],
                    "listing_url": p.listing_url,
                    "agency_id": str(p.agency_id) if p.agency_id else None,
                }
                for p in props
            ],
            "agencies_found": len(agencies),
            "agencies": [
                {
                    "name": a.name,
                    "owner_name": a.owner_name,
                    "phone": list(a.phone or [])[:5],
                    "email": list(a.email or [])[:5],
                    "city": a.city,
                    "rating": a.google_rating,
                    "website_url": a.website_url,
                }
                for a in agencies
            ],
        }
        return json.dumps(payload, default=str)

    if tool_name == "scrape_city":
        from backend.routers.scraper import _build_agency_row, _build_property_row, _coerce_str_list

        city = str(args.get("city") or "").strip()
        country = str(args.get("country") or "").strip()
        max_agencies = int(args.get("max_agencies") or 5)
        max_agencies = max(1, min(max_agencies, 12))

        loop = asyncio.get_running_loop()
        raw_agencies: list[dict] = await loop.run_in_executor(
            None,
            functools.partial(discover_agencies_sync, city, country),
        )
        agencies = raw_agencies[:max_agencies]

        engine = ScraperEngine()
        mp = MultiPageScraper(engine)
        saved_count = 0
        properties_count = 0

        for item in agencies:
            url = (item.get("website_url") or item.get("website") or "").strip()
            if not url:
                continue
            try:
                bundle = await mp.scrape_agency_complete(url)
                if not bundle.get("success"):
                    continue
                extracted = await extract_from_multipage(bundle, url)
                props_list = [p for p in (extracted.get("properties") or []) if isinstance(p, dict)]

                cats: set[str] = set(_coerce_str_list(extracted.get("property_categories")))
                for p in props_list:
                    for key in ("category", "property_type"):
                        v = p.get(key)
                        if v:
                            cats.add(str(v).strip())

                agency_row = _build_agency_row(
                    item,
                    extracted,
                    city,
                    country,
                    bundle.get("max_level") or 1,
                )
                agency_row["total_listings"] = len(props_list)
                agency_row["property_categories"] = sorted(cats) if cats else None
                agency = await crud.upsert_agency(db, agency_row)
                saved_count += 1

                for prop in props_list:
                    await crud.create_property(db, _build_property_row(prop, agency.id, city, country))
                    properties_count += 1

                try:
                    from backend.queue.redis_queue import mark_url_scraped

                    await mark_url_scraped(url)
                except Exception:
                    pass

                await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("scrape_city failed for %s: %s", url, exc)

        return json.dumps(
            {
                "action": "scraped_agency_websites",
                "explanation": f"Visited {saved_count} agency websites directly in {city}, {country}",
                "agencies_scraped": saved_count,
                "properties_found": properties_count,
                "city": city,
                "country": country,
                "note": "Data extracted directly from agency websites",
            }
        )

    if tool_name == "web_search":
        query = args.get("query", "")

        # Try Tavily first (if API key set)
        tavily_key = getattr(settings, "tavily_api_key", "")

        if tavily_key and tavily_key.startswith("tvly-"):
            try:
                from tavily import TavilyClient

                tavily = TavilyClient(api_key=tavily_key)
                results = tavily.search(
                    query=query,
                    max_results=5,
                    include_answer=True
                )
                return json.dumps({
                    "answer": results.get("answer", ""),
                    "results": [
                        {
                            "title": r.get("title", ""),
                            "snippet": r.get("content", ""),
                            "url": r.get("url", "")
                        }
                        for r in results.get("results", [])
                    ],
                    "source": "tavily"
                })
            except Exception as e:
                print(f"Tavily failed: {e}")

        # Fallback: DuckDuckGo
        try:
            from duckduckgo_search import DDGS

            with DDGS() as ddgs:
                results = list(ddgs.text(
                    query,
                    max_results=5,
                    safesearch="off"
                ))
            return json.dumps({
                "results": [
                    {
                        "title": r.get("title", ""),
                        "snippet": r.get("body", ""),
                        "url": r.get("href", "")
                    }
                    for r in results
                ],
                "source": "duckduckgo"
            })
        except Exception as e:
            print(f"DuckDuckGo failed: {e}")
            return json.dumps({
                "results": [],
                "error": str(e)
            })

    if tool_name == "get_pricing_analysis":
        data = await crud.get_pricing_data(
            db,
            city=args.get("city"),
            country=args.get("country"),
            property_type=args.get("property_type"),
        )
        return json.dumps(data, default=str)

    if tool_name == "get_agency_detail":
        name = str(args.get("agency_name") or "").strip()
        city_hint = args.get("city")
        agency = await crud.get_agency_by_name(db, name)
        if agency and city_hint:
            ac = (agency.city or "").lower()
            if ac and city_hint.lower() not in ac:
                agency = await crud.get_agency_by_name(db, f"{name} {city_hint}") or agency

        if not agency:
            return json.dumps({"found": False})

        props = await crud.get_agency_properties(db, agency.id)
        return json.dumps(
            {
                "found": True,
                "agency": {
                    "name": agency.name,
                    "owner_name": agency.owner_name,
                    "email": list(agency.email or [])[:6],
                    "phone": list(agency.phone or [])[:6],
                    "whatsapp": agency.whatsapp,
                    "facebook_url": agency.facebook_url,
                    "instagram_url": agency.instagram_url,
                    "google_rating": agency.google_rating,
                    "specialization": agency.specialization,
                    "website_url": agency.website_url,
                    "city": agency.city,
                    "country": agency.country,
                },
                "total_properties": len(props),
                "properties": [
                    {
                        "title": p.title,
                        "price": p.price,
                        "bedrooms": p.bedrooms,
                        "total_sqm": p.total_sqm,
                        "locality": p.locality,
                    }
                    for p in props[:40]
                ],
            },
            default=str,
        )

    if tool_name == "get_area_pricing":
        locality = str(args.get("locality") or "").strip()
        city = str(args.get("city") or "").strip()
        if not locality:
            return json.dumps({"error": "locality is required"})
        db_pricing = await crud.get_locality_pricing(db, locality)
        market_context = ""
        sources: list[str] = []
        try:
            from tavily import TavilyClient

            tavily = TavilyClient(api_key=settings.tavily_api_key)
            web_results = tavily.search(
                query=f"average property price per sqm {locality} {city} real estate 2024 2025",
                max_results=3,
            )
            market_context = web_results.get("answer", "")
            sources = [r.get("url") for r in web_results.get("results", []) if r.get("url")]
        except Exception:
            pass
        return json.dumps(
            {
                "locality": locality,
                "database_data": db_pricing,
                "avg_price_per_sqm": db_pricing.get("avg_price_per_sqm"),
                "total_listings": db_pricing.get("count"),
                "price_range": {
                    "min": db_pricing.get("min_price"),
                    "max": db_pricing.get("max_price"),
                },
                "market_context": market_context,
                "sources": sources,
            },
            default=str,
        )

    if tool_name == "compare_properties":
        properties = []
        for pid in args.get("property_ids", []) or []:
            prop = await crud.get_property_by_id(db, str(pid))
            if prop:
                properties.append(
                    {
                        "id": str(prop.id),
                        "title": prop.title,
                        "price": prop.price,
                        "total_sqm": prop.total_sqm,
                        "price_per_sqm": prop.price_per_sqm,
                        "bedrooms": prop.bedrooms,
                        "locality": prop.locality,
                        "property_type": prop.property_type,
                        "category": prop.category,
                        "city": prop.city,
                        "country": prop.country,
                    }
                )

        if len(properties) < 2:
            return json.dumps({"error": "Need at least 2 property IDs to compare"})

        compare_prompt = f"""
Compare these {len(properties)} properties and return JSON:
{{
  "comparison_table": [
    {{"criteria": "Price", "values": [...per property]}},
    {{"criteria": "Size (sqm)", "values": [...]}},
    {{"criteria": "Price per sqm", "values": [...]}},
    {{"criteria": "Bedrooms", "values": [...]}},
    {{"criteria": "Location", "values": [...]}},
    {{"criteria": "Type", "values": [...]}}
  ],
  "pros_cons": [
    {{"property": "title", "pros": [...], "cons": [...]}}
  ],
  "recommendation": "Which one and why in 2 sentences",
  "best_for_investment": "property title",
  "best_for_living": "property title",
  "best_value": "property title"
}}

Properties: {json.dumps(properties, default=str)}
"""
        try:
            response = await _llm_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": compare_prompt}],
                max_tokens=1500,
            )
            content = (response.choices[0].message.content or "").strip()
            return json.dumps(json.loads(content))
        except Exception as exc:
            return json.dumps(
                {
                    "error": str(exc),
                    "properties": properties,
                    "recommendation": "Unable to generate AI comparison right now.",
                }
            )

    return json.dumps({"error": f"unknown tool {tool_name}"})
