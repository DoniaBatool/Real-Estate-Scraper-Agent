"""
Extract property listing reference tokens from raw HTML.

Combines:
1) Regex on raw HTML (labels like Reference:, REF:, Listing #)
2) DOM/CSS hooks where label and value are split across nodes (e.g. <span class="reference-number">).

Used by workbench crawl harvest and universal_extractor deterministic path.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

# Use \\bRef\\b / \\bReference\\b — NOT "ref.?" which matches the start of "Refined" and captures "ined".
_REF_HTML_EXTRACTION_PATTERNS = (
    re.compile(
        r"(?:\bReference\b|\bRef\b|listing\s*#|property\s*#)\s*[:#]?\s*"
        r"([A-Za-z0-9][A-Za-z0-9\-_/]{2,40})\b",
        re.I,
    ),
    # "Ref | 66338" (pipe-separated, common on Malta agency sites)
    re.compile(r"\bRef\s*\|\s*([A-Za-z0-9][A-Za-z0-9\-]{2,40})\b", re.I),
    re.compile(r"\bReference\s*\|\s*([A-Za-z0-9][A-Za-z0-9\-]{2,40})\b", re.I),
    # "Property ID: bd199e03" or "Property ID 33020"
    re.compile(
        r"\bProperty\s*ID\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,40})\b",
        re.I,
    ),
)


def token_plausible_property_reference(token: str) -> bool:
    t = token.strip()
    if len(t) < 4 or len(t) > 48:
        return False
    if re.fullmatch(r"\d{4}", t) and 1900 <= int(t) <= 2035:
        return False
    if t.isdigit():
        # 4-digit refs (e.g. "Ref | 5823") — reject only obvious years.
        if len(t) == 4 and 1900 <= int(t) <= 2035:
            return False
        return 4 <= len(t) <= 12
    # Fragments from words like "Ref**ined**" when old regex matched "Ref" loosely
    if 3 <= len(t) <= 5 and t.isalpha() and t.islower():
        return False
    return True


def _extract_ref_label_from_text_chunk(text: str) -> str | None:
    """Pull token after Ref:/Reference: in visible text (merged across tags)."""
    if not text:
        return None
    m_pipe = re.search(r"\bRef\s*\|\s*([A-Za-z0-9][A-Za-z0-9\-]{2,20})\b", text, re.I)
    if m_pipe:
        cand = m_pipe.group(1).strip()
        if token_plausible_property_reference(cand):
            return cand
    m_pid = re.search(r"\bProperty\s*ID\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,40})\b", text, re.I)
    if m_pid:
        cand = m_pid.group(1).strip()
        if token_plausible_property_reference(cand):
            return cand
    m = re.search(
        r"(?:\bReference\b|\bRef\b)\s*[:#]?\s*"
        r"([A-Za-z0-9][A-Za-z0-9\-_/]{2,48})(?:\s|$|[.,;:!?)])",
        text,
        re.I,
    )
    if m:
        cand = m.group(1).strip()
        if token_plausible_property_reference(cand):
            return cand
    return None


def _collect_from_soup(soup: BeautifulSoup, out: set[str]) -> None:
    # data-* (many themes expose ref only here)
    for attr in (
        "data-reference",
        "data-ref",
        "data-listing-id",
        "data-property-ref",
        "data-listing-ref",
        "data-property-id",
        "data-listing-reference",
    ):
        for el in soup.select(f"[{attr}]"):
            v = (el.get(attr) or "").strip()
            if token_plausible_property_reference(v):
                out.add(v)

    # Direct value nodes (Quality Home–style: <span class="reference-number">90-9269064</span>)
    for sel in ("span.reference-number", ".reference-number"):
        for el in soup.select(sel):
            t = el.get_text(strip=True)
            if token_plausible_property_reference(t):
                out.add(t)

    # Wrapper blocks: " Ref: " + child span — get_text merges for regex below
    for el in soup.select("h6.ref-num, .ref-num, [class*='ref-num']"):
        merged = el.get_text(" ", strip=True)
        hit = _extract_ref_label_from_text_chunk(merged)
        if hit:
            out.add(hit)

    # Simon Mamo–style: <span>Ref | </span><span class="yellow-text">66338</span>
    for wrap in soup.select(".property-title-price-wrap, .item-price-wrap, [class*='property-title']"):
        merged = wrap.get_text(" ", strip=True)
        m_pipe = re.search(r"\bRef\s*\|\s*([A-Za-z0-9][A-Za-z0-9\-]{2,20})\b", merged, re.I)
        if m_pipe:
            cand = m_pipe.group(1).strip()
            if token_plausible_property_reference(cand):
                out.add(cand)
        for span in wrap.select("span.yellow-text, .yellow-text"):
            t = span.get_text(strip=True)
            if token_plausible_property_reference(t):
                out.add(t)

    # Badge style: <small>Ref: FA701973</small>
    for sm in soup.find_all("small"):
        merged = sm.get_text(" ", strip=True)
        hit = _extract_ref_label_from_text_chunk(merged)
        if hit:
            out.add(hit)

    # meta / JSON-LD hints (optional)
    for meta in soup.select('meta[itemprop="sku"], meta[property="product:retailer_item_id"]'):
        c = (meta.get("content") or "").strip()
        if token_plausible_property_reference(c):
            out.add(c)


def collect_reference_tokens_from_html(html: str | None) -> set[str]:
    """All candidate reference strings found in HTML (regex + DOM)."""
    if not html:
        return set()
    out: set[str] = set()

    for rx in _REF_HTML_EXTRACTION_PATTERNS:
        for m in rx.finditer(html):
            cand = (m.group(1) or "").strip()
            if token_plausible_property_reference(cand):
                out.add(cand)

    try:
        soup = BeautifulSoup(html, "html.parser")
        _collect_from_soup(soup, out)
    except Exception:
        pass

    return out
