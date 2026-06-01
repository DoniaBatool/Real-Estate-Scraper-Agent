"""Parse real addresses out of mailto: hrefs and strip junk query-only strings."""

from __future__ import annotations

import re
from urllib.parse import unquote

_EMAIL_IN_TEXT = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def parse_mailto_email_address(value: object | None) -> str | None:
    """
    Return a single email if present.

    - mailto:user@x.com?subject=… → user@x.com
    - mailto:?subject=… (no address) → None
    - Raw ?subject=… junk → None
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    low = s.lower()
    if low.startswith("mailto:"):
        s = s[7:]
    if s.startswith("?"):
        return None
    addr_part = s.split("?", 1)[0].strip()
    if not addr_part:
        return None
    try:
        addr_part = unquote(addr_part)
    except Exception:
        pass
    m = _EMAIL_IN_TEXT.search(addr_part)
    return m.group(0).strip() if m else None


def sanitize_email_field(value: object | None) -> str | None:
    """
    Prefer mailto parsing; if the whole string is a mailto-like blob with no addr,
    return None instead of leaving subject=/body= query text in the email column.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    parsed = parse_mailto_email_address(s)
    if parsed:
        return parsed
    low = s.lower()
    if "subject=" in low or "body=" in low or s.startswith("?"):
        return None
    m = _EMAIL_IN_TEXT.search(s)
    return m.group(0).strip() if m else None
