from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from typing import Optional
from backend.database.connection import get_db
from backend.database import crud

router = APIRouter(prefix="/api/agencies", tags=["agencies"])


class AgencyOut(BaseModel):
    id: UUID
    name: str
    owner_name: Optional[str] = None
    website_url: str
    email: Optional[list[str]] = None
    phone: Optional[list[str]] = None
    whatsapp: Optional[str] = None
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    google_rating: Optional[float] = None
    review_count: Optional[int] = None
    specialization: Optional[str] = None
    price_range_min: Optional[float] = None
    price_range_max: Optional[float] = None
    currency: Optional[str] = None
    total_listings: Optional[int] = None
    property_categories: Optional[list[str]] = None
    logo_url: Optional[str] = None
    description: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    scrape_status: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[AgencyOut])
async def list_agencies(
    city: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_agencies(db, city, country, search, page, limit)


@router.get("/{agency_id}", response_model=AgencyOut)
async def get_agency(agency_id: str, db: AsyncSession = Depends(get_db)):
    agency = await crud.get_agency_by_id(db, agency_id)
    if not agency:
        raise HTTPException(status_code=404, detail="Agency not found")
    return agency


@router.delete("/{agency_id}", status_code=204)
async def remove_agency(agency_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await crud.delete_agency(db, agency_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agency not found")
