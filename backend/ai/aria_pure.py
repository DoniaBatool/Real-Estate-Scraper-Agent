"""
aria_pure.py — Pure logic functions with NO external dependencies.

Everything here uses only Python stdlib (re, json, typing).
Import-safe in tests, scripts, and eval harnesses without needing
sqlalchemy, openai, httpx, or any other heavy package.

Functions here are the single source of truth — aria_agent.py and
aria_tool_runner.py import FROM here instead of duplicating logic.
"""
from __future__ import annotations

import re
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# INTENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_intent(message: str) -> str:
    msg = message.lower().strip()
    words = set(re.findall(r'\b\w+\b', msg))

    appreciation_words = {"thanks", "thankyou", "shukriya", "shukria", "shabash", "wah"}
    appreciation_phrases = [
        "thank you", "good job", "great job", "well done", "amazing", "awesome",
        "excellent", "perfect", "wonderful", "brilliant", "fantastic",
        "thats great", "that's great", "great work", "nice work",
        "bohot acha", "bahut acha", "bohat acha",
    ]
    greeting_words = {"hello", "hey", "salam", "assalam", "assalamualaikum", "aoa", "sup"}
    greeting_phrases = [
        "good morning", "good evening", "good afternoon",
        "how are you", "how r u", "kya haal", "kaisa hai",
        "kesy ho", "whats up", "what's up",
    ]
    compliment_phrases = [
        "you are smart", "you're smart", "so smart", "intelligent",
        "clever", "best agent", "love you", "you're great",
        "you are great", "impressive", "good bot", "nice bot",
    ]

    if words & appreciation_words or any(p in msg for p in appreciation_phrases):
        return "appreciation"

    is_short = len(msg) < 30
    starts_with_greeting = any(msg.startswith(w) for w in greeting_words) or \
                           any(msg.startswith(p) for p in greeting_phrases)
    exact_greeting = msg in greeting_words
    if (exact_greeting or (starts_with_greeting and is_short)) or \
       (is_short and any(p in msg for p in greeting_phrases)):
        return "greeting"

    if any(p in msg for p in compliment_phrases):
        return "compliment"

    return "task"


# ─────────────────────────────────────────────────────────────────────────────
# LOCATION / PREFERENCE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _has_location(msg: str) -> bool:
    """Return True if the message contains a location indicator."""
    m = msg.lower()
    return bool(
        re.search(r'\bin\s+[a-zA-Z]', m) or
        re.search(r'\bnear\s+[a-zA-Z]', m) or
        re.search(r'\bat\s+[a-zA-Z]', m) or
        any(city in m for city in [
            "dubai", "abu dhabi", "malta", "valletta", "london", "paris",
            "berlin", "lisbon", "barcelona", "madrid", "rome", "milan",
            "amsterdam", "istanbul", "cairo", "riyadh", "karachi",
            "lahore", "islamabad", "mumbai", "delhi", "singapore", "bangkok",
            "new york", "los angeles", "toronto", "sydney", "melbourne",
        ])
    )


def _is_no_budget(msg: str) -> bool:
    m = msg.lower()
    return any(x in m for x in [
        "no specific budget", "koi specific budget",
        "no budget", "koi budget nai", "budget nai",
        "no limit", "no price limit",
        "flexible", "doesnt matter", "doesn't matter", "doesn t matter",
        "koi baat nai", "koi masla nai",
        "dont have", "don't have", "don t have",
        "nai hai", "nahin hai",
        "any budget", "any price",
        "not sure", "pata nai", "pata nahi",
        "open budget", "no constraint",
        "i have no", "i dont have", "i don't have",
    ])


def _is_pref_reply(msg: str) -> bool:
    m = msg.lower()
    signals = [
        "buy", "rent", "sale", "purchase", "kharidna", "kiraya",
        "bedroom", "bed", "bathroom", "bath", "budget", "no budget",
        "no specific", "koi budget", "apartment", "villa", "penthouse",
        "bungalow", "flat", "studio", "townhouse", "show all", "sab dikhao",
        "i want", "chahiye", "chahta", "chahti",
        "no limit", "flexible", "any budget",
    ]
    return any(x in m for x in signals) and len(m) < 400


def _is_urdu_message(msg: str) -> bool:
    """Detect if message is primarily Urdu (latin script)."""
    urdu_words = {
        "mujhe", "chahiye", "chahta", "chahti", "karna", "kar", "hai",
        "hain", "nahi", "nai", "aur", "ke", "ka", "ki", "ko", "se",
        "mein", "mae", "pe", "par", "yeh", "woh", "kya", "koi",
        "bohot", "bahut", "bohat", "ghar", "makan", "kiraya", "khareed",
        "apartment", "villa", "dhundao", "dikhao", "batao", "bata",
        "pata", "theek", "achha", "acha", "shukriya", "shukria",
    }
    words = set(re.findall(r'\b\w+\b', msg.lower()))
    return len(words & urdu_words) >= 2


# ─────────────────────────────────────────────────────────────────────────────
# PRICE PARSING
# ─────────────────────────────────────────────────────────────────────────────

def _to_price(num: str, suffix: str) -> int:
    """Convert extracted number + suffix to an integer price."""
    try:
        n = float(num.replace(",", ""))
    except ValueError:
        return 0
    s = suffix.lower()
    if s == "k":
        return int(n * 1_000)
    if s == "m":
        return int(n * 1_000_000)
    return int(n)


# ─────────────────────────────────────────────────────────────────────────────
# PREFERENCE PARSING
# ─────────────────────────────────────────────────────────────────────────────

_KNOWN_LOCALITIES: list[str] = [
    # Malta
    "sliema", "st julians", "saint julians", "san giljan", "valletta",
    "msida", "gzira", "swieqi", "paceville", "st paul's bay", "mellieha",
    "bugibba", "marsaskala", "birzebbuga", "qormi", "birkirkara",
    "mosta", "naxxar", "attard", "balzan", "lija", "rabat", "mdina",
    "marsaxlokk", "zejtun", "zabbar", "fgura", "tarxien", "luqa",
    "san gwann", "hamrun", "floriana", "cospicua", "vittoriosa",
    "senglea", "kalkara", "xgajra", "zebbug", "siggiewi", "dingli",
    "kirkop", "zurrieq", "mqabba", "qrendi", "safi",
    # Dubai
    "marina", "jbr", "downtown", "palm jumeirah", "deira", "bur dubai",
    "jumeirah", "al barsha", "business bay", "silicon oasis",
    "discovery gardens", "international city", "sports city",
    "motor city", "arabian ranches", "the springs", "the lakes",
    "the meadows", "emirates hills", "mirdif", "rashidiya",
    # London
    "kensington", "chelsea", "mayfair", "shoreditch", "brixton",
    "camden", "islington", "hackney", "tower hamlets",
    # Generic
    "city centre", "city center", "old town", "new town",
]

_SKIP_AS_LOCALITY = {
    "malta", "dubai", "london", "paris", "spain", "italy",
    "uae", "uk", "usa", "germany", "france", "portugal",
}


def _parse_prefs_from_message(msg: str) -> dict[str, Any]:
    """
    Extract explicit preferences from a single user message.
    Returns only keys the message mentions — missing keys = no restriction.
    """
    m = msg.lower()
    prefs: dict[str, Any] = {}

    # Category
    if any(x in m for x in ["buy", "sale", "purchase", "kharidna", "khareed"]):
        prefs["category"] = "sale"
    elif any(x in m for x in ["rent", "kiraya", "kiraye"]):
        prefs["category"] = "rent"

    # Bedrooms
    bed_match = re.search(r'(\d+)\s*(?:bed(?:room)?s?|br\b)', m)
    if bed_match:
        prefs["bedrooms"] = int(bed_match.group(1))

    # Bathrooms
    bath_match = re.search(r'(\d+)\s*(?:bath(?:room)?s?|ba\b)', m)
    if bath_match:
        prefs["bathrooms"] = int(bath_match.group(1))

    # Furnished status
    if any(x in m for x in ["unfurnished", "un-furnished", "without furniture",
                              "furniture nai", "bina furniture"]):
        prefs["furnished"] = "unfurnished"
    elif any(x in m for x in ["furnished", "with furniture", "furniture ke saath",
                                "fully furnished", "semi furnished", "semi-furnished"]):
        prefs["furnished"] = "furnished"

    # Property type — English (studio apartment → studio wins; check studio first)
    for pt in ["penthouse", "townhouse", "bungalow", "studio", "villa",
               "maisonette", "duplex", "apartment", "flat", "house"]:
        if pt in m:
            prefs["property_type"] = pt
            break

    # Property type — Urdu
    urdu_type_map = {
        "makan": "house", "makaan": "house", "ghar": "house",
        "flat": "apartment", "kamra": "room",
    }
    for urdu, eng in urdu_type_map.items():
        if urdu in m and "property_type" not in prefs:
            prefs["property_type"] = eng
            break

    # Locality — known list
    for loc in _KNOWN_LOCALITIES:
        if re.search(r'\b' + re.escape(loc) + r'\b', m):
            prefs["locality"] = loc.title()
            break

    # Locality — "in <Name>" fallback
    if "locality" not in prefs:
        _loc_match = re.search(
            r'\bin\s+([A-Z][a-zA-Z\s]{2,20}?)(?:\s*[,.\?!]|$|\s+(?:area|locality|neighbourhood|neighborhood|side|part|zone|district))',
            msg,
        )
        if _loc_match:
            candidate = _loc_match.group(1).strip()
            if candidate.lower() not in _SKIP_AS_LOCALITY and len(candidate) >= 3:
                prefs["locality"] = candidate

    # Price range
    _pnum = r'[€$£₹]?\s*(\d+(?:[.,]\d+)?)\s*([kKmM]?)'
    rng = re.search(_pnum + r'\s*(?:to|–|—|-|and|se)\s*' + _pnum, m)
    if rng:
        lo = _to_price(rng.group(1), rng.group(2))
        hi = _to_price(rng.group(3), rng.group(4))
        if lo > 0 and hi > 0 and hi >= lo:
            prefs["min_price"] = lo
            prefs["max_price"] = hi
    else:
        up = re.search(
            r'(?:under|max|maximum|up to|upto|below|less than|kam se kam)\s+(?:budget\s+)?' + _pnum, m)
        if up:
            v = _to_price(up.group(1), up.group(2))
            if v > 0:
                prefs["max_price"] = v

        dn = re.search(
            r'(?:min|minimum|at least|from|above|more than|zyada se zyada)\s+' + _pnum, m)
        if dn:
            v = _to_price(dn.group(1), dn.group(2))
            if v > 0:
                prefs["min_price"] = v

    # ── Amenities / must-have features ───────────────────────────────────────
    _amenity_map = {
        "pool":          ["swimming pool", "pool", "tairne ka pool", "swimmingpool"],
        "gym":           ["gym", "gymnasium", "fitness", "workout room"],
        "parking":       ["parking", "car park", "car space", "gaadi ki jagah"],
        "garage":        ["garage", "garaaj"],
        "garden":        ["garden", "lawn", "bagicha", "yard"],
        "balcony":       ["balcony", "balconi", "balkoni"],
        "terrace":       ["terrace", "terras", "rooftop"],
        "sea view":      ["sea view", "ocean view", "samundar ka nazara", "seafront"],
        "lift":          ["lift", "elevator", "ascensor"],
        "ac":            ["air conditioning", "air conditioned", "ac ", " ac", "a/c", "aircon"],
        "storage":       ["storage", "storeroom", "store room"],
        "security":      ["security", "gated", "guard", "cctv"],
        "concierge":     ["concierge", "reception", "doorman"],
    }
    amenities_wanted: list[str] = []
    for amenity_key, keywords in _amenity_map.items():
        if any(kw in m for kw in keywords):
            amenities_wanted.append(amenity_key)
    if amenities_wanted:
        prefs["amenities"] = amenities_wanted

    # ── Area / size requirements ──────────────────────────────────────────────
    # "at least 100 sqm", "minimum 80m2", "100 square meters"
    _sqm_pattern = r'(\d+)\s*(?:sq\.?\s*m(?:eters?|etres?|²)?|m²|sqm|square\s*(?:meters?|metres?|feet|ft))'

    # Internal area
    int_match = re.search(
        r'(?:internal|indoor|inside|andar(?:\s*ki)?)\s+(?:area\s+)?(?:of\s+)?'
        r'(?:at\s+least|min(?:imum)?\s+)?' + _sqm_pattern, m)
    if int_match:
        prefs["min_internal_sqm"] = int(int_match.group(1))

    # External area
    ext_match = re.search(
        r'(?:external|outdoor|outside|bahar(?:\s*ki)?|garden|terrace)\s+(?:area\s+)?(?:of\s+)?'
        r'(?:at\s+least|min(?:imum)?\s+)?' + _sqm_pattern, m)
    if ext_match:
        prefs["min_external_sqm"] = int(ext_match.group(1))

    # General size (when no internal/external specified)
    if "min_internal_sqm" not in prefs and "min_external_sqm" not in prefs:
        gen_match = re.search(
            r'(?:at\s+least|min(?:imum)?|over|above|more\s+than)?\s*'
            r'(\d+)\s*(?:sq\.?\s*m(?:eters?|etres?|²)?|m²|sqm)', m)
        if gen_match:
            prefs["min_total_sqm"] = int(gen_match.group(1))

    # ── Floor number ──────────────────────────────────────────────────────────
    floor_match = re.search(r'(\d+)(?:st|nd|rd|th)?\s*floor', m)
    if floor_match:
        prefs["floor_number"] = int(floor_match.group(1))
    # Ground floor
    elif any(x in m for x in ["ground floor", "parterre", "parter"]):
        prefs["floor_number"] = 0

    # ── Free-text preferences (Option B) ─────────────────────────────────────
    # Capture any preference NOT already handled by structured fields above.
    # These are soft-matched against property description/amenities text later.
    #
    # Strategy: look for known free-text preference patterns in the message,
    # store as plain English keyword phrases for description matching.
    _free_text_patterns: list[tuple[list[str], str]] = [
        # Location proximity
        (["near school", "school k paas", "school ke paas", "school nearby"], "near school"),
        (["near hospital", "hospital k paas", "hospital ke paas"], "near hospital"),
        (["near metro", "metro k paas", "metro station"], "near metro"),
        (["near beach", "beach k paas", "seafront", "beachfront"], "near beach"),
        (["near mosque", "mosque k paas", "masjid k paas"], "near mosque"),
        (["near mall", "mall k paas", "shopping center"], "near mall"),
        (["near university", "university k paas", "near college"], "near university"),
        (["city center", "city centre", "markaz mein", "downtown"], "city centre"),
        (["quiet area", "quiet neighborhood", "shaant jagah", "peaceful"], "quiet area"),
        # Property features not in amenity map
        (["pet friendly", "pets allowed", "janwar allowed", "cat allowed", "dog allowed"], "pet friendly"),
        (["mountain view", "mountain ka nazara", "hills view"], "mountain view"),
        (["city view", "city ka nazara", "skyline view"], "city view"),
        (["private entrance", "private entry", "alag darwaza"], "private entrance"),
        (["smart home", "home automation", "automated"], "smart home"),
        (["solar", "solar panels", "solar energy"], "solar panels"),
        (["new build", "newly built", "naya bana", "brand new", "new construction", "2020", "2021", "2022", "2023", "2024"], "newly built"),
        (["renovated", "refurbished", "naya renovate", "recently renovated"], "renovated"),
        (["basement", "lower ground"], "basement"),
        (["duplex", "two level", "do manzil"], "duplex"),
        (["open plan", "open kitchen", "open layout"], "open plan"),
        (["private pool", "own pool", "apna pool"], "private pool"),
        (["communal pool", "shared pool", "common pool"], "communal pool"),
        (["short let", "short term", "monthly rental", "holiday let"], "short let"),
        (["long term", "long let", "yearly"], "long term"),
        (["no commission", "no agent fee", "owner direct", "maalik se seedha"], "no commission"),
    ]

    free_text: list[str] = []
    for keywords, label in _free_text_patterns:
        if any(kw in m for kw in keywords):
            # Only add if this preference isn't already captured in structured fields
            if label not in free_text:
                free_text.append(label)

    if free_text:
        prefs["free_text_prefs"] = free_text

    return prefs


# ─────────────────────────────────────────────────────────────────────────────
# PROPERTY FILTER
# ─────────────────────────────────────────────────────────────────────────────

def _filter_by_prefs(
    properties: list[dict],
    *,
    locality: str = "",
    category: str = "",
    property_type: str = "",
    bedrooms: int | None = None,
    bathrooms: int | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    amenities: list[str] | None = None,
    furnished: str = "",
    min_total_sqm: float | None = None,
    min_internal_sqm: float | None = None,
    min_external_sqm: float | None = None,
    floor_number: int | None = None,
    free_text_prefs: list[str] | None = None,
) -> list[dict]:
    """
    Hard-filter properties to match user preferences.

    HARD filters (no fallback — if user said it, we enforce it absolutely):
      - locality: user asked for specific area → only that area
      - category: user asked for rent/sale → only that type

    SOFT filters (fall back if result empty — scraper may not have extracted field):
      - property_type, bedrooms, bathrooms, price range,
        amenities, furnished, area, floor_number
    """
    result = list(properties)

    def _soft_apply(filtered: list[dict], base: list[dict]) -> list[dict]:
        return filtered if filtered else base

    def _amenity_in_property(p: dict, amenity: str) -> bool:
        """Check if property has a specific amenity anywhere in its fields."""
        amenity_l = amenity.lower()
        # Check amenities list
        prop_amenities = p.get("amenities") or []
        if isinstance(prop_amenities, list):
            if any(amenity_l in str(a).lower() for a in prop_amenities):
                return True
        elif isinstance(prop_amenities, str):
            if amenity_l in prop_amenities.lower():
                return True
        # Also check description text (not title — title can mislead e.g. "No Pool Apt")
        description = str(p.get("description") or "").lower()
        return amenity_l in description

    # ── HARD: Locality
    if locality and locality.strip():
        loc = locality.lower().strip()
        result = [p for p in result if
                  loc in (p.get("locality") or "").lower() or
                  loc in (p.get("city") or "").lower() or
                  loc in (p.get("full_address") or "").lower() or
                  loc in (p.get("title") or "").lower()]

    # ── HARD: Category
    if category and category not in ("any", ""):
        cat = category.lower()
        result = [p for p in result
                  if not p.get("category") or cat in (p.get("category") or "").lower()]

    # ── SOFT: Property type
    if property_type and property_type not in ("any", ""):
        ptype = property_type.lower()
        result = _soft_apply([p for p in result
                               if not p.get("property_type") or
                               ptype in (p.get("property_type") or "").lower() or
                               (p.get("property_type") or "").lower() in ptype], result)

    # ── SOFT: Bedrooms (exact)
    if bedrooms is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("bedrooms") is None or
                                  int(p["bedrooms"]) == bedrooms], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Bathrooms (exact)
    if bathrooms is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("bathrooms") is None or
                                  int(p["bathrooms"]) == bathrooms], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Price range
    if max_price is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("price") is None or float(p["price"]) <= max_price],
                                 result)
        except (TypeError, ValueError):
            pass
    if min_price is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("price") is None or float(p["price"]) >= min_price],
                                 result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Amenities — each requested amenity filtered separately
    # e.g. user wants pool AND garage → filter pool first, then garage
    # Each step falls back if no match (scraper may not have extracted it)
    if amenities:
        for amenity in amenities:
            result = _soft_apply(
                [p for p in result if _amenity_in_property(p, amenity)],
                result
            )

    # ── SOFT: Furnished
    if furnished and furnished not in ("any", ""):
        furn = furnished.lower()
        result = _soft_apply([p for p in result
                               if not p.get("furnished") or
                               furn in (p.get("furnished") or "").lower()], result)

    # ── SOFT: Total area
    if min_total_sqm is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("total_sqm") is None or
                                  float(p["total_sqm"]) >= min_total_sqm], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Internal area
    if min_internal_sqm is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("internal_area_sqm") is None or
                                  float(p["internal_area_sqm"]) >= min_internal_sqm], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: External area
    if min_external_sqm is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("external_area_sqm") is None or
                                  float(p["external_area_sqm"]) >= min_external_sqm], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Floor number
    if floor_number is not None:
        try:
            result = _soft_apply([p for p in result
                                  if p.get("floor_number") is None or
                                  int(p["floor_number"]) == floor_number], result)
        except (TypeError, ValueError):
            pass

    # ── SOFT: Free-text preferences (Option B)
    # Search description + amenities text for each free-text keyword.
    # Applied one by one — each falls back if no match (scraper may not mention it).
    # Returns matched_flags dict so caller knows which prefs were/weren't found.
    if free_text_prefs:
        _stopwords = {"near", "with", "and", "the", "for", "area", "very", "from"}
        for pref in free_text_prefs:
            pref_l = pref.lower()
            # Extract meaningful keywords — skip stopwords and very short words
            # e.g. "near school" → ["school"]
            # e.g. "pet friendly" → ["friendly"] ... but also try full phrase first
            keywords = [w for w in pref_l.split()
                        if len(w) >= 4 and w not in _stopwords]
            if not keywords:
                keywords = [pref_l]

            def _prop_has_pref(p: dict, keywords: list = keywords, pref_l: str = pref_l) -> bool:
                searchable = " ".join([
                    str(p.get("description") or ""),
                    str(p.get("full_address") or ""),
                    " ".join(str(a) for a in (p.get("amenities") or [])),
                ]).lower()
                # Use word-boundary regex to avoid "nearby" matching "near"
                return (
                    re.search(r'\b' + re.escape(pref_l) + r'\b', searchable) is not None or
                    any(re.search(r'\b' + re.escape(kw) + r'\b', searchable) for kw in keywords)
                )

            filtered = [p for p in result if _prop_has_pref(p)]
            if filtered:
                result = filtered
            # else: soft fallback — keep all, caller should show warning note

    return result
