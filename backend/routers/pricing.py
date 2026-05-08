from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional

from backend.database.connection import get_db
from backend.database.models import Agency, Property

router = APIRouter(prefix="/api/pricing", tags=["pricing"])


@router.get("")
async def get_pricing(
    city: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    # Base filter on city/country if provided
    def _agency_filter(stmt):
        if city:
            stmt = stmt.where(Agency.city.ilike(f"%{city}%"))
        if country:
            stmt = stmt.where(Agency.country.ilike(f"%{country}%"))
        return stmt

    def _prop_filter(stmt):
        if city:
            stmt = stmt.where(Property.city.ilike(f"%{city}%"))
        if country:
            stmt = stmt.where(Property.country.ilike(f"%{country}%"))
        return stmt

    # 1. Avg price per sqm by locality
    q1 = _prop_filter(
        select(Property.locality, func.avg(Property.price_per_sqm).label("avg_price_sqm"))
        .where(Property.locality.isnot(None), Property.price_per_sqm.isnot(None))
        .group_by(Property.locality)
        .order_by(func.avg(Property.price_per_sqm).desc())
    )
    rows1 = (await db.execute(q1)).all()
    avg_by_locality = [
        {"locality": r.locality, "avg_price_sqm": round(r.avg_price_sqm, 2)}
        for r in rows1 if r.locality
    ]

    # 2. Price range by property type
    q2 = _prop_filter(
        select(
            Property.property_type,
            func.min(Property.price).label("min"),
            func.max(Property.price).label("max"),
            func.avg(Property.price).label("avg"),
        )
        .where(Property.property_type.isnot(None), Property.price.isnot(None))
        .group_by(Property.property_type)
    )
    rows2 = (await db.execute(q2)).all()
    price_by_type = [
        {
            "type": r.property_type,
            "min": round(r.min, 2),
            "max": round(r.max, 2),
            "avg": round(r.avg, 2),
        }
        for r in rows2
    ]

    # 3. Scatter: sqm vs price (cap at 500 points)
    q3 = _prop_filter(
        select(Property.total_sqm, Property.price, Property.property_type)
        .where(Property.total_sqm.isnot(None), Property.price.isnot(None))
        .limit(500)
    )
    rows3 = (await db.execute(q3)).all()
    sqm_vs_price = [
        {"total_sqm": r.total_sqm, "price": r.price, "property_type": r.property_type or "unknown"}
        for r in rows3
    ]

    # 4. Bedrooms vs avg price
    q4 = _prop_filter(
        select(Property.bedrooms, func.avg(Property.price).label("avg_price"))
        .where(Property.bedrooms.isnot(None), Property.price.isnot(None))
        .group_by(Property.bedrooms)
        .order_by(Property.bedrooms)
    )
    rows4 = (await db.execute(q4)).all()
    beds_vs_price = [
        {"bedrooms": r.bedrooms, "avg_price": round(r.avg_price, 2)}
        for r in rows4
    ]

    # 5. Summary counts
    total_props = (await db.execute(_prop_filter(select(func.count()).select_from(Property)))).scalar() or 0
    total_agencies = (await db.execute(_agency_filter(select(func.count()).select_from(Agency)))).scalar() or 0

    cheapest = avg_by_locality[-1]["locality"] if avg_by_locality else None
    most_expensive = avg_by_locality[0]["locality"] if avg_by_locality else None

    return {
        "avg_price_by_locality": avg_by_locality,
        "price_range_by_type": price_by_type,
        "sqm_vs_price": sqm_vs_price,
        "bedrooms_vs_avg_price": beds_vs_price,
        "summary": {
            "cheapest_locality": cheapest,
            "most_expensive_locality": most_expensive,
            "total_properties": total_props,
            "total_agencies": total_agencies,
        },
    }
