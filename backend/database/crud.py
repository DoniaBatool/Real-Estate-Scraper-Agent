"""CRUD operations for agencies and properties."""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database.models import Agency, Property


async def get_agencies(
    db: AsyncSession,
    city: str | None = None,
    country: str | None = None,
    search: str | None = None,
    page: int = 1,
    limit: int = 20,
) -> list[Agency]:
    stmt = select(Agency)
    if city:
        stmt = stmt.where(Agency.city.ilike(f"%{city}%"))
    if country:
        stmt = stmt.where(Agency.country.ilike(f"%{country}%"))
    if search:
        stmt = stmt.where(Agency.name.ilike(f"%{search}%"))
    stmt = stmt.offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_agency_by_id(db: AsyncSession, agency_id: str) -> Agency | None:
    result = await db.execute(select(Agency).where(Agency.id == agency_id))
    return result.scalar_one_or_none()


async def create_agency(db: AsyncSession, data: dict) -> Agency:
    agency = Agency(**data)
    db.add(agency)
    await db.commit()
    await db.refresh(agency)
    return agency


async def upsert_agency(db: AsyncSession, data: dict) -> Agency:
    result = await db.execute(
        select(Agency).where(Agency.website_url == data.get("website_url"))
    )
    existing = result.scalar_one_or_none()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        await db.commit()
        await db.refresh(existing)
        return existing
    return await create_agency(db, data)


async def get_properties(
    db: AsyncSession,
    agency_id: str | None = None,
    property_type: str | None = None,
    bedrooms: int | None = None,
    locality: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_sqm: float | None = None,
    max_sqm: float | None = None,
    sort: str = "price",
    order: str = "asc",
    page: int = 1,
    limit: int = 50,
) -> list[Property]:
    stmt = select(Property)
    if agency_id:
        stmt = stmt.where(Property.agency_id == agency_id)
    if property_type:
        stmt = stmt.where(Property.property_type == property_type)
    if bedrooms is not None:
        stmt = stmt.where(Property.bedrooms == bedrooms)
    if locality:
        stmt = stmt.where(Property.locality.ilike(f"%{locality}%"))
    if min_price is not None:
        stmt = stmt.where(Property.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Property.price <= max_price)
    if min_sqm is not None:
        stmt = stmt.where(Property.total_sqm >= min_sqm)
    if max_sqm is not None:
        stmt = stmt.where(Property.total_sqm <= max_sqm)
    sort_col = getattr(Property, sort, Property.price)
    stmt = stmt.order_by(sort_col.asc() if order == "asc" else sort_col.desc())
    stmt = stmt.offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def create_property(db: AsyncSession, data: dict) -> Property:
    prop = Property(**data)
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop


async def delete_agency(db: AsyncSession, agency_id: str) -> bool:
    agency = await get_agency_by_id(db, agency_id)
    if not agency:
        return False
    await db.delete(agency)
    await db.commit()
    return True
