"""
ARIA tools for OpenAI Agents SDK.
All tools call Stagehand (Browserbase) for real-time web scraping.
No database lookups — everything is live.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from agents import RunContextWrapper, function_tool
from sqlalchemy.ext.asyncio import AsyncSession

from backend.ai.aria_prompts import TOOL_STATUS_LABELS
from backend.ai.aria_tool_runner import execute_aria_tool

logger = logging.getLogger(__name__)


@dataclass
class AriaRunContext:
    """Per-request state passed into Agents SDK Runner.run(..., context=...)."""
    db: AsyncSession                            # still needed for chat history
    tool_trace: list[dict[str, str]] = field(default_factory=list)
    last_properties: list[dict] = field(default_factory=list)   # for compare
    last_compare_result: dict = field(default_factory=dict)     # structured compare JSON
    last_compare_properties: list[dict] = field(default_factory=list)  # the two compared props


def _trace(ctx: RunContextWrapper[AriaRunContext], tool_name: str) -> None:
    ctx.context.tool_trace.append(
        {"tool": tool_name, "label": TOOL_STATUS_LABELS.get(tool_name, f"⚙️ {tool_name}")}
    )


# ── Tool 1: live_search_properties ────────────────────────────────────────

@function_tool
async def live_search_properties(
    ctx: RunContextWrapper[AriaRunContext],
    city: str,
    country: str,
    property_type: str | None = None,
    category: str | None = None,
    max_agencies: int | None = None,
) -> str:
    """
    Browse real estate agency websites LIVE and return current property listings.
    Use this whenever the user asks to find properties in any city or country
    AND they have NOT provided a specific website URL.
    Scrapes the FIRST found agency only, then shows results and asks the user:
    (1) More from this site (2) Next agency (3) Give me your own URL.
    If user provides their own URL, use scrape_website instead.
    Returns real-time data scraped directly from agency websites.
    """
    _trace(ctx, "live_search_properties")
    args: dict[str, Any] = {"city": city, "country": country}
    if property_type:
        args["property_type"] = property_type
    if category:
        args["category"] = category
    if max_agencies:
        args["max_agencies"] = max_agencies

    result = await execute_aria_tool("live_search_properties", args)

    # Store FULL properties (with images) for frontend display
    # Strip base64 from what goes back to LLM (too large, causes token issues)
    try:
        parsed = json.loads(result)
        if isinstance(parsed.get("properties"), list):
            all_props = parsed["properties"]
            ctx.context.last_properties = all_props
            llm_props = []
            for p in all_props[:5]:
                lp = {k: v for k, v in p.items() if k != "images"}
                imgs = [u for u in (p.get("images") or []) if isinstance(u, str) and u.startswith("http")]
                lp["images_count"] = len(p.get("images") or [])
                if imgs:
                    lp["sample_image_url"] = imgs[0]
                llm_props.append(lp)
            parsed["properties"] = llm_props
            parsed["total_found"] = len(all_props)
            parsed["showing"] = len(llm_props)
            parsed["_instruction"] = (
                f"Show these {len(llm_props)} properties to the user. "
                "STOP. Do NOT compare them. Do NOT call compare_properties. "
                "End with the 3 navigation options (same site / next site / specific URL)."
            )
            result = json.dumps(parsed)
    except Exception:
        pass

    return result


# ── Tool 2: find_agencies ─────────────────────────────────────────────────

@function_tool
async def find_agencies(
    ctx: RunContextWrapper[AriaRunContext],
    city: str,
    country: str,
    source: str | None = None,
) -> str:
    """
    Discover real estate websites for a given city and country.
    - source="agency" (default): returns professional real estate agency websites.
    - source="owner": returns classified/marketplace sites where owners list directly
      (e.g. OLX, Facebook Marketplace, Malta Park, Craigslist, local classifieds).
    - source="both": returns both agency and owner/classified sites.
    Call this FIRST when a user asks to search properties by city/country — BEFORE scraping.
    Returns a numbered list of websites so you can present them to the user,
    then ask ONE combined clarifying question (locality, rent/sale, budget, property type,
    bedrooms, bathrooms, must-haves, agency or owner) before scraping with scrape_website.
    """
    _trace(ctx, "find_agencies")
    args: dict[str, Any] = {"city": city, "country": country}
    if source:
        args["source"] = source
    return await execute_aria_tool("find_agencies", args)


# ── Tool 3: scrape_website ─────────────────────────────────────────────────

@function_tool
async def scrape_website(
    ctx: RunContextWrapper[AriaRunContext],
    url: str,
    city: str | None = None,
    country: str | None = None,
    locality: str | None = None,
    property_type: str | None = None,
    category: str | None = None,
    bedrooms: int | None = None,
    bathrooms: int | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    amenities: list[str] | None = None,
    furnished: str | None = None,
    min_total_sqm: float | None = None,
    min_internal_sqm: float | None = None,
    min_external_sqm: float | None = None,
    floor_number: int | None = None,
    free_text_prefs: list[str] | None = None,
) -> str:
    """
    Visit a specific real estate agency website URL and extract property listings.
    Use AFTER find_agencies showed the agency list and user answered preferences.
    - url: agency website URL (from the find_agencies numbered list)
    - city: overall city or country (e.g. "Malta", "Dubai")
    - locality: specific neighbourhood or suburb WITHIN the city (e.g. "Sliema", "Gzira", "JBR")
      IMPORTANT: Always pass locality separately when the user specifies one.
    - property_type: apartment, villa, penthouse, bungalow, townhouse, studio, etc.
    - category: "sale" or "rent"
    - bedrooms: number of bedrooms requested (pass when user specified)
    - bathrooms: number of bathrooms requested (pass when user specified)
    - min_price / max_price: OMIT entirely if user said "no budget", "no limit", or "flexible"
    - amenities: list of must-have features e.g. ["pool", "garage", "sea view", "gym", "balcony"]
    - furnished: "yes" if user wants furnished, "no" if unfurnished, omit if not specified
    - min_total_sqm: minimum total area in m² (pass when user specifies size like "at least 100sqm")
    - min_internal_sqm: minimum indoor area in m²
    - min_external_sqm: minimum outdoor/garden/terrace area in m²
    - floor_number: specific floor requested (0 = ground floor)
    - free_text_prefs: any other user preferences as plain text phrases
      e.g. ["near school", "pet friendly", "mountain view", "newly built", "quiet area"]
      These are soft-matched against property descriptions. Pass ALL user preferences
      that don't fit the structured fields above.
    Returns up to 5 real-time listings. Always attribute which agency they came from.
    """
    _trace(ctx, "scrape_website")
    args: dict[str, Any] = {"url": url}
    if city:
        args["city"] = city
    if country:
        args["country"] = country
    if locality:
        args["locality"] = locality
    if property_type:
        args["property_type"] = property_type
    if category:
        args["category"] = category
    if bedrooms is not None:
        args["bedrooms"] = bedrooms
    if bathrooms is not None:
        args["bathrooms"] = bathrooms
    if min_price is not None:
        args["min_price"] = min_price
    if max_price is not None:
        args["max_price"] = max_price
    if amenities:
        args["amenities"] = amenities
    if furnished:
        args["furnished"] = furnished
    if min_total_sqm is not None:
        args["min_total_sqm"] = min_total_sqm
    if min_internal_sqm is not None:
        args["min_internal_sqm"] = min_internal_sqm
    if min_external_sqm is not None:
        args["min_external_sqm"] = min_external_sqm
    if floor_number is not None:
        args["floor_number"] = floor_number
    if free_text_prefs:
        args["free_text_prefs"] = free_text_prefs

    result = await execute_aria_tool("scrape_website", args)

    try:
        parsed = json.loads(result)
        if isinstance(parsed.get("properties"), list):
            all_props = parsed["properties"]
            # Store ALL for frontend cards — frontend may show up to 12
            ctx.context.last_properties = all_props
            # Give LLM only up to 5 (prevent it from seeing 2 and "comparing" them)
            llm_props = []
            for p in all_props[:5]:
                lp = {k: v for k, v in p.items() if k != "images"}
                imgs = [u for u in (p.get("images") or []) if isinstance(u, str) and u.startswith("http")]
                lp["images_count"] = len(p.get("images") or [])
                if imgs:
                    lp["sample_image_url"] = imgs[0]
                llm_props.append(lp)
            parsed["properties"] = llm_props
            parsed["total_found"] = len(all_props)
            parsed["showing"] = len(llm_props)
            # Append strict instruction so ARIA never auto-compares
            parsed["_instruction"] = (
                f"Show these {len(llm_props)} properties to the user. "
                "STOP. Do NOT compare them. Do NOT call compare_properties. "
                "End with the 3 navigation options (same site / next site / specific URL)."
            )
            result = json.dumps(parsed)
    except Exception:
        pass

    return result


# ── Tool 4: web_search ─────────────────────────────────────────────────────

@function_tool
async def web_search(
    ctx: RunContextWrapper[AriaRunContext],
    query: str,
) -> str:
    """
    Search the web for real estate market information, news, investment trends,
    area details, pricing context. Use for market intelligence — NOT for listings.
    """
    _trace(ctx, "web_search")
    return await execute_aria_tool("web_search", {"query": query})


# ── Tool 5: compare_properties ─────────────────────────────────────────────

@function_tool
async def compare_properties(
    ctx: RunContextWrapper[AriaRunContext],
    criteria: str | None = None,
    property_a: str | None = None,
    property_b: str | None = None,
    property_c: str | None = None,
    property_d: str | None = None,
) -> str:
    """
    Compare properties side by side with pros/cons and a recommendation.

    ALWAYS use property_a / property_b (/ property_c / property_d) to pass explicit property data.
    Pass them as JSON strings like:
      '{"title":"Apartment Sliema","price":1300000,"currency":"EUR","listing_url":"https://..."}'

    NEVER silently fall back to session history (last_properties) unless the user explicitly said
    "compare the ones you just found" or "compare those" (referring to results from THIS turn).
    If the user named specific properties in their message, extract and pass them here directly.
    """
    _trace(ctx, "compare_properties")

    # Build explicit list from named args if provided
    explicit: list[dict] = []
    for raw in [property_a, property_b, property_c, property_d]:
        if raw:
            try:
                obj = json.loads(raw) if raw.strip().startswith("{") else {"title": raw}
                explicit.append(obj)
            except Exception:
                explicit.append({"title": raw})

    props_to_compare = explicit if len(explicit) >= 2 else ctx.context.last_properties[:4]

    if len(props_to_compare) < 2:
        return json.dumps({
            "error": "I need at least 2 properties to compare. Please describe each property or ask me to search first."
        })

    result_str = await execute_aria_tool("compare_properties", {
        "properties": props_to_compare,
        "criteria": criteria or "price, size, location, investment value",
    })

    # Store compare result + the compared properties so the frontend can render
    # the structured CompareBlock and show both property cards
    try:
        result_json = json.loads(result_str)
        ctx.context.last_compare_result = result_json
        ctx.context.last_compare_properties = props_to_compare
    except Exception:
        pass

    return result_str


# ── Tool 6: market_insights ────────────────────────────────────────────────

@function_tool
async def market_insights(
    ctx: RunContextWrapper[AriaRunContext],
    city: str | None = None,
    country: str | None = None,
    property_type: str | None = None,
    aspect: str | None = None,
) -> str:
    """
    Get real-time market intelligence: average prices, investment outlook,
    rental yields, price trends, best areas. Use for investment advice and
    market analysis questions.
    """
    _trace(ctx, "market_insights")
    args: dict[str, Any] = {}
    if city:
        args["city"] = city
    if country:
        args["country"] = country
    if property_type:
        args["property_type"] = property_type
    if aspect:
        args["aspect"] = aspect
    return await execute_aria_tool("market_insights", args)


# ── Tool 7: investment_calculator ────────────────────────────────────────

@function_tool
async def investment_calculator(
    ctx: RunContextWrapper[AriaRunContext],
    property_price: float,
    monthly_rent: float,
    currency: str = "EUR",
    annual_expenses: float = 0.0,
    mortgage_rate_pct: float = 0.0,
    down_payment_pct: float = 100.0,
    property_size_sqm: float = 0.0,
) -> str:
    """
    Calculate investment metrics for a property — purely mathematical, no API needed.
    Use when user asks about ROI, rental yield, investment return, cashflow,
    'is this a good investment?', 'what is the yield?', or any investment math.

    - property_price: total purchase price
    - monthly_rent: expected monthly rental income
    - currency: EUR, USD, AED, PKR, GBP, etc.
    - annual_expenses: yearly costs (maintenance, service charge, insurance, management fees)
    - mortgage_rate_pct: annual mortgage interest rate (0 = cash purchase)
    - down_payment_pct: % of price paid upfront (100 = full cash purchase, no mortgage)
    - property_size_sqm: property size in m² (used to compute price/sqm)
    """
    _trace(ctx, "investment_calculator")

    try:
        annual_rent = monthly_rent * 12
        gross_yield = (annual_rent / property_price * 100) if property_price > 0 else 0

        net_annual_income = annual_rent - annual_expenses
        net_yield = (net_annual_income / property_price * 100) if property_price > 0 else 0
        cap_rate = net_yield  # unlevered cap rate

        # Mortgage (if financed)
        down_payment = property_price * (down_payment_pct / 100)
        loan_amount = property_price - down_payment
        monthly_mortgage = 0.0
        if loan_amount > 0 and mortgage_rate_pct > 0:
            r = (mortgage_rate_pct / 100) / 12
            n = 25 * 12  # 25-year term
            monthly_mortgage = loan_amount * (r * (1 + r) ** n) / ((1 + r) ** n - 1)

        monthly_cashflow = monthly_rent - monthly_mortgage - (annual_expenses / 12)
        annual_cashflow = monthly_cashflow * 12

        cash_deployed = down_payment if down_payment > 0 else property_price
        roi = (annual_cashflow / cash_deployed * 100) if cash_deployed > 0 else 0

        payback_years = (property_price / net_annual_income) if net_annual_income > 0 else None
        price_per_sqm = (property_price / property_size_sqm) if property_size_sqm > 0 else None

        if gross_yield >= 8:
            rating = "🟢 Excellent"
        elif gross_yield >= 6:
            rating = "🟡 Good"
        elif gross_yield >= 4:
            rating = "🟠 Moderate"
        else:
            rating = "🔴 Low yield"

        result: dict[str, Any] = {
            "status": "success",
            "currency": currency,
            "property_price": property_price,
            "monthly_rent": monthly_rent,
            "gross_yield_pct": round(gross_yield, 2),
            "net_yield_pct": round(net_yield, 2),
            "cap_rate_pct": round(cap_rate, 2),
            "monthly_cashflow": round(monthly_cashflow, 2),
            "annual_cashflow": round(annual_cashflow, 2),
            "roi_pct": round(roi, 2),
            "payback_years": round(payback_years, 1) if payback_years else None,
            "monthly_mortgage": round(monthly_mortgage, 2),
            "down_payment": round(down_payment, 2),
            "investment_rating": rating,
            "price_per_sqm": round(price_per_sqm, 0) if price_per_sqm else None,
            "summary": (
                f"Property: {currency} {property_price:,.0f} | "
                f"Rent: {currency} {monthly_rent:,.0f}/mo | "
                f"Gross yield: {gross_yield:.1f}% | Net yield: {net_yield:.1f}% | "
                f"Monthly cashflow: {currency} {monthly_cashflow:,.0f} | "
                f"Rating: {rating}"
            ),
        }
        return json.dumps(result)

    except Exception as exc:
        logger.error("investment_calculator error: %s", exc)
        return json.dumps({"error": f"Calculation failed: {exc}"})


# ── Tool 8: currency_converter ────────────────────────────────────────────

# Indicative rates vs EUR (no live API — update periodically)
_RATES_VS_EUR: dict[str, float] = {
    "EUR": 1.0,    "USD": 1.08,   "GBP": 0.86,
    "AED": 3.97,   "SAR": 4.05,   "QAR": 3.94,
    "KWD": 0.33,   "BHD": 0.41,   "OMR": 0.42,
    "PKR": 300.0,  "INR": 89.5,   "BDT": 118.0,
    "TRY": 35.0,   "EGP": 52.0,   "MAD": 10.7,
    "CAD": 1.47,   "AUD": 1.63,   "SGD": 1.45,
    "MYR": 4.95,   "JOD": 0.77,   "LBP": 96500.0,
}


@function_tool
async def currency_converter(
    ctx: RunContextWrapper[AriaRunContext],
    amount: float,
    from_currency: str,
    to_currency: str,
) -> str:
    """
    Convert a property price between currencies (EUR, USD, GBP, AED, PKR, SAR, INR, TRY, EGP, etc.).
    Use when user asks 'what is this in PKR?', 'convert to USD', 'show me in rupees/dirhams/dollars'.
    Uses indicative exchange rates (good for property research, not for live trading).
    """
    _trace(ctx, "currency_converter")

    fc = from_currency.upper().strip()
    tc = to_currency.upper().strip()

    supported = ", ".join(sorted(_RATES_VS_EUR.keys()))
    if fc not in _RATES_VS_EUR:
        return json.dumps({"error": f"Currency '{fc}' not supported. Supported: {supported}"})
    if tc not in _RATES_VS_EUR:
        return json.dumps({"error": f"Currency '{tc}' not supported. Supported: {supported}"})

    amount_in_eur = amount / _RATES_VS_EUR[fc]
    converted = amount_in_eur * _RATES_VS_EUR[tc]
    rate = _RATES_VS_EUR[tc] / _RATES_VS_EUR[fc]

    return json.dumps({
        "status": "success",
        "original_amount": amount,
        "from_currency": fc,
        "converted_amount": round(converted, 2),
        "to_currency": tc,
        "exchange_rate": round(rate, 4),
        "note": "Indicative rates — approximate, for property research only",
        "summary": f"{fc} {amount:,.0f}  ≈  {tc} {converted:,.0f}  (1 {fc} = {rate:.4f} {tc})",
    })


# ── Tool 9: get_property_details ──────────────────────────────────────────

@function_tool
async def get_property_details(
    ctx: RunContextWrapper[AriaRunContext],
    agency_website: str,
    property_title: str,
    property_price: str | None = None,
    property_city: str | None = None,
) -> str:
    """
    Get COMPLETE details of a specific property: full description, all room dimensions,
    all home features (AC, lift, pool, balconies, etc.), images, and the individual
    agent contact (name, phone, WhatsApp, email).
    Use this when the user asks for more details on a specific property they've already seen.
    Requires the agency website URL and property title.
    """
    _trace(ctx, "get_property_details")
    result = await execute_aria_tool("get_property_details", {
        "agency_url": agency_website,
        "property_title": property_title,
        "property_price": property_price,
        "property_city": property_city or "",
    })

    # APPEND to context (not replace) so compare gets data from both detail calls
    try:
        parsed = json.loads(result)
        if parsed.get("status") == "success":
            agent_info = parsed.get("agent", {})
            agency_info = parsed.get("agency", {})
            new_prop = {
                "title":          parsed.get("title", property_title),
                "price":          parsed.get("price"),
                "currency":       parsed.get("currency", "EUR"),
                "category":       "sale",
                "bedrooms":       parsed.get("bedrooms"),
                "bathrooms":      parsed.get("bathrooms"),
                "total_sqm":      parsed.get("total_sqm"),
                "floor_number":   parsed.get("floor_number"),
                "locality":       parsed.get("locality", ""),
                "city":           parsed.get("locality", ""),
                "full_address":   parsed.get("full_address", ""),
                "description":    parsed.get("description", ""),
                "listing_url":    parsed.get("listing_url", ""),
                "images":               (parsed.get("images") or [])[:10],
                "page_screenshot":      parsed.get("page_screenshot", ""),
                "carousel_screenshots": (parsed.get("carousel_screenshots") or [])[:8],
                "amenities":      (parsed.get("features") or [])[:15],
                "furnished":      parsed.get("furnished", ""),
                "agency_name":    agency_info.get("name", ""),
                "agent_name":     agent_info.get("name", ""),
                "agent_title":    agent_info.get("title", ""),
                "agent_phone":    agent_info.get("phone", ""),
                "agent_whatsapp": agent_info.get("whatsapp", ""),
                "agent_email":    agent_info.get("email", ""),
            }
            # Keep existing properties + add this one (for multi-detail compare flows)
            existing = [p for p in ctx.context.last_properties if p.get("title") != new_prop["title"]]
            ctx.context.last_properties = existing + [new_prop]
    except Exception:
        pass

    return result


# ── Export ─────────────────────────────────────────────────────────────────

ARIA_SDK_TOOLS = [
    find_agencies,
    live_search_properties,
    scrape_website,
    web_search,
    compare_properties,
    market_insights,
    investment_calculator,
    currency_converter,
    get_property_details,
]
