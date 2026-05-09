from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from backend.database.connection import get_db
from backend.database import crud

router = APIRouter(prefix="/api/pricing", tags=["pricing"])


@router.get("")
async def get_pricing(
    city: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    property_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_pricing_data(
        db,
        city=city,
        country=country,
        property_type=property_type,
        category=category,
    )
