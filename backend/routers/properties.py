import io
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, date
from uuid import UUID
from typing import Optional
from backend.database.connection import get_db
from backend.database import crud

router = APIRouter(prefix="/api/properties", tags=["properties"])


def _host_key(url: str) -> str:
    try:
        h = urlparse(url).hostname or ""
        return h.lower().removeprefix("www.")
    except Exception:
        return ""


@router.get("/image-proxy")
async def proxy_listing_image(
    url: str = Query(..., description="Absolute image URL"),
    listing_url: str = Query(..., description="Property listing page URL (same-host check + Referer)"),
):
    """Fetch listing images server-side so agency sites that block hotlinking still render in the app."""
    p_img = urlparse(url)
    if p_img.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid image URL scheme")
    p_list = urlparse(listing_url)
    if p_list.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid listing_url scheme")
    if _host_key(url) != _host_key(listing_url):
        raise HTTPException(status_code=403, detail="Image host must match listing host")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": listing_url,
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
            r = await client.get(url, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Image fetch failed: {e}") from e

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Upstream returned {r.status_code}")
    ct = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not ct.startswith("image/"):
        raise HTTPException(status_code=502, detail="Response is not an image")
    return Response(content=r.content, media_type=ct)


class PropertyOut(BaseModel):
    id: UUID
    agency_id: Optional[UUID] = None
    title: Optional[str] = None
    property_type: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    images: Optional[list[str]] = None
    bedrooms: Optional[int] = None
    bathroom_count: Optional[int] = None
    bedroom_sqm: Optional[float] = None
    bathroom_sqm: Optional[float] = None
    total_sqm: Optional[float] = None
    plot_sqm: Optional[float] = None
    furnished: Optional[str] = None
    floor_number: Optional[int] = None
    total_floors: Optional[int] = None
    year_built: Optional[int] = None
    condition: Optional[str] = None
    energy_rating: Optional[str] = None
    virtual_tour_url: Optional[str] = None
    listing_reference: Optional[str] = None
    full_address: Optional[str] = None
    price: Optional[float] = None
    price_per_sqm: Optional[float] = None
    currency: Optional[str] = None
    locality: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    listing_date: Optional[date] = None
    amenities: Optional[list[str]] = None
    listing_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[PropertyOut])
async def list_properties(
    agency_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None, alias="type"),
    bedrooms: Optional[int] = Query(None),
    locality: Optional[str] = Query(None),
    min_price: Optional[float] = Query(None),
    max_price: Optional[float] = Query(None),
    min_sqm: Optional[float] = Query(None),
    max_sqm: Optional[float] = Query(None),
    sort: str = Query("price"),
    order: str = Query("asc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_properties(
        db,
        agency_id=agency_id,
        property_type=type,
        bedrooms=bedrooms,
        locality=locality,
        min_price=min_price,
        max_price=max_price,
        min_sqm=min_sqm,
        max_sqm=max_sqm,
        sort=sort,
        order=order,
        page=page,
        limit=limit,
    )


@router.get("/{property_id}/report")
async def download_property_report(
    property_id: str,
    db: AsyncSession = Depends(get_db),
):
    # Lazy import so missing WeasyPrint system libs don't block full API startup.
    try:
        from backend.reports.generator import generate_property_pdf
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"PDF report service unavailable (missing WeasyPrint dependencies): {exc}",
        ) from exc

    prop = await crud.get_property_by_id(db, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    agency = await crud.get_agency_by_id(db, str(prop.agency_id)) if prop.agency_id else None
    pricing = await crud.get_locality_pricing(db, prop.locality or "")
    pdf_bytes = await generate_property_pdf(
        prop.__dict__,
        agency.__dict__ if agency else None,
        pricing,
    )
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=property_report_{property_id}.pdf"
        },
    )
