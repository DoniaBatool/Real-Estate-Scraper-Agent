import json
import logging
import re
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.connection import get_db
from backend.database import crud
from backend.routers.scraper import enqueue_scrape_job, ScrapeStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

SUMMARY_REFRESH_THRESHOLD = 12
RAW_TURN_WINDOW = 8
GREETING_WORDS = {"hi", "hello", "hey", "salam", "assalamualaikum", "good morning", "good evening"}


class ChatThreadOut(BaseModel):
    id: UUID
    title: str
    archived: bool
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None

    class Config:
        from_attributes = True


class ChatMessageOut(BaseModel):
    id: UUID
    thread_id: UUID
    role: str
    content: str
    created_at: datetime
    meta: dict | None = None

    class Config:
        from_attributes = True


class ChatSummaryOut(BaseModel):
    summary: str
    message_count: int


class ChatThreadCreateRequest(BaseModel):
    title: str | None = None


class ChatThreadUpdateRequest(BaseModel):
    title: str | None = None
    archived: bool | None = None


class ClearAllThreadsResponse(BaseModel):
    deleted_count: int


class ChatMessageRequest(BaseModel):
    message: str


class ChatReplyOut(BaseModel):
    reply: str
    action: str
    job: ScrapeStatus | None = None
    context_summary: ChatSummaryOut | None = None
    recent_turns_used: int
    message_meta: dict | None = None


class ChatToolRunOut(BaseModel):
    id: UUID
    thread_id: UUID
    message_id: UUID | None = None
    tool_name: str
    tool_args: dict | None = None
    rationale: str | None = None
    status: str
    output: dict | None = None
    created_at: datetime

    class Config:
        from_attributes = True


def _meta_from_json(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _extract_city_country(message: str) -> tuple[str | None, str | None]:
    text = " ".join(message.strip().split())
    if not text:
        return None, None

    pattern = re.compile(
        r"(?:in|for|from)\s+([A-Za-z\s\-.']+?)\s*,\s*([A-Za-z\s\-.']+?)(?:[.?!]|$)",
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if match:
        return match.group(1).strip().title(), match.group(2).strip().title()

    fallback = re.compile(
        r"(?:city\s+([A-Za-z\s\-.']+?)\s+country\s+([A-Za-z\s\-.']+))",
        re.IGNORECASE,
    ).search(text)
    if fallback:
        return fallback.group(1).strip().title(), fallback.group(2).strip().title()

    return None, None


def _is_greeting(message: str) -> bool:
    lowered = message.lower().strip()
    normalized = re.sub(r"[^a-z\s]", " ", lowered)
    normalized = " ".join(normalized.split())
    if not normalized:
        return False
    if normalized in GREETING_WORDS:
        return True
    first_word = normalized.split(" ")[0]
    return first_word in {"hi", "hello", "hey", "salam", "assalamualaikum"}


def _is_wellbeing(message: str) -> bool:
    lowered = message.lower()
    return "how are you" in lowered or "how r you" in lowered


def _is_acknowledgement(message: str) -> bool:
    normalized = " ".join(re.sub(r"[^a-z\s]", " ", message.lower()).split())
    return normalized in {"ok", "okay", "great", "nice", "cool", "thanks", "thank you", "alright"}


def _is_capability_question(message: str) -> bool:
    lowered = message.lower()
    return any(
        phrase in lowered
        for phrase in (
            "what else can you do",
            "what can you do",
            "help me with",
            "your capabilities",
            "what services",
        )
    )


def _is_inventory_question(message: str) -> bool:
    lowered = message.lower()
    return (
        (
            "do you have" in lowered
            or "any agency" in lowered
            or "agencies in" in lowered
            or "show me the list" in lowered
            or "show list" in lowered
            or "list of real estate agencies" in lowered
        )
        and "scrape" not in lowered
    )


def _extract_location_hint(message: str) -> tuple[str | None, str | None]:
    city, country = _extract_city_country(message)
    if city or country:
        return city, country
    lowered = message.lower()
    match = re.search(r"in\s+([a-z][a-z\s\-.']+?)(?:\?|$)", lowered)
    if not match:
        return None, None
    raw = " ".join(match.group(1).split()).strip(" .,!?:;")
    if not raw:
        return None, None
    parts = [p.strip().title() for p in raw.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    # Single place mention is treated as country hint.
    return None, parts[0].title()


def _format_agency_table(rows: list) -> str:
    if not rows:
        return "No agencies found."
    header = "Name | City | Country | Website"
    divider = "--- | --- | --- | ---"
    lines = [header, divider]
    for r in rows[:10]:
        name = (r.name or "-").replace("|", " ")
        city = (r.city or "-").replace("|", " ")
        country = (r.country or "-").replace("|", " ")
        website = (r.website_url or "-").replace("|", " ")
        lines.append(f"{name} | {city} | {country} | {website}")
    return "\n".join(lines)


def _agency_to_dict(a) -> dict:
    pc = getattr(a, "property_categories", None)
    return {
        "id": str(a.id),
        "name": a.name,
        "city": a.city,
        "country": a.country,
        "website_url": a.website_url,
        "owner_name": a.owner_name,
        "founded_year": a.founded_year,
        "description": (a.description or "")[:1200] if a.description else None,
        "email": a.email,
        "phone": a.phone,
        "whatsapp": a.whatsapp,
        "facebook_url": a.facebook_url,
        "instagram_url": a.instagram_url,
        "linkedin_url": a.linkedin_url,
        "twitter_url": a.twitter_url,
        "google_rating": a.google_rating,
        "review_count": a.review_count,
        "specialization": a.specialization,
        "price_range_min": a.price_range_min,
        "price_range_max": a.price_range_max,
        "currency": a.currency,
        "total_listings": a.total_listings,
        "property_categories": list(pc) if pc else None,
        "logo_url": a.logo_url,
    }


def _property_to_dict(p) -> dict:
    return {
        "id": str(p.id),
        "title": p.title,
        "property_type": p.property_type,
        "category": p.category,
        "bedrooms": p.bedrooms,
        "bathroom_count": p.bathroom_count,
        "bedroom_sqm": p.bedroom_sqm,
        "bathroom_sqm": p.bathroom_sqm,
        "total_sqm": p.total_sqm,
        "price": p.price,
        "price_per_sqm": p.price_per_sqm,
        "currency": p.currency,
        "locality": p.locality,
        "district": p.district,
        "city": p.city,
        "country": p.country,
        "listing_url": p.listing_url,
    }


def _strip_noise_for_agency_search(text: str) -> str:
    t = text.strip().strip("?.!")
    t = re.sub(r"(?i)^(tell me about|what does|what do|what is|show me|give me|about)\s+", "", t)
    t = re.sub(
        r"(?i)\s+(offers?|offering|services?|service|contact|details?|information|info|phone|number|email|whatsapp)\??$",
        "",
        t,
    )
    return t.strip()


def _agency_names_from_chat_history(messages: list) -> list[str]:
    names: list[str] = []
    for m in reversed(messages[-12:]):
        if getattr(m, "role", None) != "assistant":
            continue
        meta = _meta_from_json(getattr(m, "meta_json", None))
        if meta:
            if meta.get("display") == "agency_table":
                for row in meta.get("rows") or []:
                    nm = row.get("name") if isinstance(row, dict) else None
                    if isinstance(nm, str) and nm.strip():
                        names.append(nm.strip())
            elif meta.get("display") == "agency_detail":
                ag = meta.get("agency") or {}
                if isinstance(ag, dict) and ag.get("name"):
                    names.append(str(ag["name"]).strip())
        for line in (m.content or "").splitlines():
            line = line.strip()
            if "|" not in line:
                continue
            if line.startswith("---"):
                continue
            if "Name" in line and ("City" in line or "Website" in line):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 2 and parts[0] and not parts[0].startswith("-"):
                names.append(parts[0])
    seen: set[str] = set()
    deduped: list[str] = []
    for nm in names:
        key = nm.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(nm)
    return deduped


def _score_name_match(user_text: str, agency_name: str) -> float:
    u = user_text.lower()
    n = agency_name.lower()
    if not n:
        return 0.0
    if n in u:
        return 1.0 + len(n) / 100.0
    # token overlap
    ut = set(re.findall(r"[a-z0-9]+", u))
    nt = set(re.findall(r"[a-z0-9]+", n))
    if not nt:
        return 0.0
    inter = len(ut & nt)
    return inter / max(len(nt), 1)


async def _resolve_agency_for_followup(
    db: AsyncSession,
    text: str,
    messages: list,
):
    """Match user message to a single agency (name search + recent table context)."""
    cleaned = _strip_noise_for_agency_search(text)
    if len(cleaned) < 3:
        cleaned = text.strip().strip("?.!")

    candidates: list[tuple[float, object]] = []

    # Search progressively shorter prefixes
    words = cleaned.split()
    for n in range(min(len(words), 12), 1, -1):
        phrase = " ".join(words[:n]).strip()
        if len(phrase) < 3:
            continue
        rows = await crud.get_agencies(db, search=phrase, page=1, limit=15)
        for r in rows:
            score = _score_name_match(cleaned, r.name or "") + 0.05 * n
            candidates.append((score, r))
        if rows and len(rows) == 1:
            return rows[0]

    # Names mentioned in recent assistant tables
    for nm in _agency_names_from_chat_history(messages):
        rows = await crud.get_agencies(db, search=nm[:80], page=1, limit=10)
        for r in rows:
            if r.name and nm.lower() in r.name.lower():
                candidates.append((2.0 + len(nm) / 50.0, r))

    if not candidates:
        return None

    best_by_id: dict[str, tuple[float, object]] = {}
    for score, r in candidates:
        rid = str(r.id)
        if rid not in best_by_id or score > best_by_id[rid][0]:
            best_by_id[rid] = (score, r)

    merged = list(best_by_id.values())
    merged.sort(key=lambda x: -x[0])
    best_score, best = merged[0]
    if best_score < 0.28 and len(merged) > 4:
        return None
    return best


def _build_agency_detail_reply_text(agency_dict: dict, props: list[dict], user_question: str) -> str:
    """Natural-language summary; structured data lives in message_meta."""
    name = agency_dict.get("name") or "This agency"
    parts = [
        f"Here is what we have on record for {name} (from our scraped database).",
        "",
        "Snapshot",
        f"- Location: {agency_dict.get('city') or '—'}, {agency_dict.get('country') or '—'}",
    ]
    if agency_dict.get("google_rating") is not None:
        rc = agency_dict.get("review_count")
        parts.append(f"- Google rating: {agency_dict['google_rating']}" + (f" ({rc} reviews)" if rc else ""))
    if agency_dict.get("owner_name"):
        parts.append(f"- Leadership / contact name: {agency_dict['owner_name']}")
    if agency_dict.get("specialization"):
        parts.append(f"- Focus: {agency_dict['specialization']}")
    pmn, pmx = agency_dict.get("price_range_min"), agency_dict.get("price_range_max")
    cur = agency_dict.get("currency") or "EUR"
    if pmn is not None and pmx is not None:
        parts.append(f"- Typical price band (where extracted): {cur} {float(pmn):,.0f} – {float(pmx):,.0f}")

    parts.append("")
    parts.append("Contact & web")
    parts.append(f"- Website: {agency_dict.get('website_url') or '—'}")
    em = agency_dict.get("email") or []
    ph = agency_dict.get("phone") or []
    if em:
        parts.append(f"- Email: {', '.join(em[:3])}")
    if ph:
        parts.append(f"- Phone: {', '.join(ph[:3])}")
    if agency_dict.get("whatsapp"):
        parts.append(f"- WhatsApp: {agency_dict['whatsapp']}")

    social_bits = []
    for key, label in (
        ("facebook_url", "Facebook"),
        ("instagram_url", "Instagram"),
        ("linkedin_url", "LinkedIn"),
        ("twitter_url", "X/Twitter"),
    ):
        if agency_dict.get(key):
            social_bits.append(f"{label}: {agency_dict[key]}")
    if social_bits:
        parts.append("")
        parts.append("Social")
        parts.extend(f"- {s}" for s in social_bits[:6])

    lowered = user_question.lower()
    if props:
        parts.append("")
        parts.append(
            f"Listings ({len(props)} shown) — bedrooms, bathrooms, sizes, locality and pricing are in the table below when extracted."
        )
        if any(k in lowered for k in ("offer", "listing", "property", "price", "bedroom")):
            parts.append("You asked about offers — these rows are the properties we indexed for this agency.")
    else:
        parts.append("")
        parts.append(
            "Properties — No individual listings were extracted yet for this agency; only agency-level fields above may be available."
        )

    parts.append("")
    parts.append("Tip: ask follow-ups like “3-bedroom only” or “under 500k” when listing data exists.")

    return "\n".join(parts)


async def _try_agency_detail_response(
    db: AsyncSession,
    text: str,
    messages: list,
):
    if _is_inventory_question(text):
        return None
    lowered_confirm = text.strip().lower()
    if lowered_confirm in {"yes", "yes please", "confirm", "go ahead", "proceed", "ok", "okay", "y"}:
        return None
    agency = await _resolve_agency_for_followup(db, text, messages)
    if not agency:
        return None

    agency_dict = _agency_to_dict(agency)
    props_orm = await crud.get_properties(db, agency_id=str(agency.id), page=1, limit=25)
    props = [_property_to_dict(p) for p in props_orm]

    reply = _build_agency_detail_reply_text(agency_dict, props, text)
    meta = {
        "display": "agency_detail",
        "agency": agency_dict,
        "properties": props,
    }
    return reply, meta, "agency_detail"


def _build_summary_text(messages: list) -> str:
    bullets = []
    for m in messages[-SUMMARY_REFRESH_THRESHOLD:]:
        role = "User" if m.role == "user" else "Agent"
        short = m.content.replace("\n", " ").strip()
        if len(short) > 140:
            short = f"{short[:137]}..."
        bullets.append(f"- {role}: {short}")
    return "Compressed context snapshot:\n" + "\n".join(bullets)


async def _refresh_summary_if_needed(db: AsyncSession, thread_id: str, messages: list) -> None:
    if len(messages) < SUMMARY_REFRESH_THRESHOLD:
        return
    latest = await crud.get_latest_chat_summary(db, thread_id)
    if latest and latest.message_count >= len(messages):
        return
    summary = _build_summary_text(messages[:-RAW_TURN_WINDOW] if len(messages) > RAW_TURN_WINDOW else messages)
    await crud.create_chat_summary(db, thread_id, summary=summary, message_count=len(messages))


@router.post("/threads", response_model=ChatThreadOut)
async def create_thread(payload: ChatThreadCreateRequest, db: AsyncSession = Depends(get_db)):
    thread = await crud.create_chat_thread(db, title=payload.title or "New Chat")
    return ChatThreadOut.model_validate(thread)


@router.get("/threads", response_model=list[ChatThreadOut])
async def list_threads(db: AsyncSession = Depends(get_db)):
    threads = await crud.list_chat_threads(db)
    out: list[ChatThreadOut] = []
    for t in threads:
        msgs = await crud.list_chat_messages(db, str(t.id), limit=1)
        preview = msgs[0].content[:80] if msgs else None
        out.append(
            ChatThreadOut(
                id=t.id,
                title=t.title,
                archived=t.archived,
                created_at=t.created_at,
                updated_at=t.updated_at,
                last_message_preview=preview,
            )
        )
    return out


@router.patch("/threads/{thread_id}", response_model=ChatThreadOut)
async def update_thread(thread_id: str, payload: ChatThreadUpdateRequest, db: AsyncSession = Depends(get_db)):
    thread = await crud.update_chat_thread(db, thread_id, title=payload.title, archived=payload.archived)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ChatThreadOut.model_validate(thread)


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await crud.delete_chat_thread(db, thread_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Thread not found")


@router.delete("/threads", response_model=ClearAllThreadsResponse)
async def clear_all_threads(db: AsyncSession = Depends(get_db)):
    count = await crud.clear_all_chat_threads(db)
    return ClearAllThreadsResponse(deleted_count=count)


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageOut])
async def list_messages(thread_id: str, db: AsyncSession = Depends(get_db)):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    messages = await crud.list_chat_messages(db, thread_id)
    return [
        ChatMessageOut(
            id=m.id,
            thread_id=m.thread_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            meta=_meta_from_json(m.meta_json),
        )
        for m in messages
    ]


@router.get("/threads/{thread_id}/tool-runs", response_model=list[ChatToolRunOut])
async def list_tool_runs(thread_id: str, db: AsyncSession = Depends(get_db)):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    runs = await crud.list_chat_tool_runs(db, thread_id)
    return [
        ChatToolRunOut(
            id=r.id,
            thread_id=r.thread_id,
            message_id=r.message_id,
            tool_name=r.tool_name,
            tool_args=_meta_from_json(r.tool_args_json),
            rationale=r.rationale,
            status=r.status,
            output=_meta_from_json(r.output_json),
            created_at=r.created_at,
        )
        for r in runs
    ]


@router.post("/threads/{thread_id}/messages", response_model=ChatReplyOut)
async def send_message(
    thread_id: str,
    payload: ChatMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    thread = await crud.get_chat_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    text = payload.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    user_message = await crud.create_chat_message(db, thread_id, "user", text)
    messages = await crud.list_chat_messages(db, thread_id)
    await _refresh_summary_if_needed(db, thread_id, messages)

    lowered = text.lower()
    wants_scrape = any(k in lowered for k in ("scrape", "find agencies", "real estate agencies", "crawl"))
    yes_confirm = lowered in {"yes", "yes please", "confirm", "go ahead", "proceed", "ok"}

    latest_summary = await crud.get_latest_chat_summary(db, thread_id)
    summary_out = (
        ChatSummaryOut(summary=latest_summary.summary, message_count=latest_summary.message_count)
        if latest_summary
        else None
    )

    last_assistant = next((m for m in reversed(messages) if m.role == "assistant"), None)
    last_meta = _meta_from_json(last_assistant.meta_json) if last_assistant else {}
    pending = last_meta.get("pending_scrape") if last_meta else None

    action = "unsupported"
    reply = (
        "I am your real-estate research agent. Share any city and country, and I will plan the scrape, "
        "confirm scope with you, then execute it professionally."
    )
    job = None
    assistant_meta = None

    agency_detail_result = await _try_agency_detail_response(db, text, messages)

    if pending and yes_confirm:
        city, country = pending["city"], pending["country"]
        tool_run = await crud.create_chat_tool_run(
            db,
            thread_id=thread_id,
            message_id=str(user_message.id),
            tool_name="enqueue_scrape_job",
            tool_args={"city": city, "country": country},
            rationale="User confirmed scrape execution.",
            status="started",
        )
        queued = await enqueue_scrape_job(city, country, background_tasks)
        tool_run.status = "success"
        tool_run.output_json = json.dumps({"job_id": queued["job_id"], "status": queued["status"]})
        await db.commit()
        job = ScrapeStatus(**queued)
        action = "start_scrape"
        reply = f"Confirmed. Started scraping agencies in {city}, {country}. Job ID: {job.job_id}"
    elif settings.openai_api_key and getattr(settings, "use_aria_agent", True):
        try:
            from backend.ai.aria_agent import run_aria_turn

            reply_ar, meta_ar, action_ar = await run_aria_turn(db, text, messages)
            merged_ar = {**meta_ar, "action": action_ar}
            await crud.create_chat_message(db, thread_id, "assistant", reply_ar, meta=merged_ar)
            return ChatReplyOut(
                reply=reply_ar,
                action=action_ar,
                job=None,
                context_summary=summary_out,
                recent_turns_used=min(len(messages), RAW_TURN_WINDOW),
                message_meta=merged_ar,
            )
        except Exception as exc:
            logger.warning("ARIA turn failed, using rule-based chat: %s", exc)
    elif _is_greeting(text):
        action = "greeting"
        reply = (
            "Hello, great to work with you. I am your real-estate intelligence agent. "
            "Tell me the target market (city + country), and I will scrape top agencies, then guide you through results."
        )
    elif _is_wellbeing(text):
        action = "small_talk"
        reply = (
            "Doing great, thank you. I am ready to assist with market intelligence. "
            "If you share a city and country, I can immediately help you discover agencies and opportunities."
        )
    elif _is_acknowledgement(text):
        action = "acknowledged"
        reply = (
            "Perfect. Whenever you are ready, send the location and objective, "
            "for example: 'Scrape agencies in Valletta, Malta'."
        )
    elif _is_capability_question(text):
        action = "capabilities"
        reply = (
            "I can help with three things: 1) discover and scrape agencies in a target market, "
            "2) monitor scraping progress live, and 3) guide you to agencies, properties, and pricing insights. "
            "Share a city and country, and I will start from there."
        )
    elif agency_detail_result:
        reply, assistant_meta, action = agency_detail_result
    elif _is_inventory_question(text):
        city, country = _extract_location_hint(text)
        rows = await crud.get_agencies(
            db,
            city=city,
            country=country,
            search=None,
            page=1,
            limit=15,
        )
        if rows:
            places = ", ".join(sorted({p for p in [rows[0].city, rows[0].country] if p}))
            reply = (
                f"Found {len(rows)} agencies in {places or 'that market'}. "
                "Details are in the table below — ask about any agency by name for contacts, listings, and pricing."
            )
            assistant_meta = {
                "display": "agency_table",
                "caption": f"{len(rows)} agencies",
                "columns": [
                    {"key": "name", "label": "Agency"},
                    {"key": "city", "label": "City"},
                    {"key": "country", "label": "Country"},
                    {"key": "website_url", "label": "Website"},
                ],
                "rows": [_agency_to_dict(r) for r in rows],
            }
            action = "inventory_found"
        else:
            location_label = ", ".join([v for v in [city, country] if v]) or "that market"
            if city and country:
                tool_run = await crud.create_chat_tool_run(
                    db,
                    thread_id=thread_id,
                    message_id=str(user_message.id),
                    tool_name="enqueue_scrape_job",
                    tool_args={"city": city, "country": country},
                    rationale="No local agencies found; auto-starting scrape for list request.",
                    status="started",
                )
                queued = await enqueue_scrape_job(city, country, background_tasks)
                tool_run.status = "success"
                tool_run.output_json = json.dumps({"job_id": queued["job_id"], "status": queued["status"]})
                await db.commit()
                job = ScrapeStatus(**queued)
                action = "start_scrape"
                reply = (
                    f"I could not find existing agencies for {location_label}, so I have started a fresh scrape. "
                    f"Job ID: {job.job_id}. I will share the list as soon as scraping completes."
                )
            elif country and not city:
                action = "needs_location"
                reply = (
                    f"I did not find agencies for {country} yet. To run scraping, please share a city in {country} "
                    "(example: Valletta, Malta)."
                )
            else:
                action = "needs_location"
                reply = (
                    "Please share city and country so I can check existing agencies first, "
                    "then scrape automatically if needed."
                )
    elif wants_scrape:
        city, country = _extract_city_country(text)
        if city and country:
            action = "needs_confirmation"
            reply = (
                f"Understood. You want agency intelligence for {city}, {country}. "
                "Please confirm and I will launch scraping immediately. Reply with 'yes' to proceed."
            )
            assistant_meta = {"pending_scrape": {"city": city, "country": country}}
        else:
            action = "needs_location"
            reply = (
                "Happy to help. Please share both city and country so I can run a precise market scrape. "
                "Example: 'Scrape real estate agencies in Doha, Qatar'."
            )
    elif pending:
        action = "awaiting_confirmation"
        reply = (
            f"I am ready to execute for {pending['city']}, {pending['country']}. "
            "Reply 'yes' to proceed, or send a revised city/country and I will adjust."
        )

    await crud.create_chat_message(db, thread_id, "assistant", reply, meta=assistant_meta)
    return ChatReplyOut(
        reply=reply,
        action=action,
        job=job,
        context_summary=summary_out,
        recent_turns_used=min(len(messages), RAW_TURN_WINDOW),
        message_meta=assistant_meta,
    )
