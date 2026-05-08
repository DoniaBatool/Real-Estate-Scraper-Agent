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
from backend.scraper.engine import ScraperEngine
from backend.ai.extractor import extract_data
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

    price = prop.get("price")
    total_sqm = prop.get("total_sqm")
    price_per_sqm = prop.get("price_per_sqm")
    if price and total_sqm and not price_per_sqm and total_sqm > 0:
        price_per_sqm = round(float(price) / float(total_sqm), 2)

    return {
        "agency_id": agency_id,
        "title": prop.get("title"),
        "property_type": prop.get("property_type"),
        "description": prop.get("description"),
        "images": images or None,
        "bedrooms": prop.get("bedrooms"),
        "bathroom_count": prop.get("bathrooms"),
        "bedroom_sqm": prop.get("bedroom_sqm"),
        "bathroom_sqm": prop.get("bathroom_sqm"),
        "total_sqm": total_sqm,
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
        "amenities": amenities or None,
    }


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------

async def _run_pipeline(job_id: str, city: str, country: str) -> None:
    engine = ScraperEngine()
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

            # Step 2 — Scrape the agency website (layered engine)
            scrape_result = await engine.scrape(url)
            if not scrape_result["success"] or not scrape_result.get("html"):
                logger.warning("Scrape failed for %s", url)
                continue

            # Step 3 — AI extraction
            extracted = await extract_data(scrape_result["html"], url)

            # Step 4 — Persist to Supabase
            try:
                agency_row = _build_agency_row(item, extracted, city, country, scrape_result["level"])
                agency = await crud.upsert_agency(db, agency_row)

                for prop in (extracted.get("properties") or []):
                    if not isinstance(prop, dict):
                        continue
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=ScrapeStatus, status_code=202)
async def start_scrape(payload: ScrapeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "status": "queued",
        "city": payload.city,
        "country": payload.country,
        "agencies_found": 0,
        "agencies_scraped": 0,
        "message": "Job queued",
    }
    _jobs[job_id] = job
    try:
        await set_job_status(job_id, job)
    except Exception:
        pass

    background_tasks.add_task(_run_pipeline, job_id, payload.city, payload.country)
    return job


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
