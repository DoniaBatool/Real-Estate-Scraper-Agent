import asyncio
import functools
import logging
import uuid
from datetime import date

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from backend.database.connection import _get_engine
from backend.database import crud
from backend.discovery.apify_client import discover_agencies_sync
from backend.scraper.engine import MultiPageScraper, ScraperEngine
from backend.ai.extractor import extract_from_multipage
from backend.queue.redis_queue import (
    is_url_scraped,
    mark_url_scraped,
    set_job_status,
    get_job_status as redis_get_job,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/scrape", tags=["scraper"])

# In-memory fallback when Redis is unavailable
_jobs: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    city: str
    country: str


class ScrapeStatus(BaseModel):
    job_id: str
    status: str
    city: str
    country: str
    agencies_found: int = 0
    agencies_scraped: int = 0
    message: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _update_job(job_id: str, **kwargs) -> None:
    _jobs.setdefault(job_id, {}).update(kwargs)
    try:
        current = await redis_get_job(job_id) or {}
        current.update(kwargs)
        await set_job_status(job_id, current)
    except Exception:
        pass  # Redis optional; in-memory already updated


def _coerce_str_list(val) -> list[str]:
    if not val:
        return []
    if isinstance(val, str):
        return [s.strip() for s in val.replace(";", ",").split(",") if s.strip()]
    return [str(x).strip() for x in val if x and str(x).strip()]


def _build_agency_row(apify_item: dict, extracted: dict, city: str, country: str, level: int) -> dict:
    def _to_list(val) -> list[str] | None:
        if not val:
            return None
        if isinstance(val, list):
            return [str(v) for v in val if v]
        return [s.strip() for s in str(val).split(",") if s.strip()] or None

    apify_phones = _to_list(apify_item.get("phone"))
    ai_phones = _to_list(extracted.get("phone"))

    founded = extracted.get("founded_year")
    if isinstance(founded, str):
        try:
            founded = int(founded)
        except ValueError:
            founded = None

    return {
        "name": extracted.get("agency_name") or apify_item.get("name") or "Unknown",
        "website_url": apify_item["website_url"],
        "owner_name": extracted.get("owner_name"),
        "founded_year": founded,
        "description": extracted.get("description"),
        "logo_url": extracted.get("logo_url"),
        "email": _to_list(extracted.get("email")),
        "phone": ai_phones or apify_phones,
        "whatsapp": extracted.get("whatsapp"),
        "facebook_url": extracted.get("facebook_url"),
        "instagram_url": extracted.get("instagram_url"),
        "linkedin_url": extracted.get("linkedin_url"),
        "twitter_url": extracted.get("twitter_url"),
        "google_rating": apify_item.get("google_rating") or extracted.get("google_rating"),
        "review_count": apify_item.get("review_count") or extracted.get("review_count"),
        "specialization": extracted.get("specialization"),
        "price_range_min": extracted.get("price_range_min"),
        "price_range_max": extracted.get("price_range_max"),
        "currency": extracted.get("currency") or "EUR",
        "city": city,
        "country": country,
        "scrape_level": level,
        "scrape_status": "done",
    }


def _opt_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _opt_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _furnished_text(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return "true" if val else "false"
    s = str(val).strip()
    return s or None


def _build_property_row(prop: dict, agency_id, city: str, country: str) -> dict:
    listing_date = None
    raw_date = prop.get("listing_date")
    if raw_date:
        try:
            listing_date = date.fromisoformat(str(raw_date)[:10])
        except (ValueError, TypeError):
            pass

    images = prop.get("images") or []
    if isinstance(images, str):
        images = [images]

    amenities = prop.get("amenities") or []
    if isinstance(amenities, str):
        amenities = [a.strip() for a in amenities.split(",") if a.strip()]
    features = prop.get("features") or []
    if isinstance(features, str):
        features = [features]
    if isinstance(features, list):
        amenities = [*amenities, *[str(x).strip() for x in features if x]]
    amenities = list(dict.fromkeys([a for a in amenities if a]))[:80] or None

    raw_desc = prop.get("description")
    meta_lines: list[str] = []
    for k in ("price_type",):
        v = prop.get(k)
        if v is not None and str(v).strip():
            meta_lines.append(f"{k}: {v}")
    description = raw_desc
    if meta_lines:
        suffix = "\n\n" + "\n".join(meta_lines)
        description = ((raw_desc or "") + suffix).strip()[:12000]

    price = prop.get("price")
    total_sqm = prop.get("total_sqm")
    price_per_sqm = prop.get("price_per_sqm")
    if price and total_sqm and not price_per_sqm and total_sqm > 0:
        price_per_sqm = round(float(price) / float(total_sqm), 2)

    baths = prop.get("bathrooms")
    if baths is None:
        baths = prop.get("bathroom_count")

    listing_reference = prop.get("listing_reference") or prop.get("reference")
    virtual_tour_url = prop.get("virtual_tour_url") or prop.get("virtual_tour")
    floor_raw = prop.get("floor_number")
    if floor_raw is None:
        floor_raw = prop.get("floor")

    return {
        "agency_id": agency_id,
        "title": prop.get("title"),
        "property_type": prop.get("property_type"),
        "category": prop.get("category"),
        "description": description,
        "images": images or None,
        "bedrooms": prop.get("bedrooms"),
        "bathroom_count": baths,
        "bedroom_sqm": prop.get("bedroom_sqm"),
        "bathroom_sqm": prop.get("bathroom_sqm"),
        "total_sqm": total_sqm,
        "plot_sqm": _opt_float(prop.get("plot_sqm")),
        "furnished": _furnished_text(prop.get("furnished")),
        "floor_number": _opt_int(floor_raw),
        "total_floors": _opt_int(prop.get("total_floors")),
        "year_built": _opt_int(prop.get("year_built")),
        "condition": prop.get("condition"),
        "energy_rating": prop.get("energy_rating"),
        "virtual_tour_url": virtual_tour_url,
        "listing_reference": listing_reference,
        "full_address": prop.get("full_address"),
        "price": price,
        "price_per_sqm": price_per_sqm,
        "currency": prop.get("currency") or "EUR",
        "locality": prop.get("locality"),
        "district": prop.get("district"),
        "city": prop.get("city") or city,
        "country": prop.get("country") or country,
        "latitude": prop.get("latitude"),
        "longitude": prop.get("longitude"),
        "listing_date": listing_date,
        "amenities": amenities,
        "listing_url": prop.get("listing_url"),
    }


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------

async def _run_pipeline(job_id: str, city: str, country: str) -> None:
    engine = ScraperEngine()
    multipage = MultiPageScraper(engine)
    await _update_job(job_id, status="running", message="Discovering agencies via Apify…")

    # Step 1 — Discover (apify_client SDK is synchronous, run in thread pool)
    try:
        loop = asyncio.get_running_loop()
        agencies: list[dict] = await loop.run_in_executor(
            None, functools.partial(discover_agencies_sync, city, country)
        )
    except Exception as exc:
        logger.error("Agency discovery error: %s", exc)
        agencies = []

    await _update_job(
        job_id,
        agencies_found=len(agencies),
        message=f"Found {len(agencies)} agencies — scraping websites…",
    )

    scraped_count = 0

    _, session_factory = _get_engine()
    async with session_factory() as db:
        for item in agencies:
            url = item.get("website_url", "")
            if not url:
                continue

            # Redis dedup — skip URLs scraped in the last 7 days
            if await is_url_scraped(url):
                logger.info("Skipping already-scraped: %s", url)
                continue

            # Step 2–3 — Multi-page crawl (homepage + listings index + property detail pages) + AI extraction
            bundle = await multipage.scrape_agency_complete(url)
            if not bundle.get("success") or not bundle.get("homepage_html"):
                logger.warning("Multi-page scrape failed for %s", url)
                continue

            extracted = await extract_from_multipage(bundle, url)

            props_merged = [p for p in (extracted.get("properties") or []) if isinstance(p, dict)]

            cats: set[str] = set(_coerce_str_list(extracted.get("property_categories")))
            for p in props_merged:
                for key in ("category", "property_type"):
                    v = p.get(key)
                    if v:
                        cats.add(str(v).strip())

            # Step 4 — Persist to Supabase
            try:
                agency_row = _build_agency_row(item, extracted, city, country, bundle.get("max_level") or 1)
                agency_row["total_listings"] = len(props_merged)
                agency_row["property_categories"] = sorted(cats) if cats else None
                agency = await crud.upsert_agency(db, agency_row)

                for prop in props_merged:
                    await crud.create_property(db, _build_property_row(prop, agency.id, city, country))

                await mark_url_scraped(url)
                scraped_count += 1
                await _update_job(
                    job_id,
                    agencies_scraped=scraped_count,
                    message=f"Scraped {scraped_count}/{len(agencies)}: {agency.name}",
                )
            except Exception as exc:
                logger.error("DB save failed for %s: %s", url, exc)

    await _update_job(
        job_id,
        status="complete",
        agencies_scraped=scraped_count,
        message=f"Complete — {scraped_count} agencies saved to database",
    )


async def enqueue_scrape_job(city: str, country: str, background_tasks: BackgroundTasks) -> dict:
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "status": "queued",
        "city": city,
        "country": country,
        "agencies_found": 0,
        "agencies_scraped": 0,
        "message": "Job queued",
    }
    _jobs[job_id] = job
    try:
        await set_job_status(job_id, job)
    except Exception:
        pass

    background_tasks.add_task(_run_pipeline, job_id, city, country)
    return job


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=ScrapeStatus, status_code=202)
async def start_scrape(payload: ScrapeRequest, background_tasks: BackgroundTasks):
    return await enqueue_scrape_job(payload.city, payload.country, background_tasks)


@router.get("/{job_id}", response_model=ScrapeStatus)
async def get_job_status(job_id: str):
    job = None
    try:
        job = await redis_get_job(job_id)
    except Exception:
        pass
    job = job or _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
