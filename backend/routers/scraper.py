import asyncio
import functools
import logging
import uuid
from datetime import date
from urllib.parse import urljoin, urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from backend.database.connection import _get_engine
from backend.database import crud
from backend.discovery.apify_client import discover_agencies_sync
from backend.scraper.deep_scraper import scrape_agency_deep
from backend.scraper.level1_httpx import scrape_level1
from backend.ai.extractor import extract_agency_info, extract_from_deep_scrape
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
    agency_url: str = ""


class ScrapeStatus(BaseModel):
    job_id: str
    status: str
    city: str
    country: str
    agencies_found: int = 0
    agencies_scraped: int = 0
    message: str = ""


class RepairListingUrlsRequest(BaseModel):
    min_missing: int = 5
    limit: int = 20


class RepairAgencyRequest(BaseModel):
    agency_id: str


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


def _coerce_opt_str(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, str):
        s = val.strip()
        return s or None
    if isinstance(val, (list, tuple, set)):
        for item in val:
            s = str(item).strip()
            if s:
                return s
        return None
    s = str(val).strip()
    return s or None


def _display_name_from_agency_url(agency_url: str) -> str:
    domain = urlparse(agency_url.strip()).netloc
    return domain.replace("www.", "").split(".")[0].title()


async def _resolve_direct_agency_display_name(agency_url: str) -> str:
    """Prefer agency name from homepage (LLM extraction); fallback to first domain label."""
    au = agency_url.strip()
    fallback = _display_name_from_agency_url(au)
    try:
        lvl = await scrape_level1(au)
        html = lvl.get("html") if lvl.get("success") else None
        if not html:
            return fallback
        info = await extract_agency_info(html, au)
        name = _coerce_opt_str(info.get("agency_name")) or _coerce_opt_str(info.get("owner_name"))
        if name:
            return name
    except Exception as exc:
        logger.warning("Could not resolve agency display name from homepage (%s): %s", au, exc)
    return fallback


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
        "name": extracted.get("agency_name")
        or extracted.get("owner_name")
        or apify_item.get("name")
        or "Unknown",
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
        "specialization": _coerce_opt_str(extracted.get("specialization")),
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


def _resolve_stored_image_urls(images: list, listing_url: object) -> list[str] | None:
    """Join root-relative paths to listing_url so browsers don't request localhost."""
    if not images:
        return None
    base = str(listing_url).strip() if listing_url else ""
    out: list[str] = []
    for raw in images:
        if not isinstance(raw, str):
            continue
        u = raw.strip()
        if not u:
            continue
        low = u.lower()
        if low.startswith(("http://", "https://")):
            out.append(u)
        elif u.startswith("//"):
            out.append("https:" + u)
        elif base:
            if not u.startswith(("/", "?", "#")):
                root_seg = u.split("/", 1)[0].lower().split("?")[0]
                if root_seg in (
                    "content",
                    "uploads",
                    "media",
                    "sites",
                    "wp-content",
                    "assets",
                    "files",
                    "images",
                    "public",
                    "static",
                ):
                    u = "/" + u.lstrip("/")
            out.append(urljoin(base, u))
        else:
            out.append(u)
    return list(dict.fromkeys(out)) or None


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
    if isinstance(images, list):
        images = _resolve_stored_image_urls(images, prop.get("listing_url")) or []

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

async def _run_pipeline(
    job_id: str, city: str, country: str, agency_url: str = ""
) -> None:
    direct_url = (agency_url or "").strip()
    if direct_url:
        logger.info("Direct scrape: %s", direct_url)
        await _update_job(
            job_id,
            status="running",
            message=f"Direct scrape — skipping discovery ({direct_url})…",
        )
        display_name = await _resolve_direct_agency_display_name(direct_url)
        agencies_to_scrape = [
            {
                "name": display_name,
                "website_url": direct_url,
                "website": direct_url,
                "url": direct_url,
            }
        ]
    else:
        await _update_job(job_id, status="running", message="Discovering agencies via Apify…")

        # Step 1 — Discover (apify_client SDK is synchronous, run in thread pool)
        try:
            loop = asyncio.get_running_loop()
            agencies_to_scrape = await loop.run_in_executor(
                None, functools.partial(discover_agencies_sync, city, country)
            )
        except Exception as exc:
            logger.error("Agency discovery error: %s", exc)
            agencies_to_scrape = []

    await _update_job(
        job_id,
        agencies_found=len(agencies_to_scrape),
        message=f"Found {len(agencies_to_scrape)} agencies — scraping websites…",
    )

    total = len(agencies_to_scrape)
    done = 0

    _, session_factory = _get_engine()
    async with session_factory() as db:
        for agency in agencies_to_scrape:
            website = (agency.get("website_url") or agency.get("url") or "").strip()
            if not website or not website.startswith("http"):
                done += 1
                continue

            # Allow re-scrape when user passes agency_url (forced direct run).
            if not direct_url and await is_url_scraped(website):
                done += 1
                continue

            try:
                scrape_result = await scrape_agency_deep(website)
                extracted = await extract_from_deep_scrape(scrape_result, website)

                merged = {
                    "agency_name": agency.get("name"),
                    "phone": ([agency["phone"]] if agency.get("phone") else []),
                    "google_rating": agency.get("totalScore"),
                    "address": agency.get("address"),
                    "website_url": website,
                    "city": city,
                    "country": country,
                    **extracted,
                }

                maps_phone = [agency["phone"]] if agency.get("phone") else []
                scraped_phones = extracted.get("phone", [])
                merged["phone"] = list(set(_coerce_str_list(maps_phone) + _coerce_str_list(scraped_phones)))

                agency_payload = _build_agency_row(
                    {
                        "name": agency.get("name"),
                        "website_url": website,
                        "phone": merged.get("phone"),
                        "google_rating": merged.get("google_rating"),
                        "review_count": agency.get("reviewsCount") or agency.get("review_count"),
                    },
                    merged,
                    city,
                    country,
                    2,
                )
                agency_payload["description"] = merged.get("description") or agency_payload.get("description")
                agency_payload["total_listings"] = len(extracted.get("properties", []) or [])
                cats: set[str] = set()
                for p in extracted.get("properties", []) or []:
                    if not isinstance(p, dict):
                        continue
                    for key in ("category", "property_type"):
                        if p.get(key):
                            cats.add(str(p[key]).strip())
                agency_payload["property_categories"] = sorted(cats) if cats else None
                agency_payload["scrape_status"] = "done"

                saved_agency = await crud.upsert_agency(db, agency_payload)

                properties_saved = 0
                if saved_agency:
                    for prop in extracted.get("properties", []):
                        if isinstance(prop, dict) and prop.get("title"):
                            row = _build_property_row(prop, saved_agency.id, city, country)
                            await crud.create_property(db, row)
                            properties_saved += 1

                await mark_url_scraped(website)
                done += 1
                await _update_job(
                    job_id,
                    status="running",
                    agencies_scraped=done,
                    message=f"Scraped {merged.get('agency_name', website)} — {properties_saved} properties found",
                )
            except Exception as exc:
                logger.error("Pipeline error for %s: %s", website, exc)
                done += 1

    await _update_job(
        job_id,
        status="complete",
        agencies_scraped=done,
        message=f"Complete — processed {done}/{total} agencies",
    )


async def _run_repair_listing_urls(job_id: str, min_missing: int, limit: int) -> None:
    try:
        await _update_job(
            job_id,
            status="running",
            message=f"Finding agencies with >= {min_missing} missing listing URLs…",
        )

        _, session_factory = _get_engine()
        async with session_factory() as db:
            # Backward-compatible schema guard for older DBs.
            await db.execute(
                text("ALTER TABLE agencies ADD COLUMN IF NOT EXISTS property_categories TEXT[]")
            )
            await db.commit()
            targets = await crud.get_agencies_with_missing_listing_urls(
                db, min_missing=min_missing, limit=limit
            )
            total = len(targets)
            done = 0
            await _update_job(
                job_id,
                agencies_found=total,
                message=f"Repair queue built: {total} agencies",
            )

            for agency, missing_before in targets:
                website = (agency.website_url or "").strip()
                if not website:
                    done += 1
                    continue
                try:
                    scrape_result = await scrape_agency_deep(website)
                    extracted = await extract_from_deep_scrape(scrape_result, website)

                    merged = {
                        "agency_name": agency.name,
                        "website_url": website,
                        "city": agency.city,
                        "country": agency.country,
                        **extracted,
                    }
                    merged["phone"] = list(
                        set(_coerce_str_list(agency.phone) + _coerce_str_list(extracted.get("phone")))
                    )

                    payload = _build_agency_row(
                        {
                            "name": agency.name,
                            "website_url": website,
                            "phone": merged.get("phone"),
                            "google_rating": agency.google_rating,
                            "review_count": agency.review_count,
                        },
                        merged,
                        agency.city or "",
                        agency.country or "",
                        2,
                    )
                    payload["total_listings"] = len(extracted.get("properties", []) or [])
                    payload["scrape_status"] = "done"

                    saved_agency = await crud.upsert_agency(db, payload)
                    if saved_agency:
                        await crud.delete_properties_for_agency(db, saved_agency.id)
                        for prop in extracted.get("properties", []) or []:
                            if isinstance(prop, dict) and prop.get("title"):
                                row = _build_property_row(
                                    prop, saved_agency.id, agency.city or "", agency.country or ""
                                )
                                await crud.create_property(db, row)
                        await mark_url_scraped(website)

                    done += 1
                    await _update_job(
                        job_id,
                        agencies_scraped=done,
                        message=(
                            f"Repaired {agency.name} ({done}/{total}) — "
                            f"had {missing_before} missing URLs before refresh"
                        ),
                    )
                except Exception as exc:
                    logger.error("Repair pipeline error for %s: %s", website, exc)
                    done += 1

            await _update_job(
                job_id,
                status="complete",
                agencies_scraped=done,
                message=f"Repair complete — processed {done}/{total} agencies",
            )
    except Exception as exc:
        logger.exception("Repair listing-url job failed before processing: %s", exc)
        await _update_job(
            job_id,
            status="failed",
            message=f"Repair job failed early: {exc}",
        )


async def _run_repair_single_agency(job_id: str, agency_id: str) -> None:
    try:
        await _update_job(job_id, status="running", message="Loading agency details…")
        _, session_factory = _get_engine()
        async with session_factory() as db:
            agency = await crud.get_agency_by_id(db, agency_id)
            if not agency:
                await _update_job(job_id, status="failed", message="Agency not found")
                return

            website = (agency.website_url or "").strip()
            if not website:
                await _update_job(
                    job_id, status="failed", message="Agency has no website URL for repair"
                )
                return

            missing_rows = await db.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM properties
                    WHERE agency_id = :agency_id
                      AND (listing_url IS NULL OR length(trim(listing_url)) = 0)
                    """
                ),
                {"agency_id": str(agency.id)},
            )
            missing_before = int(missing_rows.scalar_one() or 0)
            await _update_job(
                job_id,
                agencies_found=1,
                agencies_scraped=0,
                message=f"Re-scraping {agency.name}…",
            )

            scrape_result = await scrape_agency_deep(website)
            extracted = await extract_from_deep_scrape(scrape_result, website)

            merged = {
                "agency_name": agency.name,
                "website_url": website,
                "city": agency.city,
                "country": agency.country,
                **extracted,
            }
            merged["phone"] = list(
                set(_coerce_str_list(agency.phone) + _coerce_str_list(extracted.get("phone")))
            )

            payload = _build_agency_row(
                {
                    "name": agency.name,
                    "website_url": website,
                    "phone": merged.get("phone"),
                    "google_rating": agency.google_rating,
                    "review_count": agency.review_count,
                },
                merged,
                agency.city or "",
                agency.country or "",
                2,
            )
            payload["total_listings"] = len(extracted.get("properties", []) or [])
            payload["scrape_status"] = "done"

            saved_agency = await crud.upsert_agency(db, payload)
            if saved_agency:
                await crud.delete_properties_for_agency(db, saved_agency.id)
                for prop in extracted.get("properties", []) or []:
                    if isinstance(prop, dict) and prop.get("title"):
                        row = _build_property_row(
                            prop, saved_agency.id, agency.city or "", agency.country or ""
                        )
                        await crud.create_property(db, row)
                await mark_url_scraped(website)

            await _update_job(
                job_id,
                status="complete",
                agencies_scraped=1,
                message=(
                    f"Repaired {agency.name} — had {missing_before} missing URLs before refresh"
                ),
            )
    except Exception as exc:
        logger.exception("Single agency repair failed for %s: %s", agency_id, exc)
        await _update_job(
            job_id,
            status="failed",
            message=f"Single-agency repair failed: {exc}",
        )


async def enqueue_scrape_job(
    city: str,
    country: str,
    background_tasks: BackgroundTasks,
    agency_url: str = "",
) -> dict:
    job_id = str(uuid.uuid4())
    au = (agency_url or "").strip()
    job = {
        "job_id": job_id,
        "status": "queued",
        "city": city,
        "country": country,
        "agencies_found": 1 if au else 0,
        "agencies_scraped": 0,
        "message": (
            f"Direct scrape queued ({au})"
            if au
            else "Job queued"
        ),
    }
    _jobs[job_id] = job
    try:
        await set_job_status(job_id, job)
    except Exception:
        pass

    background_tasks.add_task(_run_pipeline, job_id, city, country, agency_url)
    return job


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=ScrapeStatus, status_code=202)
async def start_scrape(payload: ScrapeRequest, background_tasks: BackgroundTasks):
    return await enqueue_scrape_job(
        payload.city,
        payload.country,
        background_tasks,
        agency_url=payload.agency_url,
    )


@router.post("/repair-listing-urls", response_model=ScrapeStatus, status_code=202)
async def start_repair_listing_urls(payload: RepairListingUrlsRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "status": "queued",
        "city": "",
        "country": "",
        "agencies_found": 0,
        "agencies_scraped": 0,
        "message": f"Repair job queued (min_missing={payload.min_missing}, limit={payload.limit})",
    }
    _jobs[job_id] = job
    try:
        await set_job_status(job_id, job)
    except Exception:
        pass
    background_tasks.add_task(
        _run_repair_listing_urls, job_id, payload.min_missing, payload.limit
    )
    return job


@router.post("/repair-agency", response_model=ScrapeStatus, status_code=202)
async def start_repair_agency(payload: RepairAgencyRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "status": "queued",
        "city": "",
        "country": "",
        "agencies_found": 1,
        "agencies_scraped": 0,
        "message": f"Single-agency repair queued ({payload.agency_id})",
    }
    _jobs[job_id] = job
    try:
        await set_job_status(job_id, job)
    except Exception:
        pass
    background_tasks.add_task(_run_repair_single_agency, job_id, payload.agency_id)
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
