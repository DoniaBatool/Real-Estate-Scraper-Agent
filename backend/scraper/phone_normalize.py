"""Decode tel: / scraped phone strings that still contain URL escapes (e.g. %20 for space)."""

from __future__ import annotations

from urllib.parse import unquote


def normalize_phone_display(value: object | None) -> str | None:
    if value is None:
        return None
    t = str(value).strip()
    if not t:
        return None
    prev = None
    while prev != t and "%" in t:
        prev = t
        try:
            t = unquote(t)
        except Exception:
            break
    return t.strip() or None
