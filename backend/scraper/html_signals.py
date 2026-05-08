"""
Deterministic extraction from raw HTML: footer/header social links, emails, listing URLs.
Supplements LLM extraction when the model misses footer-only links or href patterns.
"""
from __future__ import annotations

import re
from urllib.parse import urldefrag, urljoin, urlparse

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


def _bad_asset(path: str) -> bool:
    low = path.lower()
    return any(
        low.endswith(suf)
        for suf in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".css", ".js", ".ico", ".zip")
    )


def discover_listing_urls(html: str, base_url: str, max_urls: int = 40) -> list[str]:
    """Same-domain hrefs that plausibly point to individual listing or catalog detail pages."""
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
