"""
ARIA Automated Eval Suite
=========================
Run with:  cd backend && python -m pytest tests/test_aria_eval.py -v
Or:        cd backend && python tests/test_aria_eval.py

Tests three layers:
  1. Preference parsing  — _parse_prefs_from_message()
  2. Filter logic        — _filter_by_prefs()
  3. Intent detection    — detect_intent(), _is_navigation, _is_more_details
  4. State merge logic   — stored + current message prefs merge correctly

These are pure unit tests — NO network calls, NO OpenAI, NO Stagehand.
Fast: completes in < 1 second.

All functions are imported from aria_pure.py which has ZERO heavy dependencies.
"""
from __future__ import annotations

import sys
import os

# Ensure project root is on path
_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, _ROOT)

import pytest

# Import directly from the zero-dependency pure module — no stubs needed
from backend.ai.aria_pure import (
    _parse_prefs_from_message,
    detect_intent,
    _has_location,
    _is_no_budget,
    _is_pref_reply,
    _filter_by_prefs,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. PREFERENCE PARSING
# ─────────────────────────────────────────────────────────────────────────────

class TestPreferenceParsing:

    def test_rent_3bed_apartment_sliema(self):
        prefs = _parse_prefs_from_message("I want to rent a 3 bedroom apartment in Sliema")
        assert prefs["category"] == "rent"
        assert prefs["bedrooms"] == 3
        assert prefs["property_type"] == "apartment"
        assert prefs["locality"].lower() == "sliema"

    def test_buy_villa_2bed(self):
        prefs = _parse_prefs_from_message("buy a 2 bed villa with pool")
        assert prefs["category"] == "sale"
        assert prefs["bedrooms"] == 2
        assert prefs["property_type"] == "villa"

    def test_urdu_rent_3bed(self):
        prefs = _parse_prefs_from_message("3 bedroom apartment kiraye pe chahiye Sliema mein")
        assert prefs["category"] == "rent"
        assert prefs["bedrooms"] == 3
        assert prefs["locality"].lower() == "sliema"

    def test_budget_range(self):
        prefs = _parse_prefs_from_message("budget €200k to €500k")
        assert prefs["min_price"] == 200_000
        assert prefs["max_price"] == 500_000

    def test_budget_max_only(self):
        prefs = _parse_prefs_from_message("max budget 1500 per month")
        assert prefs["max_price"] == 1500

    def test_no_budget_flag(self):
        assert _is_no_budget("no budget limit") is True
        assert _is_no_budget("koi budget nai") is True
        assert _is_no_budget("flexible budget") is True
        assert _is_no_budget("budget €2000") is False

    def test_studio(self):
        prefs = _parse_prefs_from_message("looking for a studio apartment")
        assert prefs["property_type"] == "studio"

    def test_penthouse_st_julians(self):
        prefs = _parse_prefs_from_message("penthouse in St Julians for sale 4 bed")
        assert prefs["property_type"] == "penthouse"
        assert prefs["bedrooms"] == 4
        assert prefs["category"] == "sale"

    def test_empty_message_returns_empty(self):
        prefs = _parse_prefs_from_message("next site")
        # Navigation message should not extract bogus preferences
        assert "bedrooms" not in prefs
        assert "category" not in prefs

    def test_bathrooms_parsed(self):
        prefs = _parse_prefs_from_message("3 bed 2 bath apartment")
        assert prefs["bedrooms"] == 3
        assert prefs["bathrooms"] == 2

    def test_furnished_parsed(self):
        prefs = _parse_prefs_from_message("I want a furnished apartment in Sliema")
        assert prefs["furnished"] == "furnished"

    def test_unfurnished_parsed(self):
        prefs = _parse_prefs_from_message("unfurnished flat, budget €800")
        assert prefs["furnished"] == "unfurnished"

    def test_furnished_urdu(self):
        prefs = _parse_prefs_from_message("furniture ke saath apartment chahiye")
        assert prefs["furnished"] == "furnished"

    def test_no_furnished_key_when_not_mentioned(self):
        prefs = _parse_prefs_from_message("3 bed apartment in Valletta")
        assert "furnished" not in prefs

    def test_pool_amenity_parsed(self):
        prefs = _parse_prefs_from_message("3 bed villa with swimming pool in Sliema")
        assert "pool" in prefs.get("amenities", [])

    def test_garage_amenity_parsed(self):
        prefs = _parse_prefs_from_message("apartment with garage and balcony")
        assert "garage" in prefs.get("amenities", [])
        assert "balcony" in prefs.get("amenities", [])

    def test_multiple_amenities_parsed(self):
        prefs = _parse_prefs_from_message("villa with pool, gym and sea view")
        amenities = prefs.get("amenities", [])
        assert "pool" in amenities
        assert "gym" in amenities
        assert "sea view" in amenities

    def test_no_amenities_key_when_not_mentioned(self):
        prefs = _parse_prefs_from_message("2 bed apartment in Valletta for rent")
        assert "amenities" not in prefs

    def test_min_total_sqm_parsed(self):
        prefs = _parse_prefs_from_message("apartment at least 120 sqm")
        assert prefs.get("min_total_sqm") == 120

    def test_floor_number_parsed(self):
        prefs = _parse_prefs_from_message("3rd floor apartment in Sliema")
        assert prefs.get("floor_number") == 3

    def test_ground_floor_parsed(self):
        prefs = _parse_prefs_from_message("ground floor apartment with garden")
        assert prefs.get("floor_number") == 0

    def test_free_text_near_school_parsed(self):
        prefs = _parse_prefs_from_message("3 bed apartment near school in Sliema")
        assert "near school" in prefs.get("free_text_prefs", [])

    def test_free_text_pet_friendly_parsed(self):
        prefs = _parse_prefs_from_message("pet friendly apartment for rent")
        assert "pet friendly" in prefs.get("free_text_prefs", [])

    def test_free_text_multiple_parsed(self):
        prefs = _parse_prefs_from_message("villa near beach, quiet area, newly built")
        ft = prefs.get("free_text_prefs", [])
        assert "near beach" in ft
        assert "quiet area" in ft
        assert "newly built" in ft

    def test_free_text_not_present_when_not_mentioned(self):
        prefs = _parse_prefs_from_message("3 bed villa for sale in Valletta")
        assert "free_text_prefs" not in prefs

    def test_free_text_urdu_near_school(self):
        prefs = _parse_prefs_from_message("school k paas apartment chahiye")
        assert "near school" in prefs.get("free_text_prefs", [])


# ─────────────────────────────────────────────────────────────────────────────
# 2. FILTER LOGIC (Point 2 — rules in code, not prompt)
# ─────────────────────────────────────────────────────────────────────────────

class TestFilterLogic:

    SAMPLE_PROPERTIES = [
        {"title": "Sliema Apt A", "bedrooms": 3, "bathrooms": 2,
         "category": "rent", "property_type": "apartment",
         "locality": "Sliema", "price": 1500},
        {"title": "St Julians Villa", "bedrooms": 3, "bathrooms": 2,
         "category": "rent", "property_type": "villa",
         "locality": "St Julians", "price": 2000},
        {"title": "Valletta Penthouse", "bedrooms": 4, "bathrooms": 3,
         "category": "sale", "property_type": "penthouse",
         "locality": "Valletta", "price": 500_000},
        {"title": "Sliema Studio", "bedrooms": 1, "bathrooms": 1,
         "category": "rent", "property_type": "studio",
         "locality": "Sliema", "price": 800},
        {"title": "Sliema Apt B SALE", "bedrooms": 3, "bathrooms": 2,
         "category": "sale", "property_type": "apartment",
         "locality": "Sliema", "price": 350_000},
    ]

    def test_category_hard_filter_rent(self):
        """HARD: rent filter must exclude sale — even if that leaves few results."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, category="rent")
        assert all(p["category"] == "rent" for p in result), \
            f"Sale properties slipped through: {[p['title'] for p in result if p['category']=='sale']}"

    def test_category_hard_filter_sale(self):
        """HARD: sale filter must exclude rent."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, category="sale")
        assert all(p["category"] == "sale" for p in result)

    def test_locality_hard_filter_sliema(self):
        """HARD: Sliema filter must exclude St Julians and Valletta."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, locality="Sliema")
        for p in result:
            loc = (p.get("locality") or "").lower()
            assert "sliema" in loc, f"Non-Sliema property passed: {p['title']}"

    def test_locality_and_category_combined(self):
        """HARD: Both filters applied — only Sliema rent apartments."""
        result = _filter_by_prefs(
            self.SAMPLE_PROPERTIES,
            locality="Sliema",
            category="rent",
        )
        assert len(result) == 2  # Sliema Apt A + Sliema Studio
        for p in result:
            assert "sliema" in (p.get("locality") or "").lower()
            assert p["category"] == "rent"

    def test_bedrooms_exact_match(self):
        """SOFT: bedrooms filter is exact but falls back if no match."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, bedrooms=3)
        # Properties with bedrooms=3: Apt A, St Julians Villa, Sliema Apt B
        matched = [p for p in result if p.get("bedrooms") == 3]
        assert len(matched) >= 3

    def test_bedrooms_wrong_count_excluded(self):
        """Bedrooms=4 should exclude 3-bed and 1-bed properties if any 4-bed exist."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, bedrooms=4)
        # Only Valletta Penthouse has 4 beds — should be in result
        titles = [p["title"] for p in result]
        assert "Valletta Penthouse" in titles

    def test_property_type_soft_filter(self):
        """SOFT: property_type filter falls back if no match (returns all)."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, property_type="apartment")
        # Should at minimum include the apartments
        apt_titles = [p["title"] for p in result if "Apt" in p["title"]]
        assert len(apt_titles) >= 2

    def test_no_filters_returns_all(self):
        """No filters → all properties returned unchanged."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES)
        assert len(result) == len(self.SAMPLE_PROPERTIES)

    def test_category_no_fallback_when_empty(self):
        """HARD filter: if no properties match category, return empty (not original list)."""
        props = [{"category": "sale", "locality": "Valletta", "bedrooms": 3}]
        result = _filter_by_prefs(props, category="rent")
        assert result == [], f"Expected empty list but got: {result}"

    def test_locality_no_fallback_when_empty(self):
        """HARD filter: if no properties match locality, return empty."""
        props = [{"locality": "Valletta", "category": "sale"}]
        result = _filter_by_prefs(props, locality="Sliema")
        assert result == [], f"Expected empty list but got: {result}"

    def test_max_price_filter(self):
        """SOFT: max_price filter applied."""
        result = _filter_by_prefs(self.SAMPLE_PROPERTIES, max_price=1600)
        prices = [p["price"] for p in result if p.get("price") is not None]
        assert all(p <= 1600 for p in prices), f"Price overflow: {prices}"

    def test_amenity_pool_filter(self):
        """SOFT: properties with pool preferred; falls back if none have it."""
        props = [
            {"title": "Pool Villa", "amenities": ["pool", "garage"], "category": "rent"},
            {"title": "No Pool Apt", "amenities": ["lift"], "category": "rent"},
        ]
        result = _filter_by_prefs(props, amenities=["pool"])
        assert len(result) == 1
        assert result[0]["title"] == "Pool Villa"

    def test_amenity_fallback_when_none_match(self):
        """SOFT: if no property has the amenity, return all (soft fallback)."""
        props = [
            {"title": "Apt A", "amenities": ["lift"], "category": "rent"},
            {"title": "Apt B", "amenities": ["parking"], "category": "rent"},
        ]
        result = _filter_by_prefs(props, amenities=["pool"])
        assert len(result) == 2  # fallback — both returned

    def test_amenity_in_description_fallback(self):
        """SOFT: amenity found in description text counts."""
        props = [
            {"title": "Nice Apt", "amenities": [], "description": "lovely apartment with shared pool", "category": "sale"},
            {"title": "Dry Apt", "amenities": [], "description": "no outdoor space", "category": "sale"},
        ]
        result = _filter_by_prefs(props, amenities=["pool"])
        assert result[0]["title"] == "Nice Apt"

    def test_furnished_filter(self):
        """SOFT: furnished filter keeps furnished properties."""
        props = [
            {"title": "Furnished Apt", "furnished": "yes", "category": "rent"},
            {"title": "Bare Apt", "furnished": "no", "category": "rent"},
        ]
        result = _filter_by_prefs(props, furnished="yes")
        assert len(result) == 1
        assert result[0]["title"] == "Furnished Apt"

    def test_furnished_fallback_when_field_absent(self):
        """SOFT: if property has no furnished field, it passes the filter."""
        props = [
            {"title": "Unknown Apt", "category": "rent"},  # no furnished key
        ]
        result = _filter_by_prefs(props, furnished="yes")
        assert len(result) == 1  # passes — field absent means unknown, not excluded

    def test_min_total_sqm_filter(self):
        """SOFT: area filter keeps properties >= min size."""
        props = [
            {"title": "Big Apt", "total_sqm": 150, "category": "rent"},
            {"title": "Tiny Apt", "total_sqm": 45, "category": "rent"},
        ]
        result = _filter_by_prefs(props, min_total_sqm=100)
        assert len(result) == 1
        assert result[0]["title"] == "Big Apt"

    def test_floor_number_filter(self):
        """SOFT: floor_number filter keeps matching floor."""
        props = [
            {"title": "3rd Floor Apt", "floor_number": 3, "category": "rent"},
            {"title": "Ground Apt", "floor_number": 0, "category": "rent"},
        ]
        result = _filter_by_prefs(props, floor_number=3)
        assert len(result) == 1
        assert result[0]["title"] == "3rd Floor Apt"

    def test_free_text_filter_match_in_description(self):
        """SOFT: free_text_prefs matched in description — only matching property returned."""
        props = [
            {"title": "School Apt", "description": "close to school and supermarket", "category": "rent"},
            {"title": "Far Apt", "description": "quiet area, no nearby amenities", "category": "rent"},
        ]
        result = _filter_by_prefs(props, free_text_prefs=["near school"])
        assert len(result) == 1
        assert result[0]["title"] == "School Apt"

    def test_free_text_filter_fallback_when_none_match(self):
        """SOFT: if no property mentions free_text pref, return all (soft fallback)."""
        props = [
            {"title": "Apt A", "description": "modern apartment", "category": "rent"},
            {"title": "Apt B", "description": "spacious flat", "category": "rent"},
        ]
        result = _filter_by_prefs(props, free_text_prefs=["near school"])
        assert len(result) == 2  # soft fallback — both returned

    def test_free_text_filter_match_in_amenities(self):
        """SOFT: free_text_prefs matched in amenities list."""
        props = [
            {"title": "Pet Apt", "amenities": ["pet friendly", "garden"], "description": "", "category": "rent"},
            {"title": "No Pet Apt", "amenities": ["lift", "ac"], "description": "", "category": "rent"},
        ]
        result = _filter_by_prefs(props, free_text_prefs=["pet friendly"])
        assert len(result) == 1
        assert result[0]["title"] == "Pet Apt"


# ─────────────────────────────────────────────────────────────────────────────
# 3. INTENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

class TestIntentDetection:

    def test_greeting_detected(self):
        assert detect_intent("hello") == "greeting"
        assert detect_intent("hey there") == "greeting"
        assert detect_intent("salam") == "greeting"

    def test_appreciation_detected(self):
        assert detect_intent("thank you") == "appreciation"
        assert detect_intent("shukriya") == "appreciation"
        assert detect_intent("bohot acha") == "appreciation"

    def test_property_search_is_task(self):
        assert detect_intent("find me 3 bed apartment in Malta") == "task"
        assert detect_intent("show properties in Sliema") == "task"

    def test_has_location_malta(self):
        assert _has_location("properties in Malta") is True
        assert _has_location("apartments in Sliema") is True
        assert _has_location("I want to rent") is False

    def test_has_location_dubai(self):
        assert _has_location("looking for villa in Dubai") is True

    def test_navigation_signals(self):
        """Navigation messages should not be treated as pref replies or new searches."""
        nav_msgs = ["next", "next site", "agla", "(1)", "(2)", "show more", "same site"]
        for msg in nav_msgs:
            prefs = _parse_prefs_from_message(msg)
            # Navigation messages should not accidentally parse preferences
            assert "bedrooms" not in prefs, f"'{msg}' wrongly parsed bedrooms"
            assert "category" not in prefs, f"'{msg}' wrongly parsed category"

    def test_is_pref_reply_yes(self):
        assert _is_pref_reply("rent, 3 bed apartment, budget €1500") is True
        assert _is_pref_reply("apartment chahiye") is True

    def test_is_pref_reply_no_for_navigation(self):
        """Pure navigation messages are NOT pref replies."""
        assert _is_pref_reply("next site please") is False
        assert _is_pref_reply("agla dikhao") is False

    def test_check_from_list_signals_no_prefs_parsed(self):
        """'Check from the list above' and similar are navigation — must NOT parse prefs."""
        nav_msgs = [
            "check from the list above",
            "from the list above",
            "check from the list",
            "go ahead",
            "yes check",
            "haan check",
            "haan search",
            "proceed",
            "start searching",
            "start scraping",
            "check those",
            "check them",
            "list se check",
            "show everything",
            "dikhao sab",
        ]
        for msg in nav_msgs:
            prefs = _parse_prefs_from_message(msg)
            assert "bedrooms" not in prefs,   f"'{msg}' wrongly parsed bedrooms"
            assert "category" not in prefs,   f"'{msg}' wrongly parsed category"
            assert "locality" not in prefs,   f"'{msg}' wrongly parsed locality"

    def test_check_from_list_is_not_pref_reply(self):
        """These messages should NOT trigger preference-reply handling."""
        assert _is_pref_reply("check from the list above") is False
        assert _is_pref_reply("go ahead") is False
        assert _is_pref_reply("yes check") is False
        assert _is_pref_reply("proceed") is False
        assert _is_pref_reply("haan check") is False


# ─────────────────────────────────────────────────────────────────────────────
# 4. PAGINATION FILTER LOGIC
# Tests the bedroom-counting behaviour that drives pagination stop/continue.
# In route.ts, countFilteredMatches uses the same logic as _filter_by_prefs —
# we verify the Python-side equivalent here so regressions are caught fast.
# ─────────────────────────────────────────────────────────────────────────────

class TestPaginationBedroomFilter:
    """
    Mirrors the TypeScript countFilteredMatches() bedroom logic.

    Key rule:
    - Properties with the CORRECT bedroom count → always count as matches.
    - Properties with NULL / unknown bedrooms → count as potential matches
      (site may not have exposed the field — we can't exclude them).
    - Properties with the WRONG bedroom count → never count as matches.

    Pagination stops when enough "known-match + unknown" properties exist.
    This prevents pagination from stopping too early because null-bedroom
    properties kept inflating the count before the real fix.
    """

    # ── Fixtures ──────────────────────────────────────────────────────────────

    MIXED_PROPS = [
        # 3 correctly matching (bedrooms == requested)
        {"title": "Match A", "bedrooms": 2, "category": "rent", "locality": "Dubai"},
        {"title": "Match B", "bedrooms": 2, "category": "rent", "locality": "Dubai"},
        # 2 with unknown bedrooms (null/None) — kept as potential matches
        {"title": "Unknown C", "bedrooms": None, "category": "rent", "locality": "Dubai"},
        {"title": "Unknown D", "bedrooms": None, "category": "rent", "locality": "Dubai"},
        # 2 wrong bedroom count — must be excluded
        {"title": "Wrong E",   "bedrooms": 3, "category": "rent", "locality": "Dubai"},
        {"title": "Wrong F",   "bedrooms": 4, "category": "rent", "locality": "Dubai"},
    ]

    def test_correct_bedroom_properties_returned(self):
        """Properties with the exact bedroom count are in the filtered result."""
        result = _filter_by_prefs(self.MIXED_PROPS, bedrooms=2)
        titles = [p["title"] for p in result]
        assert "Match A" in titles
        assert "Match B" in titles

    def test_wrong_bedroom_properties_excluded_when_matches_exist(self):
        """If correct-bedroom properties exist, wrong-bedroom ones must be excluded."""
        result = _filter_by_prefs(self.MIXED_PROPS, bedrooms=2)
        titles = [p["title"] for p in result]
        assert "Wrong E" not in titles, "3-bed should be excluded when 2-bed results exist"
        assert "Wrong F" not in titles, "4-bed should be excluded when 2-bed results exist"

    def test_null_bedroom_properties_kept(self):
        """Properties where bedrooms is unknown (None) pass the filter — may be correct."""
        result = _filter_by_prefs(self.MIXED_PROPS, bedrooms=2)
        titles = [p["title"] for p in result]
        assert "Unknown C" in titles, "Null-bedroom property should be kept"
        assert "Unknown D" in titles, "Null-bedroom property should be kept"

    def test_total_count_correct_match_plus_unknown(self):
        """Total filtered count = correct-bedroom + null-bedroom (not wrong-bedroom)."""
        result = _filter_by_prefs(self.MIXED_PROPS, bedrooms=2)
        assert len(result) == 4  # Match A, Match B, Unknown C, Unknown D

    def test_all_null_bedrooms_fallback(self):
        """If ALL properties have null bedrooms, all are kept (soft fallback — can't exclude)."""
        props = [
            {"title": "Apt X", "bedrooms": None, "category": "sale"},
            {"title": "Apt Y", "bedrooms": None, "category": "sale"},
            {"title": "Apt Z", "bedrooms": None, "category": "sale"},
        ]
        result = _filter_by_prefs(props, bedrooms=3)
        assert len(result) == 3, "All null-bedroom props should pass when no known match exists"

    def test_no_match_and_all_null_returns_all_null(self):
        """
        Edge case: no exact match but some null-bedroom props.
        The null ones are kept as potential matches.
        """
        props = [
            {"title": "Wrong", "bedrooms": 4, "category": "rent"},
            {"title": "Unknown", "bedrooms": None, "category": "rent"},
        ]
        result = _filter_by_prefs(props, bedrooms=2)
        titles = [p["title"] for p in result]
        assert "Unknown" in titles
        assert "Wrong" not in titles

    def test_bedroom_filter_combined_with_locality(self):
        """Bedroom + locality filters both applied — only matching props pass."""
        props = [
            {"title": "Dubai 2bed",   "bedrooms": 2, "locality": "Dubai Marina",   "category": "sale"},
            {"title": "Dubai 3bed",   "bedrooms": 3, "locality": "Dubai Marina",   "category": "sale"},
            {"title": "Sharjah 2bed", "bedrooms": 2, "locality": "Sharjah",        "category": "sale"},
        ]
        result = _filter_by_prefs(props, bedrooms=2, locality="Dubai Marina")
        titles = [p["title"] for p in result]
        assert "Dubai 2bed"   in titles
        assert "Dubai 3bed"   not in titles
        assert "Sharjah 2bed" not in titles

    def test_pagination_scenario_stops_when_5_found(self):
        """
        Simulates pagination: accumulate properties page by page.
        Pagination should stop as soon as count of (correct + null) >= 5.
        """
        # Simulate pages of results arriving — page 1 has 3 matching, page 2 adds 2 more
        page1 = [
            {"title": f"P1-Match-{i}", "bedrooms": 2, "category": "rent"} for i in range(3)
        ]
        page2 = [
            {"title": f"P2-Match-{i}", "bedrooms": 2, "category": "rent"} for i in range(2)
        ] + [
            {"title": "P2-Wrong", "bedrooms": 4, "category": "rent"}
        ]

        # After page 1 — only 3 matches, below threshold of 5
        after_page1 = _filter_by_prefs(page1, bedrooms=2)
        assert len(after_page1) == 3  # should continue paginating

        # After page 2 — 5 matches, at or above threshold
        combined = page1 + page2
        after_page2 = _filter_by_prefs(combined, bedrooms=2)
        assert len(after_page2) >= 5  # should STOP paginating


# ─────────────────────────────────────────────────────────────────────────────
# 5. STATE MERGE LOGIC
# ─────────────────────────────────────────────────────────────────────────────

class TestStateMerge:
    """Tests that stored prefs + current message prefs merge correctly."""

    def test_stored_prefs_preserved_on_navigation(self):
        """When user says 'next', stored prefs (bedrooms=3, rent) must survive."""
        stored = {"category": "rent", "bedrooms": 3, "locality": "Sliema", "city": "Malta"}
        current_msg_prefs = _parse_prefs_from_message("next site")
        merged = {**stored, **current_msg_prefs}
        # Navigation message adds nothing — stored prefs intact
        assert merged["category"] == "rent"
        assert merged["bedrooms"] == 3
        assert merged["locality"] == "Sliema"

    def test_current_message_overrides_stored(self):
        """New explicit preference in current message overrides stored value."""
        stored = {"category": "rent", "bedrooms": 3}
        current_msg_prefs = _parse_prefs_from_message("actually show me 4 bedroom")
        merged = {**stored, **current_msg_prefs}
        # Current message says 4 → should override stored 3
        assert merged["bedrooms"] == 4
        assert merged["category"] == "rent"  # unchanged since not in current msg

    def test_partial_answer_merged(self):
        """User answered rent/bedrooms earlier, now adds locality — all survive."""
        stored = {"category": "rent", "bedrooms": 3}
        current_msg_prefs = _parse_prefs_from_message("Sliema area please")
        merged = {**stored, **current_msg_prefs}
        assert merged["category"] == "rent"
        assert merged["bedrooms"] == 3
        assert "sliema" in merged.get("locality", "").lower()


# ─────────────────────────────────────────────────────────────────────────────
# RUNNER
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import subprocess
    result = subprocess.run(
        ["python", "-m", "pytest", __file__, "-v", "--tb=short"],
        cwd=os.path.join(os.path.dirname(__file__), "..", ".."),
    )
    sys.exit(result.returncode)
