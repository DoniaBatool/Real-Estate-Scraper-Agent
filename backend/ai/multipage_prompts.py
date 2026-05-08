"""Prompts for multi-page agency scrape: agency-only, single property, listings fallback."""

AGENCY_INFO_PROMPT = """
You are a real estate data extraction specialist.
Extract AGENCY / BUSINESS information only from this HTML (footer, header, contact blocks matter).
Return ONLY valid JSON. No markdown fences. No explanation.

Fields (null if not found):
- agency_name (string)
- owner_name (explicit: founder, director, CEO, MD, owner — not generic "team")
- founded_year (integer)
- email (array of every distinct email)
- phone (array of phone numbers as strings)
- whatsapp (string URL or number if clear)
- facebook_url, instagram_url, linkedin_url, twitter_url (full URLs)
- youtube_url (full URL if present)
- google_rating (float), review_count (integer)
- price_range_min, price_range_max (float), currency (EUR/USD/GBP/AED etc.)
- specialization (one of: residential/commercial/luxury/all)
- description (max 400 characters — agency description / tagline)
- logo_url (absolute URL)
- address (single office address string if visible)
- property_categories (array of strings — departments shown in nav e.g. "For sale", "Long lets")

Do NOT include a "properties" field. Return ONLY the keys above.
"""

SINGLE_PROPERTY_PROMPT = """
Extract ONE property listing from this HTML (a single detail page).
URL of page: {url}
Return ONLY valid JSON. No markdown. No explanation.

Use STRUCTURED DATA section if provided (JSON-LD) — it is authoritative when present.

Fields (null if absent — never invent numbers):
- title (string)
- property_type (villa/apartment/townhouse/penthouse/commercial/land/studio/farmhouse/other)
- category (marketing label e.g. luxury / seafront — or transaction hint sale/rent if clearly labelled)
- bedrooms (int), bathrooms (int)
- bedroom_sqm, bathroom_sqm, living_room_sqm, kitchen_sqm (floats in square metres)
- total_sqm (float), plot_sqm (float)
- floor_number (int), total_floors (int), year_built (int)
- garage (boolean), parking_spaces (int)
- price (float), price_per_sqm (float), currency (string)
- price_type (total/per_month/per_week/per_night or null)
- locality, district, city, country, full_address (strings)
- latitude, longitude (floats from map embed / geo meta if present)
- amenities (array of strings), features (array of strings)
- furnished (furnished/unfurnished/part-furnished/null)
- condition, energy_rating (strings if present)
- images (array of absolute image URLs — all major listing photos)
- virtual_tour_url, floor_plan_url (strings)
- description (max 500 chars)
- listing_date (YYYY-MM-DD), listing_reference (string ID / ref)
- listing_url (must be "{url}")

Convert sq ft to m² when needed: divide sq ft by 10.764.
"""

LISTINGS_GRID_PROMPT = """
This HTML is a LISTINGS INDEX / search results page with multiple property cards.
Extract EVERY distinct listing visible.
Return ONLY valid JSON: an object with key "properties" whose value is an ARRAY of objects.
No markdown. No explanation.

Each object should include when visible:
title, property_type, category, bedrooms, bathrooms, total_sqm, price, currency,
price_per_sqm, locality, district, city, country, images (array), description (short),
listing_url (absolute URL to detail page if present on the card or link).

Use null for unknown fields. Do not duplicate the same listing_url twice.
"""
