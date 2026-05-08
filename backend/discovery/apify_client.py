import logging
from apify_client import ApifyClient

logger = logging.getLogger(__name__)

# Apify's official Google Places / Maps actor
APIFY_ACTOR = "compass/crawler-google-places"


def discover_agencies_sync(city: str, country: str) -> list[dict]:
    """
    Synchronous call to the Apify Google Places actor.
    Called via run_in_executor from async code (apify-client SDK is blocking).
    """
    # Import inside thread to get a fresh Settings read
    from backend.config import Settings
    cfg = Settings()

    if not cfg.apify_api_token:
        logger.warning("APIFY_API_TOKEN not set — returning empty agency list")
        return []

    client = ApifyClient(cfg.apify_api_token)
    search_query = f"real estate agency {city} {country}"
    logger.info("Apify discovery: %s (actor: %s)", search_query, APIFY_ACTOR)

    run = client.actor(APIFY_ACTOR).call(
        run_input={
            "searchStringsArray": [search_query],
            "maxCrawledPlacesPerSearch": 50,
            "language": "en",
            "maxReviews": 0,
            "exportPlaceUrls": False,
        }
    )

    dataset_id = (run or {}).get("defaultDatasetId")
    if not dataset_id:
        logger.warning("Apify returned no dataset ID")
        return []

    agencies: list[dict] = []
    for item in client.dataset(dataset_id).iterate_items():
        website = (item.get("website") or "").strip()
        if not website:
            continue
        if not website.startswith("http"):
            website = "https://" + website

        agencies.append({
            "name": item.get("title") or item.get("name") or "",
            "address": item.get("address") or "",
            "phone": item.get("phone") or item.get("phoneUnformatted") or "",
            "google_rating": item.get("totalScore"),
            "review_count": item.get("reviewsCount"),
            "website_url": website,
            "city": city,
            "country": country,
        })

    logger.info("Apify found %d agencies with websites", len(agencies))
    return agencies
