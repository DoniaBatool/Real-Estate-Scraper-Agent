"""
Deterministic extraction from raw HTML: footer/header social links, emails, listing URLs.
Supplements LLM extraction when the model misses footer-only links or href patterns.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urldefrag, urljoin, urlparse

# href="..." or href='...'
_HREF_RE = re.compile(r"""href\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)

# Property / listing URL path hints (English + common EU patterns)
_LISTING_PATH = re.compile(
    r"""(?ix)
    /(property|properties|listing|listings|for-sale|for-rent|sale|rent|rentals|lettings|buy|sell|
       details|detail|immobil|annunci|maison|appartement|wohnung|anzeige|objekt|objekte|inserat|
       apartment|villas?|houses?|townhouse|penthouse|studio)(?:/|$)
    """
)

_NUM_SLUG = re.compile(r"/\d{3,}(?:[/_-][a-z0-9-]+)?/?$", re.I)

# Locale prefix + catalog-only slug → listing index / archive, not a single property page.
_LOCALE_PREFIX_SEG = frozenset(
    {"en", "de", "fr", "it", "es", "mt", "nl", "pl", "ru", "ar", "zh", "pt", "ro", "tr", "uk"}
)

# Path segments (last or meaningful) that are navigation/catalog hubs, not listing refs or detail slugs.
_CATALOG_INDEX_SEGMENTS = frozenset(
    {
        "properties",
        "property",
        "listings",
        "listing",
        "for-sale",
        "for-rent",
        "sale",
        "rent",
        "buy",
        "sell",
        "search",
        "catalog",
        "catalogue",
        "all-properties",
        "properties-for-sale",
        "properties-for-rent",
        "property-for-sale",
        "property-for-rent",
        "malta-property-for-sale",
        "malta-property-for-rent",
        "commercial-property",
        "commercial-property-for-rent-in-malta",
        "favourites",
        "favorites",
    }
)

# WordPress / SEO locality hubs: grid of many listings on one URL.
_LOCALITY_GRID_PATH = re.compile(
    r"(/properties-for-(?:sale|rent)-in-"
    r"|/properties-to-rent-in-|/properties-to-buy-in-"
    r"|/penthouses-for-(?:sale|rent)-"
    r"|/apartments-for-(?:sale|rent)-"
    r"|/locations/properties)",
    re.I,
)

# Strong signals we still want even if the path also matched broad listing keywords.
_DETAIL_PAGE_OVERRIDE = re.compile(
    r"""(?ix)
    /property/[\w.-]*\d{3,}
    | /properties/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
    | /listing/[\w.-]*\d{4,}
    | /listings/[0-9a-f]{8}-[0-9a-f]{4}-
    | /rooms/\d{6,}
    """
)

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

_SOCIAL = [
    ("facebook_url", re.compile(r"https?://(?:www\.)?facebook\.com/[a-zA-Z0-9._/-]+", re.I)),
    ("instagram_url", re.compile(r"https?://(?:www\.)?instagram\.com/[a-zA-Z0-9._/-]+", re.I)),
    ("linkedin_url", re.compile(r"https?://(?:www\.)?linkedin\.com/(?:company|in)/[a-zA-Z0-9._/-]+", re.I)),
    ("twitter_url", re.compile(r"https?://(?:www\.)?(?:twitter|x)\.com/[a-zA-Z0-9_]+", re.I)),
]


def _strip_www(host: str) -> str:
    return host[4:] if host.startswith("www.") else host


def url_fingerprint(abs_url: str, base_url: str) -> str:
    """Stable key for deduping listing URLs."""
    full = urljoin(base_url, abs_url.strip())
    full, _ = urldefrag(full)
    p = urlparse(full)
    netloc = _strip_www((p.netloc or "").lower())
    path = (p.path or "/").rstrip("/") or "/"
    query = p.query or ""
    return f"{netloc}{path}?{query}"


def extract_footer_signals(html: str, base_url: str) -> dict:
    """
    Pull emails and social profile URLs from visible anchors anywhere in HTML
    (footer-heavy sites often repeat these in header/footer).
    """
    out: dict = {
        "email": [],
        "facebook_url": None,
        "instagram_url": None,
        "linkedin_url": None,
        "twitter_url": None,
        "whatsapp": None,
    }
    if not html:
        return out

    for em in _EMAIL_RE.findall(html):
        low = em.lower()
        if low.endswith((".png", ".jpg", ".gif")):
            continue
        if em not in out["email"]:
            out["email"].append(em)

    for key, rx in _SOCIAL:
        m = rx.search(html)
        if m:
            url = m.group(0).split('"')[0].split("'")[0].rstrip("\\)")
            if url and not out[key]:
                out[key] = url

    # WhatsApp wa.me or api.whatsapp.com
    wa = re.search(
        r"https?://(?:api\.)?whatsapp\.com/send\?phone=\d+|https?://wa\.me/\d+",
        html,
        re.I,
    )
    if wa:
        out["whatsapp"] = wa.group(0)

    return out


def _looks_like_listing_path(path: str, query: str) -> bool:
    combined = f"{path}?{query}"
    if _LISTING_PATH.search(combined):
        return True
    if _NUM_SLUG.search(path or ""):
        return True
    return False


def path_has_listing_id_query(query: str) -> bool:
    """True when query clearly identifies one listing (not ?page= or tiny ids)."""
    for k, v in parse_qsl(query or "", keep_blank_values=True):
        kl = k.lower()
        vs = (v or "").strip()
        if not vs or len(vs) < 3:
            continue
        if kl in (
            "ref",
            "reference",
            "refs",
            "listing_id",
            "listingid",
            "listing-id",
            "property_id",
            "propertyid",
            "property-id",
            "listing_ref",
            "referenceno",
        ):
            return True
        if kl == "id" and len(vs) >= 8 and re.match(r"^[a-z0-9._-]+$", vs, re.I):
            return True
    return False


def looks_like_single_property_detail_path(path: str, query: str = "") -> bool:
    """
    True for URLs that clearly point at one listing (even if the path also says 'property').
    Used to keep /property/sm-12345/… while dropping /properties-for-sale hub pages.
    """
    if path_has_listing_id_query(query or ""):
        return True
    p = path or ""
    low = p.lower()
    if _DETAIL_PAGE_OVERRIDE.search(low):
        return True
    if re.search(
        r"/(?:property|properties|listing|listings)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:/|$)",
        low,
    ):
        return True
    # Simon Mamo–style: /property/sm-11434/slug/ or /property/sm-27296
    if re.search(r"/property/[A-Za-z]{0,12}-?\d{4,}(?:/|$)", low):
        return True
    return False


def is_likely_listing_catalog_index_path(path: str) -> bool:
    """
    True when the URL path is a search/archive hub (many listings), not one property.
    These should not be queued for full extract or shown as the 'Open' detail URL.
    """
    raw = (path or "").strip() or "/"
    norm = raw.rstrip("/") or "/"
    low = norm.lower()
    if _LOCALITY_GRID_PATH.search(low):
        return True
    segs = [s for s in norm.split("/") if s]
    if not segs:
        return False
    last = segs[-1].lower()
    # /en/properties, /mt/properties-for-sale
    if len(segs) == 2 and segs[0].lower() in _LOCALE_PREFIX_SEG and last in _CATALOG_INDEX_SEGMENTS:
        return True
    # /malta/properties, /locations/properties-to-rent-in-naxxar (last may be long — locality grid)
    if len(segs) == 2 and last in _CATALOG_INDEX_SEGMENTS:
        return True
    if len(segs) == 1 and last in _CATALOG_INDEX_SEGMENTS:
        return True
    # Single long slug that is clearly a hub page (not a unique listing slug).
    hub_slug = re.compile(
        r"^(malta-)?property-for-(sale|rent)$|"
        r"^properties-for-(sale|rent)(-in-[a-z-]+)?$|^all-properties$|^commercial-property$",
        re.I,
    )
    if len(segs) == 1 and hub_slug.match(last):
        return True
    return False


def should_skip_href_for_property_extract(path: str, query: str) -> bool:
    """Filter catalogue/index links from workbench property candidate lists."""
    if looks_like_single_property_detail_path(path, query):
        return False
    return is_likely_listing_catalog_index_path(path)


def reference_slug_looks_like_catalog_hub(slug: str) -> bool:
    """True when a path segment looks like a listings index label, not a ref (e.g. 'properties-for-sale')."""
    s = (slug or "").strip().lower()
    if not s:
        return True
    if s in _CATALOG_INDEX_SEGMENTS:
        return True
    if re.match(r"^(malta-)?property-for-(sale|rent)$", s):
        return True
    if re.match(r"^properties-for-(sale|rent)(-in-[a-z0-9-]+)?$", s):
        return True
    if re.match(r"^penthouses-for-(sale|rent)(-in-[a-z0-9-]+)?$", s):
        return True
    if re.match(r"^apartments-for-(sale|rent)(-in-[a-z0-9-]+)?$", s):
        return True
    return False


def _bad_asset(path: str) -> bool:
    low = path.lower()
    return any(
        low.endswith(suf)
        for suf in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".css", ".js", ".ico", ".zip")
    )


def discover_listing_urls(html: str, base_url: str, max_urls: int = 40) -> list[str]:
    """Same-domain hrefs that plausibly point to individual property detail pages (not catalogue hubs)."""
    if not html or not base_url:
        return []

    base = urlparse(base_url)
    base_host = _strip_www((base.netloc or "").lower())
    found: list[str] = []
    seen: set[str] = set()

    for m in _HREF_RE.finditer(html):
        raw = (m.group(1) or m.group(2) or "").strip()
        if not raw or raw.startswith("#") or raw.lower().startswith("javascript"):
            continue
        if raw.lower().startswith(("mailto:", "tel:", "sms:", "javascript:")):
            continue

        full = urljoin(base_url, raw)
        full, _ = urldefrag(full)
        p = urlparse(full)
        if _strip_www((p.netloc or "").lower()) != base_host:
            continue

        path = p.path or ""
        if _bad_asset(path):
            continue
        if "/wp-content/" in path.lower() or "/cdn/" in path.lower():
            continue

        if not _looks_like_listing_path(path, p.query or ""):
            continue
        if should_skip_href_for_property_extract(path, p.query or ""):
            continue

        fp = url_fingerprint(full, base_url)
        if fp in seen:
            continue
        seen.add(fp)
        found.append(full)
        if len(found) >= max_urls:
            break

    return found


def merge_footer_into_extracted(extracted: dict, footer: dict) -> None:
    """Mutates extracted in place; never overwrites non-empty AI fields with empties."""
    for key in ("facebook_url", "instagram_url", "linkedin_url", "twitter_url", "whatsapp"):
        ai_val = extracted.get(key)
        sig_val = footer.get(key)
        if sig_val and not ai_val:
            extracted[key] = sig_val

    ai_emails = extracted.get("email") or []
    if isinstance(ai_emails, str):
        ai_emails = [ai_emails]
    sig_emails = footer.get("email") or []
    merged = list(dict.fromkeys([*(ai_emails or []), *sig_emails]))
    if merged:
        extracted["email"] = merged
