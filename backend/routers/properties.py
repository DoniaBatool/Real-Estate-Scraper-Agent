import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, date
from uuid import UUID
from typing import Optional
from backend.database.connection import get_db
from backend.database import crud
from backend.reports.generator import generate_property_pdf

router = APIRouter(prefix="/api/properties", tags=["properties"])


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
