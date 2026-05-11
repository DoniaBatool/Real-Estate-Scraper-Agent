# Workbench & Property Extractor — Technical Guide

This document explains **what each page does**, **which APIs and libraries are used**, **how OpenAI is configured**, and **how to use the UI step by step**.

---

## Tech stack (high level)

| Layer | Technology |
|--------|--------------|
| **Frontend** | [Next.js](https://nextjs.org/) 16 (App Router), React 19, TypeScript, Tailwind CSS, `axios`, `xlsx` (exports) |
| **Backend** | [FastAPI](https://fastapi.tiangolo.com/) (Python), `uvicorn` |
| **Scraping** | Layered **ScraperEngine** (`httpx` → **Playwright** + `playwright-stealth` → optional proxy), plus dedicated **Playwright** helpers for listing/detail pages |
| **HTML parsing** | `beautifulsoup4`, `lxml` |
| **AI** | [OpenAI](https://platform.openai.com/) Chat Completions API (`openai` Python SDK) |
| **Agency discovery** | [Apify](https://apify.com/) (Google Places–style actor) via `apify-client` |
| **Database** | PostgreSQL / Supabase (when saving from workbench flows) |
| **Env** | `backend/.env` (loaded by `pydantic-settings`) |

Browser → Next.js often calls **`/api/...`** on the same origin; `frontend/app/api/[...path]/route.ts` **proxies** those requests to FastAPI (default `http://127.0.0.1:8000` unless overridden).

---

## OpenAI — which model where?

| Setting / code path | Model | Notes |
|---------------------|--------|--------|
| **`OPENAI_MODEL` in `backend/.env`** | User-defined (example: `gpt-4o-mini`) | Read as `settings.openai_model` in `backend/config.py` (default **`gpt-4o-mini`** if unset). |
| **Extractor: `POST /api/workbench/extract-single`** (`extract_property_detail_universal`) | **`settings.openai_model`** (e.g. `gpt-4o-mini`) | On rate/context errors it may **retry** with a **smaller HTML slice** and **`gpt-4o-mini`**. |
| **Workbench bulk extract: `POST /api/workbench/extract`** (comprehensive prompt in `workbench.py`) | **`gpt-4o`** (hardcoded in router) | Uses `smart_scrape` HTML + JSON-LD + meta + first chunk of HTML. |
| **HOQ list & detail** (`/api/workbench/hoq/scrape-list`, `.../scrape-detail`) | **`settings.openai_model`** via `call_openai` in `backend/ai/extractor.py` | Playwright HTML → LLM JSON (list rows / detail object), then HTML supplements (sqm, description, etc.). |
| **ARIA / other tools** | Often `gpt-4o-mini` in code paths | Separate from Workbench/Extractor tables. |

**Important:** Changing `.env` **`OPENAI_MODEL`** affects HOQ list/detail, universal extract-single, and other `call_openai` callers; **`/api/workbench/extract` still uses `gpt-4o`** until that line is changed in code.

---

# Page 1: **Workbench** (`/workbench`)

### Purpose

Focused **Homes of Quality (HOQ)**-style workflow: load listing grid from a **fixed listing index URL**, optionally load more pages, **select rows**, run **per-property detail scrape**, merge listing + detail, export / save.

*(There is also a Malta agencies block and optional title that includes selected agencies.)*

### Main approach (data flow)

1. **Listings** — Frontend calls **`POST /api/workbench/hoq/scrape-list`** with:
   - base listing URL (default HOQ latest properties),
   - page index and how many pages to fetch in one request.
   - Backend loads the page with **Playwright**, trims HTML for the model, then **`call_openai`** with **`settings.openai_model`** returns a **JSON list** of properties; rows are normalized and deduped. Pagination hints come from DOM parsing of the same HTML.

2. **Detail for selected** — For each selected **reference**, frontend calls **`POST /api/workbench/hoq/scrape-detail`** (batched per ref). Backend again uses **Playwright** + **LLM JSON** (`HOQ_DETAIL_PROMPT`), then **fills/corrects** fields from raw HTML (description, sqm, images, room dimensions).

3. **Merge** — UI merges **listing row + detail row** so the table shows one combined view.

4. **Save / export** — Uses existing workbench save / XLSX export helpers on the merged rows.

### Buttons & controls (what they do)

| UI element | Behaviour |
|------------|-----------|
| **Real estate agencies (Malta)** | City/locality → **`POST /api/workbench/discover`** (Apify) → table of agencies with websites. Checkboxes update the **property listings section title** to include selected agency names. |
| **No. of pages** | How many HOQ listing **index pages** to pull in one “load” call. |
| **🔄 Load listings** | Calls `hoqScrapeList` from page 1 (or as implemented) with `pagesToFetch`; fills the **listings table**. |
| **Load all pages** | Loads up to the detected total listing pages (confirmation if large). |
| **✅ Select all / Clear selection** | Selects or clears rows in the **filtered** listing table. |
| **🔍 Get detail for selected (N)** | For each selected reference, calls **`hoqScrape-detail`**; fills **detail extraction** section / merged rows. |
| **Sort & filters** | Client-side filter/sort on loaded rows. |
| **Export (CSV / Excel / JSON)** | Exports current merged or listing data (see buttons on that page). |
| **Save to database** | Posts merged payload to **`POST /api/workbench/save`** (agency/city/country metadata). |

### When to use Workbench

- You want the **built-in HOQ listing + detail pipeline** and exports tied to that flow.
- You do **not** need arbitrary agency site URL crawling (that’s more Extractor).

---

# Page 2: **Property Extractor** (`/workbench/extract`)

### Purpose

**Any agency site:** crawl internal URLs with Playwright (BFS), optionally **filter** URLs that look like property pages, **bulk extract** rows into a table, then **deep enrich** selected rows using the **full listing URL** + crawl pool.

### Main approach (data flow)

1. **Step 1 — Crawl (`POST /api/workbench/fetch-urls`)**  
   - User enters **agency base or listing URL** and **Max pages to open**.  
   - Backend runs **breadth-first Playwright crawl** on the same registrable domain (after redirects, domain may be corrected).  
   - Collects internal `<a href>` links, buckets them (`property_pages`, `listing_pages`, etc.), returns **`all_urls`** + groups.  
   - Frontend stores **`allCrawlUrls`** for later “find pages mentioning reference”.

2. **Optional — Scan & keep only property-like pages (`POST /api/workbench/qualify-property-urls`)**  
   - Quick **ScraperEngine** pass per URL + heuristics (reference, contact, bed/bath/schema).  
   - Narrows the list before expensive LLM extract.

3. **Extract (bulk)** — For first N URLs, **`POST /api/workbench/extract-single`** per URL (universal property extractor):  
   - Prefer **Playwright HTML** when `take_screenshot=True` from API.  
   - **Deterministic HTML parsing** (feature tables, contact blocks, Perry-style fields) **merged with** LLM JSON.  
   - Some numeric fields prefer deterministic values over wrong LLM guesses.

4. **Deep extract (selected rows)**  
   - Uses row’s **`listing_url`** first.  
   - Calls **`/api/workbench/extract`** and **`/api/workbench/extract-single`**, picks the **richer** payload (field score).  
   - Optionally follows URLs from **`allCrawlUrls`** that match the **reference** (including **`/match-reference-urls`** HTML scan).  
   - Merges into the row (prefer incoming for listing URL pass; fill-empty for other URLs).

### Buttons & controls (how to use Extractor)

| Step | What to do |
|------|------------|
| **1** | Enter **agency website URL**. Set **Max pages** (start small, e.g. 40–120). Click **🔍 Crawl all pages**. Wait — Playwright can take minutes. |
| **2 (optional)** | Click **Scan & keep only property-like pages** if you want fewer junk URLs. Toggle **Require agent…** if you want stricter filtering. |
| **3** | Set **URLs to extract** count → **Extract (N) →**. Wait for the **Extracted Data** table. |
| **4** | Tick row checkboxes → **⚡ Deep extract** to enrich from **listing URL** + related crawl URLs (often fixes wrong beds/baths when the feature table in HTML is correct). |

### Extractor table columns

Columns are defined in `frontend/app/workbench/extract/page.tsx` (`COLUMNS` + `normalizeProperty`). Newer fields include **sitting room, hallway, laundry, garage, garage capacity, yard, roof, terrace** when the listing HTML exposes them (e.g. Perry “Property Features” table).

---

## Running locally (quick reference)

**Backend**

```bash
cd /path/to/AI_Sraper_RealEstate
source .venv/bin/activate
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

**Frontend**

```bash
cd frontend
npm run dev
```

Ensure **`OPENAI_API_KEY`** (and **`APIFY_API_TOKEN`** for Malta agency discovery) are set in `backend/.env`. Playwright browsers: `python -m playwright install chromium` inside the venv if needed.

---

## Key API routes (summary)

| Route | Used by |
|-------|---------|
| `POST /api/workbench/fetch-urls` | Extractor crawl |
| `POST /api/workbench/qualify-property-urls` | Extractor filter |
| `POST /api/workbench/match-reference-urls` | Deep extract reference → URLs |
| `POST /api/workbench/extract-single` | Universal single-page extract |
| `POST /api/workbench/extract` | Workbench-style comprehensive extract (gpt-4o) |
| `POST /api/workbench/hoq/scrape-list` | Workbench listings |
| `POST /api/workbench/hoq/scrape-detail` | Workbench detail |
| `POST /api/workbench/discover` | Malta agencies (Apify) |
| `POST /api/workbench/save` | Persist merged properties |

---

## Design philosophy (short)

- **Workbench** = opinionated **HOQ** pipeline (fast path for one known site pattern).  
- **Extractor** = **generic** agency pipeline (crawl → filter → extract → deep merge).  
- **Reliability** = combine **Playwright-rendered HTML**, **deterministic parsers** for stable tables, and **LLM** for messy text — with merges that avoid “LLM wrong but non-empty” blocking corrections.

---

*Last updated to match repository behaviour at authoring time. If behaviour drifts, grep the referenced files and this document together.*
