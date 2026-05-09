"""CRUD operations for agencies and properties."""
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select, text
from backend.database.models import (
    Agency,
    Property,
    ChatThread,
    ChatMessage,
    ChatSummary,
    ChatToolRun,
)


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


_PROPERTY_CREATE_KEYS = frozenset(
    {
        "agency_id",
        "title",
        "property_type",
        "category",
        "description",
        "images",
        "bedrooms",
        "bathroom_count",
        "bedroom_sqm",
        "bathroom_sqm",
        "total_sqm",
        "plot_sqm",
        "furnished",
        "floor_number",
        "total_floors",
        "year_built",
        "condition",
        "energy_rating",
        "virtual_tour_url",
        "listing_reference",
        "full_address",
        "price",
        "price_per_sqm",
        "currency",
        "locality",
        "district",
        "city",
        "country",
        "latitude",
        "longitude",
        "listing_date",
        "amenities",
        "listing_url",
    }
)


async def create_property(db: AsyncSession, data: dict) -> Property:
    payload = {k: data[k] for k in _PROPERTY_CREATE_KEYS if k in data}
    prop = Property(**payload)
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return prop


async def get_property_by_id(db: AsyncSession, property_id: str) -> Property | None:
    result = await db.execute(select(Property).where(Property.id == property_id))
    return result.scalar_one_or_none()


async def get_locality_pricing(db: AsyncSession, locality: str) -> dict:
    result = await db.execute(
        text(
            """
            SELECT
                locality,
                COUNT(*) as count,
                AVG(price_per_sqm) as avg_price_per_sqm,
                AVG(total_sqm) as avg_size,
                MIN(price) as min_price,
                MAX(price) as max_price,
                AVG(price) as avg_price
            FROM properties
            WHERE locality ILIKE :locality
            AND price_per_sqm IS NOT NULL
            GROUP BY locality
            """
        ),
        {"locality": f"%{locality}%"},
    )
    row = result.fetchone()
    if row:
        return dict(row._mapping)
    return {}


async def delete_agency(db: AsyncSession, agency_id: str) -> bool:
    agency = await get_agency_by_id(db, agency_id)
    if not agency:
        return False
    await db.delete(agency)
    await db.commit()
    return True


async def create_chat_thread(db: AsyncSession, title: str = "New Chat") -> ChatThread:
    thread = ChatThread(title=title)
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return thread


async def list_chat_threads(db: AsyncSession, include_archived: bool = False) -> list[ChatThread]:
    stmt = select(ChatThread)
    if not include_archived:
        stmt = stmt.where(ChatThread.archived.is_(False))
    stmt = stmt.order_by(ChatThread.updated_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_chat_thread(db: AsyncSession, thread_id: str) -> ChatThread | None:
    result = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    return result.scalar_one_or_none()


async def update_chat_thread(
    db: AsyncSession,
    thread_id: str,
    *,
    title: str | None = None,
    archived: bool | None = None,
) -> ChatThread | None:
    thread = await get_chat_thread(db, thread_id)
    if not thread:
        return None
    if title is not None:
        thread.title = title
    if archived is not None:
        thread.archived = archived
    await db.commit()
    await db.refresh(thread)
    return thread


async def create_chat_message(
    db: AsyncSession,
    thread_id: str,
    role: str,
    content: str,
    meta: dict | None = None,
) -> ChatMessage:
    message = ChatMessage(
        thread_id=thread_id,
        role=role,
        content=content,
        meta_json=json.dumps(meta) if meta else None,
    )
    db.add(message)
    thread = await get_chat_thread(db, thread_id)
    if thread:
        thread.updated_at = message.created_at
    await db.commit()
    await db.refresh(message)
    return message


async def list_chat_messages(db: AsyncSession, thread_id: str, limit: int = 200) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_latest_chat_summary(db: AsyncSession, thread_id: str) -> ChatSummary | None:
    stmt = (
        select(ChatSummary)
        .where(ChatSummary.thread_id == thread_id)
        .order_by(ChatSummary.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_chat_summary(
    db: AsyncSession,
    thread_id: str,
    summary: str,
    message_count: int,
) -> ChatSummary:
    row = ChatSummary(thread_id=thread_id, summary=summary, message_count=message_count)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def create_chat_tool_run(
    db: AsyncSession,
    thread_id: str,
    tool_name: str,
    tool_args: dict | None = None,
    rationale: str | None = None,
    message_id: str | None = None,
    status: str = "started",
    output: dict | None = None,
) -> ChatToolRun:
    row = ChatToolRun(
        thread_id=thread_id,
        message_id=message_id,
        tool_name=tool_name,
        tool_args_json=json.dumps(tool_args) if tool_args else None,
        rationale=rationale,
        status=status,
        output_json=json.dumps(output) if output else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def list_chat_tool_runs(db: AsyncSession, thread_id: str, limit: int = 100) -> list[ChatToolRun]:
    stmt = (
        select(ChatToolRun)
        .where(ChatToolRun.thread_id == thread_id)
        .order_by(ChatToolRun.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def delete_chat_thread(db: AsyncSession, thread_id: str) -> bool:
    thread = await get_chat_thread(db, thread_id)
    if not thread:
        return False
    await db.delete(thread)
    await db.commit()
    return True


async def clear_all_chat_threads(db: AsyncSession) -> int:
    result = await db.execute(select(ChatThread))
    threads = result.scalars().all()
    for thread in threads:
        await db.delete(thread)
    await db.commit()
    return len(threads)


# --- ARIA agent search / pricing helpers ---------------------------------


async def search_properties(
    db: AsyncSession,
    city: str | None = None,
    country: str | None = None,
    property_type: str | None = None,
    min_bedrooms: int | None = None,
    max_bedrooms: int | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    locality: str | None = None,
    category: str | None = None,
    agency_name: str | None = None,
    limit: int = 10,
) -> list[Property]:
    stmt = select(Property).join(Agency, Property.agency_id == Agency.id)
    if city:
        stmt = stmt.where(or_(Property.city.ilike(f"%{city}%"), Agency.city.ilike(f"%{city}%")))
    if country:
        stmt = stmt.where(or_(Property.country.ilike(f"%{country}%"), Agency.country.ilike(f"%{country}%")))
    if property_type and property_type != "any":
        stmt = stmt.where(Property.property_type.ilike(property_type))
    if min_bedrooms is not None:
        stmt = stmt.where(Property.bedrooms >= min_bedrooms)
    if max_bedrooms is not None:
        stmt = stmt.where(Property.bedrooms <= max_bedrooms)
    if min_price is not None:
        stmt = stmt.where(Property.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Property.price <= max_price)
    if locality:
        stmt = stmt.where(Property.locality.ilike(f"%{locality}%"))
    if category and category != "any":
        stmt = stmt.where(Property.category.ilike(f"%{category}%"))
    if agency_name:
        stmt = stmt.where(Agency.name.ilike(f"%{agency_name}%"))
    stmt = stmt.order_by(Property.price.asc()).limit(min(max(limit, 1), 80))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def search_agencies(
    db: AsyncSession,
    city: str | None = None,
    country: str | None = None,
    limit: int = 10,
) -> list[Agency]:
    stmt = select(Agency)
    if city:
        stmt = stmt.where(Agency.city.ilike(f"%{city}%"))
    if country:
        stmt = stmt.where(Agency.country.ilike(f"%{country}%"))
    stmt = stmt.limit(min(max(limit, 1), 50))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_agency_by_name(db: AsyncSession, agency_name: str) -> Agency | None:
    result = await db.execute(select(Agency).where(Agency.name.ilike(f"%{agency_name.strip()}%")))
    return result.scalars().first()


async def get_agency_properties(db: AsyncSession, agency_id) -> list[Property]:
    result = await db.execute(select(Property).where(Property.agency_id == agency_id))
    return list(result.scalars().all())


async def get_pricing_data(
    db: AsyncSession,
    city: str | None = None,
    country: str | None = None,
    property_type: str | None = None,
    category: str | None = None,
) -> dict:
    """Same aggregates as GET /api/pricing; optional filters by type/category/location."""

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
        if property_type:
            stmt = stmt.where(Property.property_type.ilike(property_type))
        if category:
            stmt = stmt.where(
                or_(
                    Property.category.ilike(category),
                    Property.property_type.ilike(category),
                )
            )
        return stmt

    q1 = _prop_filter(
        select(Property.locality, func.avg(Property.price_per_sqm).label("avg_price_sqm"))
        .where(Property.locality.isnot(None), Property.price_per_sqm.isnot(None))
        .group_by(Property.locality)
        .order_by(func.avg(Property.price_per_sqm).desc())
    )
    rows1 = (await db.execute(q1)).all()
    avg_by_locality = [
        {"locality": r.locality, "avg_price_sqm": round(r.avg_price_sqm, 2)}
        for r in rows1
        if r.locality
    ]

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
