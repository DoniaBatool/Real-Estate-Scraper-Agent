import json
import logging
import redis.asyncio as aioredis
from backend.config import settings

logger = logging.getLogger(__name__)

URL_TTL_SECONDS = 7 * 24 * 60 * 60   # 7 days
JOB_TTL_SECONDS = 24 * 60 * 60        # 1 day

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        if not settings.redis_url:
            raise RuntimeError("REDIS_URL is not configured in backend/.env")
        _redis = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


async def is_url_scraped(url: str) -> bool:
    """Return True if this URL was scraped within the last 7 days."""
    try:
        r = _get_redis()
        return await r.exists(f"scraped:{url}") > 0
    except Exception as exc:
        logger.warning("Redis is_url_scraped error: %s", exc)
        return False


async def mark_url_scraped(url: str) -> None:
    """Mark a URL as scraped with a 7-day TTL."""
    try:
        r = _get_redis()
        await r.setex(f"scraped:{url}", URL_TTL_SECONDS, "1")
    except Exception as exc:
        logger.warning("Redis mark_url_scraped error: %s", exc)


async def set_job_status(job_id: str, data: dict) -> None:
    """Persist job progress dict to Redis with a 24-hour TTL."""
    try:
        r = _get_redis()
        await r.setex(f"job:{job_id}", JOB_TTL_SECONDS, json.dumps(data))
    except Exception as exc:
        logger.warning("Redis set_job_status error: %s", exc)


async def get_job_status(job_id: str) -> dict | None:
    """Retrieve job progress from Redis. Returns None if not found."""
    try:
        r = _get_redis()
        raw = await r.get(f"job:{job_id}")
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis get_job_status error: %s", exc)
    return None
