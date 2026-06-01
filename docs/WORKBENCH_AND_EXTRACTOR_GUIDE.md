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
| **ARIA / other tools** | Often `gpt-4o-mini` in code paths | Separate from Workbench/Extractor tables. |

**Important:** Changing `.env` **`OPENAI_MODEL`** affects universal extract-single and other callers; **`/api/workbench/extract` still uses `gpt-4o`** until that line is changed in code.

---

## `/workbench` → **Property Extractor**

The route **`/workbench`** redirects to **`/workbench/extract`**. There is no separate single-site listing pipeline in this repo — use the extractor (crawl + universal extract) for any agency domain. **Malta agency discovery (Apify)** lives on the extractor page as a convenience panel.

---

# **Property Extractor** (`/workbench/extract`)

### Purpose

**Any agency site:** crawl internal URLs with Playwright (BFS), optionally **filter** URLs that look like property pages, **bulk extract** rows into a table, then **deep enrich** selected rows using the **full listing URL** + crawl pool.

### Main approach (data flow)

1. **Step 1 — Crawl (`POST /api/workbench/fetch-urls`)**  
   - User enters **agency base or listing URL** and **Max pages to open**.  
   - Backend runs **breadth-first Playwright crawl** on the same registrable domain (after redirects, domain may be corrected).  
   - Collects internal `<a href>` links, buckets them (`property_pages`, `listing_pages`, etc.), returns **`all_urls`** + groups.  
   - Frontend stores **`allCrawlUrls`** for later “find pages mentioning reference”.
   - While visiting each page, the API collects references via **`backend/scraper/reference_sniffer.py`**: (1) **regex** on raw HTML for `Reference:`, `Ref:`, etc.; (2) **DOM/CSS** hooks where label and value sit in different nodes — e.g. `<span class="reference-number">90-9269064</span>`, `h6.ref-num`, `[data-reference]`, `<small>Ref: FA701973</small>`. Tokens are deduped into **`references_from_html`**. Every internal URL whose path/query **contains that token** is recorded in **`urls_by_reference`**. The Extractor UI **merges** those URLs into Step 2 with **`reference` prefilled** when the token is known — so even when the grid link has **no ref in the URL**, you still get candidate detail URLs once the same ref appears in **some** link on the site.
   - Within each bucket, URLs are **sorted** so links that already carry a **reference in the query or path** (e.g. `?ref=`, `?reference=`, `/property/…`) appear **first** — those are usually the real single-property detail URLs on multi-agency sites. Generic listing grids without ref in the URL rank lower.

### Reference numbers (extractor)

| Topic | **Extractor (`/workbench/extract`)** |
|-------|----------------------------------------|
| **Sites** | **Any** agency domain you crawl |
| **Where `reference` comes from** | OpenAI JSON (`reference_number`) **plus** deterministic fallbacks in `universal_extractor.py` — URL query keys (`ref`, `reference`, …), path tokens (e.g. `/listings/<uuid>`), HTML feature tables (**REF** / Reference / Listing ID / Property ID), `reference_sniffer.py` regex + DOM hooks, then merge in UI `normalizeProperty` |
| **Why some rows show empty Ref** | Listing-only URLs often **have no ref in the URL**; ref may live only in card HTML. If the model/parser misses it, the cell stays empty until **Deep extract** or a URL that contains the ref is found |

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

Columns are defined in `frontend/lib/workbenchPropertyModel.ts` (`COLUMNS` + `normalizeProperty`). Newer fields include **sitting room, hallway, laundry, garage, garage capacity, yard, roof, terrace** when the listing HTML exposes them (e.g. Perry “Property Features” table).

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
| `POST /api/workbench/discover` | Malta agencies (Apify) |
| `POST /api/workbench/save` | Persist merged properties |

---

## Design philosophy (short)

- **Extractor** = **generic** agency pipeline (crawl → filter → extract → deep merge).  
- **Reliability** = combine **Playwright-rendered HTML**, **deterministic parsers** for stable tables, and **LLM** for messy text — with merges that avoid “LLM wrong but non-empty” blocking corrections.

---

*Last updated to match repository behaviour at authoring time. If behaviour drifts, grep the referenced files and this document together.*
