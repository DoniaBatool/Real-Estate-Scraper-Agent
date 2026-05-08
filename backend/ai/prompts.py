EXTRACTION_PROMPT = """
You are a real estate data extraction specialist.
Extract ALL of the following from this HTML and return ONLY valid JSON.
No markdown. No code blocks. No explanation. Raw JSON only.

AGENCY INFO:
- agency_name, owner_name, founded_year
- email (array — every email found on page)
- phone (array — every phone number found)
- whatsapp
- facebook_url, instagram_url, linkedin_url, twitter_url
- google_rating (float), review_count (int)
- price_range_min (float), price_range_max (float), currency
- specialization (one of: residential/commercial/luxury/all)
- description (max 300 chars), logo_url

PROPERTIES (array — extract EVERY listing visible on this page):
- title
- property_type (one of: villa/apartment/townhouse/commercial/land/other)
- bedrooms (int — null if not found, do NOT guess)
- bathrooms (int — null if not found, do NOT guess)
- total_sqm (float — null if not found, do NOT guess)
- bedroom_sqm (float — null if not found)
- bathroom_sqm (float — null if not found)
- price (float — null if not found, do NOT guess)
- price_per_sqm (float — compute ONLY if both price and total_sqm are found)
- currency (default EUR if in Europe, USD if in USA, AED if in UAE)
- locality (neighborhood name)
- district, city, country
- latitude (float — null if not found)
- longitude (float — null if not found)
- listing_date (YYYY-MM-DD format — null if not found)
- images (array of absolute URLs — empty array if none)
- description (max 200 chars)
- amenities (array of strings — empty array if none)
- listing_url (full URL of this listing if found)

IMPORTANT RULES:
1. Return null for ANY field not found — NEVER guess or fabricate values
2. Extract ALL properties visible — do not stop at first few
3. If only a listing title is visible (detail page not loaded), still include it with null fields
4. Return ONLY raw JSON — no markdown, no ```json wrapper, no explanation
5. If the page has NO properties at all, return empty array: "properties": []

If the page requires login, shows a CAPTCHA, or blocks access:
- Return this exact structure:
  {"notes": "reason here", "agency_name": null, "properties": []}

Expected output structure:
{
  "agency_name": "...",
  "owner_name": null,
  "email": [],
  "phone": [],
  "properties": [...]
}
"""