# ARIA — Claude Project Memory

> **Read this before touching any code.** This file captures every hard-won lesson from debugging ARIA. Violating these rules will re-introduce bugs that took hours to find.

---

## Project Overview

ARIA is an AI-powered real estate search assistant. Users describe what they want in plain language; ARIA scrapes live agency websites, filters results, and shows property cards in a chat UI.

**Stack:**
- **Frontend:** Next.js (App Router) — `/frontend`
- **Backend:** FastAPI + OpenAI Agents SDK — `/backend`
- **Scraper:** Stagehand v3 + Playwright (runs inside Next.js API routes)
- **AI:** OpenAI `gpt-4o-mini` throughout

---

## Architecture & Data Flow

```
User (chat UI)
  → frontend/app/chat/page.tsx   [axios, 360s timeout]
  → backend/routers/chat.py      [FastAPI, no timeout — uvicorn holds]
  → backend/ai/aria_agent.py     [OpenAI Agents SDK Runner.run()]
  → backend/ai/aria_agents_tools.py  [9 @function_tool decorators]
  → backend/ai/aria_tool_runner.py   [httpx calls to Next.js routes]
  → frontend/app/api/stagehand/scrape-url/route.ts   [Playwright + Stagehand]
  → frontend/app/api/stagehand/property-details/route.ts
```

### The 9 Tools
All registered in `backend/ai/aria_agents_tools.py` as `@function_tool`:
1. `find_agencies` — Apify Google Search → finds real estate agencies
2. `live_search_properties` — searches across multiple agency URLs sequentially
3. `scrape_website` — scrapes a single specific URL
4. `web_search` — Tavily (primary) → DuckDuckGo (fallback)
5. `compare_properties` — pure Python comparison logic
6. `market_insights` — LLM-generated market analysis
7. `investment_calculator` — pure math, no external calls
8. `currency_converter` — pure math, no external calls
9. `get_property_details` — scrapes individual property detail page

---

## Timeout Chain — DO NOT CHANGE WITHOUT READING THIS

Every layer has a timeout. They must be set in descending order (innermost longest, outermost shortest) so that inner layers fail gracefully before outer layers kill the connection.

| Layer | Value | File | Why |
|---|---|---|---|
| Frontend axios | 360s | `frontend/lib/api.ts` | User-facing, must outlast everything |
| Next.js `maxDuration` (scrape) | 200s | `scrape-url/route.ts` line 2 | Next.js kills route at this limit |
| Next.js `maxDuration` (details) | check file | `property-details/route.ts` | Same |
| Python httpx default | 250s | `aria_tool_runner.py` `_call_stagehand()` | Must be > maxDuration |
| `live_search_properties` call | 250s | `aria_tool_runner.py` line ~363 | Explicit override |
| `scrape_website` call | 250s | `aria_tool_runner.py` line ~605 | Explicit override |
| `get_property_details` call | 200s | `aria_tool_runner.py` line ~806 | Property detail pages are faster |
| Apify HTTP call | 60s | `aria_tool_runner.py` line ~144 | Apify is fast |

**Rule:** If scrapes start timing out again, increase `maxDuration` in `route.ts` AND `_call_stagehand` timeout in `tool_runner.py` together. Never increase just one.

**How timeouts manifest at the frontend:**
- httpx `ReadTimeout` → `_call_stagehand` returns `{"skipped": True, "reason": "site_unreachable"}` → ARIA says "site unreachable"
- Next.js `maxDuration` exceeded → TCP connection closed → httpx `ReadError` (caught by generic `except Exception`) → ARIA gets `{"error": "..."}` → shows "no results" or error fallback
- Axios 360s exceeded → `err.message.includes("timeout")` → frontend shows "⏱️ The request timed out"

---

## Scraper Configuration — Critical Settings

### MAX_PAGES (scrape-url/route.ts)
```typescript
const MAX_PAGES = 4;       // KEEP AT 4. Was 10, caused 150s+ scrapes → timeout.
const TARGET_FILTERED = 5; // Stop once 5 filtered matches found.
```
**Never set MAX_PAGES > 5.** At ~45s/page, 5 pages = 225s which exceeds maxDuration.

### Headless Mode
```typescript
...(process.env.HEADLESS === "true" ? ["--headless=new"] : []),
```
- Default (no env var): browser opens visibly — good for local debugging
- `HEADLESS=true` in `.env.local`: runs headless — use for production testing
- Production (Browserbase): headless handled server-side

### Chrome Flags — What's There and Why
```typescript
// --no-sandbox: Linux only — macOS Chrome warns if you pass it on Mac
...(process.platform === "linux" ? ["--no-sandbox"] : []),
"--disable-dev-shm-usage",  // Prevents crashes in containers
"--disable-gpu",             // Headless stability
// "--disable-setuid-sandbox"  ← REMOVED. Deprecated in newer Chrome, causes warning.
"--disable-blink-features=AutomationControlled",  // Stealth
```
**Never add `--disable-setuid-sandbox` back.** It's deprecated and causes Chrome to print warnings every launch.
**Never add `--no-sandbox` unconditionally.** On macOS it causes "unsupported command-line flag" warning. Only add it on Linux (`process.platform === "linux"`).

### Stagehand Environment
```typescript
const IS_BROWSERBASE = process.env.STAGEHAND_ENV === "BROWSERBASE";
```
- Local dev: `STAGEHAND_ENV` not set → LOCAL mode → uses your installed Chrome
- Production (Vercel): set `STAGEHAND_ENV=BROWSERBASE` → uses Browserbase cloud browser
- `STAGEHAND_API_KEY` is NOT needed — Browserbase uses `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`

---

## `live_search_properties` — Must Pass Bedrooms/Locality to Route

**Bug fixed (round 1):** `live_search_properties` was not passing `bedrooms`, `bathrooms`, or `locality` to the scrape-url route. This caused two silent failures:

1. **Only 1 property shown:** The route's `countFilteredMatches` had no bedroom filter → it counted ANY 5 raw properties as "done" → pagination stopped after page 1. The LLM received all 5 but only 1 matched the user's bedroom count → only 1 shown.
2. **Wrong properties shown:** Python-side `_filter_by_prefs` also only filtered by `category` + `property_type`, ignoring bedrooms/locality.

**Fix (aria_agents_tools.py):** Added `bedrooms`, `bathrooms`, `locality` to the `live_search_properties` tool signature. ARIA now passes these when the user specifies them.

**Fix (aria_tool_runner.py):** `live_search_properties` now includes bedrooms/bathrooms/locality in the route payload AND in the `_filter_by_prefs` call.

**Rule:** Whenever `live_search_properties` is called with bedroom/locality prefs, they MUST be forwarded to the route. Without this, pagination stops too early and bedroom-filtered results are wrong.

---

## `live_search_properties` — Double-Filter Bug (Python Re-Applying Route's Bedroom Filter)

**Bug fixed (round 2):** Even with bedrooms correctly passed to the route, only 1 property was returned in cases where the site had only 1 bedroom-matching property.

**Root cause — the double-filter chain:**
1. Route paginates 4 pages but only finds 1 property with the correct bedroom count
2. Route's soft-padding (`finalProperties.length < 3`) adds up to 4 extras — these extras only required category match, NOT bedroom match → they had bedrooms=3/4/5/6
3. Route returns 5 properties (1 correct + 4 wrong-bedroom padded extras)
4. Python `_filter_by_prefs` re-applies bedroom filter → strips the 4 padded extras → returns 1 property

**Fix 1 (scrape-url/route.ts — soft padding):** Soft-padding extras now also must match bedrooms (null or exact match). Wrong-bedroom extras are no longer added.
```typescript
// Added to the soft-padding filter:
if (bedrooms != null && !isNaN(Number(bedrooms))) {
    const reqBeds = Number(bedrooms);
    if (p.bedrooms != null && p.bedrooms !== reqBeds) return false;
}
```

**Fix 2 (aria_tool_runner.py — skip Python bedroom re-filter):** `live_search_properties` no longer re-applies bedroom/bathrooms/property_type filters in Python. The route is the authoritative filter. Python only applies HARD safety checks (locality + category):
```python
# Before (caused the bug): re-applied bedrooms → stripped padded extras → 1 result
filtered_props = _filter_by_prefs(props, category=..., bedrooms=..., ...)

# After (fix): only HARD safety checks — route already handled bedrooms
filtered_props = _filter_by_prefs(props, category=category, locality=locality_arg or "")
```

**Fix 3 (scrape-url/route.ts — images):** Each property was getting only 1 image (`realImgs.slice(0, 1)`). Changed to 5 images per property.

**Rule:** The scrape-url route's bedroom filtering is authoritative for `live_search_properties`. Python must NOT re-apply bedroom filter on top of the route's output — this undoes the route's soft-padding and reduces results to 1. Python only adds locality/category safety checks.

---

## `property-details` Route — maxDuration Must Match Scrape Route

**Bug fixed:** `property-details/route.ts` had `maxDuration = 120` while scrape-url has `maxDuration = 200`. The property-details route takes screenshots + extracts data = 90-150s. At 120s Next.js killed it → "More Details" showed no result.

**Fix:** `property-details/route.ts` maxDuration raised to 200. Both routes now have the same limit.

**Rule:** Both `scrape-url/route.ts` AND `property-details/route.ts` must have matching `maxDuration`. If you increase one, increase the other. The Python httpx timeout for `get_property_details` (200s) must be ≤ `maxDuration`.

---

## Chrome Flags — Platform-Conditional Rules

**`--no-sandbox`:** Only add on Linux. On macOS, Chrome shows "unsupported command-line flag" warning.
```typescript
...(process.platform === "linux" ? ["--no-sandbox"] : []),
```

**`--disable-setuid-sandbox`:** NEVER add — deprecated in all Chrome versions, causes warnings everywhere.

**`--no-zygote` / `--single-process`:** Only add when `CHROME_PATH` is set (GCP/Docker deployment).

---

## Lazy Loading — Scroll Strategy

**Bug:** Scrolling to 60% of page height missed lazy-loaded property cards on many sites. Extraction only saw 1-2 cards → 1-2 properties returned.

**Fix:** Scroll in 3 steps — 40% → 70% → 100% (bottom), then back to top. This triggers progressive lazy loading on all major real estate sites.

```typescript
await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight * 0.4); });
await page.waitForTimeout(600);
await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight * 0.7); });
await page.waitForTimeout(600);
await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }); // bottom
await page.waitForTimeout(800);
await page.evaluate(() => { window.scrollTo(0, 0); }); // back to top for extraction
await page.waitForTimeout(400);
```

**Rule:** Never scroll to only one position. Always scroll in sections ending at the bottom, then back to top before extracting.

---

## Permanently Removed Features — Never Add Back

### `_pre_check_url()` — REMOVED
**Was:** A HEAD-request pre-flight check before scraping.
**Problem:** Many real estate sites block HEAD requests (bot detection). Returns `False` even for perfectly reachable sites → ARIA said "currently unreachable" for every site.
**Fix:** Removed from both `scrape_website` and `live_search_properties` in `aria_tool_runner.py`.
**Rule:** Do NOT add any pre-flight URL check. Let Stagehand attempt the full navigation — it handles failures internally.

---

## Bot Detection / Cloudflare Handling

### Detection (scrape-url/route.ts)
After `page.goto()`, the route checks the page content:
```typescript
const isBotBlocked =
  /verifying you are (a )?human/i.test(bodyText) ||
  /just a moment/i.test(pageTitle) ||
  /cf-challenge/i.test(bodyText) ||
  /enable javascript and cookies/i.test(bodyText) ||
  /ddos protection/i.test(bodyText) ||
  /security check/i.test(pageTitle);
```
Returns `{ bot_blocked: true, reason: "bot_blocked" }`.

### Handling (aria_tool_runner.py)
Both `live_search_properties` and `scrape_website` check for `bot_blocked` and return a clear message to ARIA: *"🛡️ {domain} is protected by Cloudflare/bot-detection..."*

**Known bot-blocked sites:** yellow.com.mt (Cloudflare Turnstile). Cannot be scraped with local Playwright. Browserbase has anti-bot capabilities that may work.

---

## The `_raw_` Field Pattern

**Problem:** Property detail pages return `page_screenshot` and `carousel_screenshots` as base64 strings. If sent to the LLM, they consume enormous token budgets.

**Solution:** `aria_tool_runner.py` renames them to `_raw_` prefix before returning to `aria_agents_tools.py`:
```python
result["_raw_page_screenshot"] = data.pop("page_screenshot", "")
result["_raw_carousel_screenshots"] = data.pop("carousel_screenshots", [])
```

Then `aria_agents_tools.py` stores them in `last_properties` for the frontend, but strips all `_raw_` fields before returning the tool result to the LLM:
```python
clean = {k: v for k, v in prop.items() if not k.startswith("_raw_")}
```

**Rule:** Any large binary/base64 field added in future must follow this pattern. Never send base64 to the LLM.

---

## Image Display — How It Works

### Scraper → Frontend Flow
1. `scrape-url/route.ts` extracts `images[]` (http/https URLs) from each listing
2. `aria_tool_runner.py` filters to http-only images, max 5 per property
3. Frontend `PropertyCard` reads `images[]` from `meta.properties[]`
4. Images are proxied through `/api/proxy-image` to avoid CORS issues

### Proxy Route (`frontend/app/api/proxy-image/route.ts`)
Accepts any `http://` or `https://` URL. Previously had a strict domain allow-list — that was removed.
```typescript
function isAllowed(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}
```
**Rule:** Do not add a domain allow-list back. It will break images from new agencies.

### `validImages` Filter (chat/page.tsx)
```typescript
const validImages = (p.images || [])
  .filter(u => u && (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")))
  .map(u => proxyImg(u, agencyWebsite));
```
**Rule:** This filter must accept both `http://`, `https://`, and `data:` URIs. Do not restrict to `data:` only.

### Gallery Image Order (chat/page.tsx) — CRITICAL

**Bug fixed:** Gallery was built as `[carouselShots, pageShot, validImages]`. The first `carouselShot` is a Playwright screenshot taken the moment the browser opens the detail page — often a white/blank loading state. This appeared as the hero (first) image on every card after "More Details".

**Fix:** Reorder to put real property photos first:
```typescript
const allGalleryImages = [
  ...validImages,                                                      // FIRST: real property photos (http/https URLs)
  ...carouselShots.filter(s => !validImages.includes(s)),              // SECOND: carousel screenshots (no duplicates)
  ...(pageShot && !validImages.includes(pageShot)
      && !carouselShots.includes(pageShot) ? [pageShot] : []),         // LAST: full-page screenshot (no duplicates)
].filter(Boolean);
```

**Rule:** `validImages` (URL-based real photos) MUST always come first in `allGalleryImages`. `carouselShots` are Playwright browser screenshots — their first frame captures the loading state, not the property. Never put them first.

---

## Blank Image Filtering — Multi-Layer Defence

Blank images enter the gallery from three sources. Each is filtered at its own layer:

### Layer 1: `isValidSrc` in scrape-url/route.ts
```typescript
const isValidSrc = (src: string) => {
  if (!src) return false;
  if (src.startsWith("data:image/svg")) return false; // SVG = icon/logo
  if (src.startsWith("data:image")) {
    const base64Part = src.split(",")[1] || "";
    return base64Part.length > 200; // < 200 chars ≈ 1x1 pixel or blank
  }
  if (!src.startsWith("http")) return false;
  const lower = src.toLowerCase();
  if (/logo|icon|avatar|spinner|blank|placeholder|pixel|1x1|tracking|\.svg/.test(lower)) return false;
  return true;
};
```

### Layer 2: `screenshotHeroImage` in property-details/route.ts — buffer size gate
```typescript
if (buf.length < 5000) return ""; // blank/solid-color JPEG compresses to < 5KB
```
A blank white 200×150 JPEG at quality 85 compresses to ~2-3KB. Real property photos are 20KB+.

### Layer 3: `carouselShots` filter in chat/page.tsx — minimum base64 length
```typescript
const MIN_SCREENSHOT_B64 = 5000;
const carouselShots = (p.carousel_screenshots || [])
    .filter(s => s && s.startsWith("data:image/") && s.length > MIN_SCREENSHOT_B64);
```

### Layer 4: `handleImgError` in PropertyCard — removes failed URL images from array
```typescript
const handleImgError = (src: string) => {
  setFailedImgs(prev => new Set([...prev, src]));
  setHeroIdx(prev => Math.max(0, prev > 0 ? prev - 1 : 0));
};
```
`failedImgs` feeds back into `validImages` filter, removing the broken URL from `allGalleryImages`. The gallery count automatically decreases — no empty slots.

**What was removed:** The fallback full-viewport screenshot in property-details (taken when no carousel found). It showed page layout (nav bars, text), not a property photo.

**Rule:** Every new image source must pass through one of these layers. Never add images to `allGalleryImages` without size/content validation.

---

## Data Consistency — "More Details" Merge

**Problem:** Initial scrape extraction (from listing card) gives approximate data (e.g., 2 bed). Property detail page gives accurate data (e.g., 3 bed). These were shown inconsistently.

**Fix:** After "More Details" returns, `chat/page.tsx` merges the detail-page data back into the original card matched by `listing_url`:
```javascript
if (trimmed.startsWith("More details about:") && detailProps.length > 0) {
  // find matching card by listing_url and overwrite with detail data
}
```
**Rule:** The merge key is `listing_url`. Both the card and detail response must include it. Do not remove `listing_url` from either schema.

---

## Clarifying Questions — Guard Logic

**Problem:** ARIA was asking 2 rounds of clarifying questions when a user gave a URL then answered preference questions.

**Root cause:** `_build_intent_hint` in `aria_agent.py` has a no-location guard that fires when a message has no city/country. It was incorrectly firing for preference replies ("buying, apartment, 2 bedroom") even when a URL was already in context.

**Fix:** Added `_is_url_context_pref_reply` guard:
```python
_is_url_context_pref_reply = bool(agency_urls) and _is_pref_reply(msg)
if not _has_location(msg) and not city and not _is_url_context_pref_reply:
    # no-location guard only fires when no URL context exists
```

**Rule:** The no-location guard must always check `agency_urls` in history before firing. If a URL was shared earlier in the conversation, skip the "which city?" question.

---

## Environment Variables

### Backend (`backend/.env`)
| Var | Maps to | Notes |
|---|---|---|
| `OPENAI_API_KEY` | `settings.openai_api_key` | Required |
| `APIFY_API_KEY` | `settings.apify_api_key` | For `find_agencies` — has web search fallback |
| `TAVILY_API_KEY` | `settings.tavily_api_key` | `tvly-dev-` prefix = free tier, 1000/month limit |
| `DATABASE_URL` | `settings.database_url` | Postgres (Supabase) |

### Frontend (`frontend/.env.local`)
| Var | Purpose | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Stagehand LLM calls | Required |
| `BROWSERBASE_API_KEY` | Cloud browser (production) | Not needed for local dev |
| `BROWSERBASE_PROJECT_ID` | Cloud browser (production) | Not needed for local dev |
| `STAGEHAND_ENV` | `BROWSERBASE` = cloud, unset = local | Leave unset for local dev |
| `HEADLESS` | `true` = headless Chrome | Leave unset to see browser |
| `NEXT_PUBLIC_API_URL` | Backend URL | Defaults to `http://localhost:8000` |

**`STAGEHAND_API_KEY` is not needed.** Stagehand uses Browserbase keys in cloud mode, local Chrome in dev mode.

---

## Known Service Limits

| Service | Limit | Impact |
|---|---|---|
| Tavily (`tvly-dev-` key) | 1000 searches/month | `web_search` tool fails silently after limit; DuckDuckGo fallback kicks in |
| Browserbase free tier | Check dashboard | Limits on parallel sessions |
| OpenAI `gpt-4o-mini` | Rate limits | Slow responses during high traffic |

---

## Pure Function Contracts (`aria_pure.py`)

These are tested by `test_aria_eval.py`. Do not change signatures without updating tests.

```python
_parse_prefs_from_message(msg: str) -> dict
# Returns: {category, bedrooms, bathrooms, property_type, ...}
# "buying, apartment, 2 bedroom" → {category: "sale", bedrooms: 2, property_type: "apartment"}

_filter_by_prefs(properties: list[dict], *, bedrooms=None, category="", ...) -> list[dict]
# Keyword-only args after properties. Soft filter: returns raw list if all filtered out.
# CALL AS: _filter_by_prefs(props, bedrooms=2) NOT _filter_by_prefs(props, {bedrooms: 2})

_is_no_budget(val: str) -> bool
# True for "no limit", "any", "". False for "".  ← empty string returns False (by design)
```

---

## Reflection Module (`aria_reflection.py`)

```python
MAX_RETRIES = 1   # Only 1 retry attempt. Do not increase — doubles LLM cost.
evaluate_response(user_message, aria_response, tools_called) -> dict
# Returns: {clarity, helpfulness, completeness, tool_usage, on_brand, total,
#           issues, correction_hint, should_retry}
```

`aria_ctx.last_properties` is saved before the retry loop and restored after each retry to prevent stale data leaking between attempts.

---

## Common Failure Patterns & Diagnosis

| Symptom | Root cause | Fix |
|---|---|---|
| "currently unreachable" for working sites | `_pre_check_url` was re-added | Remove it. Never use HEAD pre-check. |
| "currently unreachable" but logs show 200 | httpx timeout < route execution time | Increase httpx timeout and/or maxDuration |
| "⏱️ The request timed out" in chat | Axios 360s exceeded OR Next.js maxDuration hit and connection dropped mid-response | Check maxDuration vs httpx timeout alignment |
| "no X available" for Cloudflare site | Bot challenge page returned 0 results | Check bot_blocked detection in route.ts |
| Images blank on property cards | `validImages` too strict OR proxy allow-list rejecting | Ensure proxy accepts all https, validImages accepts http/https |
| Wrong bed/bath count after "More Details" | Detail data not merged back into card | Check `listing_url` merge logic in chat/page.tsx |
| ARIA asks location when URL already given | `_is_url_context_pref_reply` guard missing/broken | Check `agency_urls` check in `_build_intent_hint` |
| `--disable-setuid-sandbox` warning in Chrome | Deprecated flag re-added to launch args | Remove it. `--no-sandbox` is sufficient. |
| `--disable-blink-features=AutomationControlled` warning | Deprecated in newer Chrome — causes macOS warning | Remove it. Other stealth measures (user-agent rotation, navigator.webdriver override) remain. |
| First property card image is white/blank | `carouselShots` placed before `validImages` in gallery | Reorder: `validImages` first, `carouselShots` after. The first carousel screenshot is always a loading-state capture. |
| Only 1 property shown despite multiple on site (round 2) | Python `_filter_by_prefs` re-applies bedroom filter on top of route's output — strips soft-padded extras | Remove bedroom re-filter from Python `live_search_properties` handler; only apply locality+category safety checks |
| Only 1 image per property card | `realImgs.slice(0, 1)` caps images to 1 | Change to `realImgs.slice(0, 5)` in route.ts |
| Blank image still appears in gallery despite gallery reorder fix | Short base64 carousel shot (loading/transition frame < 5KB) or tiny data: URI slips through | Filter carouselShots by `s.length > 5000`; filter validImages for `data:image/svg` and short data URIs (< 200 chars base64) |
| Broken URL image inflates gallery count but shows as empty slot | onError only hid the `<img>` via CSS but image stayed in `allGalleryImages` array | Use `handleImgError(src)` to add to `failedImgs` Set → React re-filters `validImages` → slot removed from array and count |
| AI SDK "system messages" warning in Next.js logs | Stagehand internal — cannot fix | Harmless, ignore |
| 0 results on first page, fallback tries listing paths | Normal behavior for homepage URLs | Works by design — tries /properties, /for-sale, etc. |

---

## Running the Project

```bash
# Backend
cd backend
uvicorn main:app --reload --port 8000

# Frontend  
cd frontend
npm run dev
```

Both must run simultaneously. Frontend on :3000, backend on :8000.

**After code changes:** Restart both servers. Next.js hot-reloads route handlers but sometimes needs a full restart for Stagehand initialization changes.

---

## Do Not Do List

1. **Do not add `_pre_check_url` back** — breaks scraping for most sites
2. **Do not add `--disable-setuid-sandbox` to Chrome flags** — deprecated, causes warnings
3. **Do not set `MAX_PAGES > 5`** — causes timeout chain failures
4. **Do not add domain allow-list to proxy-image route** — breaks images from new agencies
5. **Do not restrict `validImages` to `data:` only** — breaks http/https image URLs
6. **Do not send base64 fields to the LLM** — use `_raw_` prefix pattern
7. **Do not increase `MAX_RETRIES` above 1** — doubles LLM API cost
8. **Do not add a pre-flight check before Stagehand** — let Stagehand handle failures
9. **Do not change httpx timeout without also changing `maxDuration`** — they must be aligned
10. **Do not call `_filter_by_prefs(props, prefs_dict)`** — second arg is keyword-only
11. **Do not call `live_search_properties` without passing bedrooms/locality** — pagination will stop at 5 random properties, not 5 matching ones
12. **Do not set `maxDuration` on scrape-url without also updating property-details** — both routes must have the same limit
13. **Do not scroll to only one position before extracting** — scroll 40%→70%→100% to trigger all lazy-loaded cards
14. **Do not put `carouselShots` before `validImages` in the gallery** — first carousel screenshot is always a blank loading state; real URL photos must come first
15. **Do not add `--disable-blink-features=AutomationControlled` to Chrome flags** — deprecated in newer Chrome, causes warning on macOS; user-agent + navigator.webdriver override are sufficient stealth
16. **Do not re-apply bedroom filter in Python after `live_search_properties` route call** — the route already filtered by bedrooms; Python re-filter strips padded extras → reduces results to 1. Python safety checks: locality + category ONLY.
17. **Do not add wrong-bedroom properties to the route's soft-padding** — extras added when `finalProperties.length < 3` must also satisfy the bedroom filter (null or exact match), otherwise Python re-filter will strip them.
18. **Do not cap property images at `slice(0, 1)`** — each property should get up to 5 images. The `heroShot ? [heroShot, ...realImgs.slice(0,4)] : realImgs.slice(0,5)` pattern.
19. **Do not include carouselShots shorter than 5000 base64 chars** — anything shorter is a blank/loading-state screenshot. Filter: `s.length > 5000`.
20. **Do not accept `data:image/svg` in validImages** — SVG images are icons/logos, not property photos. Filter them out.
21. **Do not use CSS `display:none` alone to handle broken images** — the image stays in `allGalleryImages`, inflating the count. Use `handleImgError(src)` which adds to `failedImgs` Set so React removes it from the array entirely.
22. **Do not add the fallback full-viewport screenshot in property-details** — it captures page layout (nav, text, whitespace), not a property photo. When no carousel images are found, return empty `carousel_screenshots: []`.
