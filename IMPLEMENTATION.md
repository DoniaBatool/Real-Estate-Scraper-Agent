# Real Estate AI Scraper — Complete Implementation Blueprint
**Stack:** Next.js + FastAPI + Playwright + OpenAI + Supabase + Railway  
**Date:** May 2026 | Version 1.0

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Complete Technology Stack](#2-complete-technology-stack)
3. [System Architecture](#3-system-architecture)
4. [Project Folder Structure](#4-project-folder-structure)
5. [Database Schema](#5-database-schema-supabase-postgresql)
6. [Environment Variables](#6-environment-variables)
7. [Phase-by-Phase Implementation Plan](#7-phase-by-phase-implementation-plan)
8. [Cursor Implementation Prompts](#8-cursor-implementation-prompts)
9. [FastAPI Endpoints Reference](#9-fastapi-endpoints-reference)
10. [Deployment Guide](#10-deployment-guide)
11. [Anti-Detection Checklist](#11-anti-detection--anti-bot-checklist)

---

## 1. Project Overview

The Real Estate AI Scraper is a production-grade, fully automated intelligence system that scrapes any real estate agency in any city and country, extracts structured property and contact data, and presents it in a professional three-view dashboard. No manual data entry required.

### What This System Delivers (End to End)
```
INPUT:  Any city + country  (e.g. "Dubai, UAE" or "Valletta, Malta")

Step 1: Apify discovers all real estate agencies in that location via Google Maps
Step 2: Layered scraper visits each agency website:
        httpx (Level 1) → Playwright stealth (Level 2) → Playwright + Proxy (Level 3)
Step 3: OpenAI GPT-4o-mini extracts structured data from raw HTML
Step 4: All data saved to Supabase PostgreSQL database
Output: Three dashboard views — Agency Cards, Property Table, Pricing Intelligence
Total cost to run: $0 to start (all free tiers)
```

### 1.1 Three Dashboard Views

| View | Data Shown |
|------|-----------|
| **View 1 — Agency Cards** | Agency name, logo, **owner name**, email, phone, WhatsApp, Facebook, Instagram, LinkedIn, Twitter, Google rating, review count, price range, specialization, total listings, website URL |
| **View 2 — Property Table** | Property title, type, bedrooms (count + sqm each), bathrooms (count + sqm each), total sqm, locality, district, GPS coordinates, price, price per sqm, currency, listing date, images, description, category |
| **View 3 — Pricing Intelligence** | Average price per sqm by locality, price range by property type, locality heat ranking, bedrooms vs price chart, interactive Recharts |

---

## 2. Complete Technology Stack

### 2.1 All Tools — Free vs Paid

| Tool | Purpose | Cost |
|------|---------|------|
| Next.js 14 (App Router) | Frontend — three dashboard views | FREE |
| Tailwind CSS | Styling | FREE |
| Recharts | Pricing intelligence charts | FREE |
| TanStack Table | Sortable, filterable property table | FREE |
| FastAPI (Python) | Backend API + scraper orchestration | FREE |
| Playwright + stealth plugin | Browser automation — Level 2 & 3 | FREE |
| httpx + BeautifulSoup | Level 1 fast HTTP scraping | FREE |
| OpenAI GPT-4o-mini | AI extraction from raw HTML | ~$0.002/page |
| Apify Google Maps Actor | Agency discovery by city + country | $5 free/month |
| 2captcha | CAPTCHA solving for blocked sites | $3 per 1000 |
| Supabase PostgreSQL | Primary database | FREE 500MB |
| Upstash Redis | URL dedup cache + job queue | FREE 10k cmds/day |
| Railway | Backend deployment — always on | FREE $5 credit |
| Vercel | Frontend deployment | FREE |

> **Total cost to start: $0** — Claude API only if OpenAI not preferred

### 2.2 Why NO Sub-Agents, MCP, or Orchestration Frameworks?

| Component | Decision |
|-----------|---------|
| Sub-agents / Paperclip | NOT needed — pipeline is linear: discover → scrape → extract → save |
| MCP servers | NOT needed — Apify, OpenAI, Supabase all have direct REST APIs |
| Skills / Plugins | NOT needed — FastAPI route functions serve same purpose cleanly |
| Orchestrator agent | NOT needed — FastAPI background tasks + Redis job queue handles it |
| **Conclusion** | Simple async Python pipeline is the right tool here |

---

## 3. System Architecture

### 3.1 Complete Data Flow

```python
USER INPUT: "Dubai, UAE"
      |
      v
STEP 1 — Agency Discovery (Apify)
  apify_client.actor("apify/google-maps-scraper").call(
    run_input={
      "searchStringsArray": ["real estate agency Dubai UAE"],
      "maxCrawledPlaces": 100
    }
  )
  Output: [{name, address, phone, rating, website_url, ...}]
      |
      v
STEP 2 — Website Scraping (Layered)
  for agency in agencies:
      result = await scrape_level1(agency.website_url)  # httpx
      if not result: result = await scrape_level2(url)  # Playwright stealth
      if not result: result = await scrape_level3(url)  # Playwright + proxy
  Output: raw HTML per agency website
      |
      v
STEP 3 — AI Extraction (OpenAI GPT-4o-mini)
  structured_data = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": EXTRACTION_PROMPT + raw_html}]
  )
  Output: {owner_name, email, phone, social_handles, properties:[...]}
      |
      v
STEP 4 — Database Save (Supabase PostgreSQL)
  INSERT INTO agencies (name, owner, email, phone, ...)
  INSERT INTO properties (agency_id, bedrooms, sqm, price, ...)
      |
      v
STEP 5 — Dashboard (Next.js)
  GET /api/agencies    → View 1: Agency Cards
  GET /api/properties  → View 2: Property Table
  GET /api/pricing     → View 3: Pricing Intelligence
```

### 3.2 Layered Scraping Decision Logic

```python
# backend/scraper/engine.py
async def scrape_website(url: str) -> ScrapedResult:

    # Level 1: Fast HTTP request (no browser) — ~0.5 seconds
    result = await try_httpx(url)
    if result.success and result.has_content:
        return result

    # Level 2: Playwright with stealth plugin — ~3-5 seconds
    result = await try_playwright_stealth(url)
    if result.success and result.has_content:
        return result

    # Level 3: Playwright + residential proxy rotation — ~8-12 seconds
    result = await try_playwright_proxy(url)
    if result.success:
        return result

    # All levels failed — log and continue
    return ScrapedResult(success=False, url=url)
```

### 3.3 OpenAI Extraction Prompt

```python
# backend/ai/prompts.py
EXTRACTION_PROMPT = """
You are a real estate data extraction specialist.
Extract ALL of the following from this HTML and return ONLY valid JSON.

AGENCY INFO:
- agency_name, owner_name, founded_year
- email (all found), phone (all), whatsapp
- facebook_url, instagram_url, linkedin_url, twitter_url
- google_rating (float), review_count (int)
- price_range_min, price_range_max, currency
- specialization (residential/commercial/luxury)
- description, logo_url

PROPERTIES (array, one object per listing):
- title, property_type (villa/apartment/townhouse/commercial/land)
- bedrooms (int), bathrooms (int)
- total_sqm (float), bedroom_sqm (float), bathroom_sqm (float)
- price (float), price_per_sqm (float), currency
- locality, district, city, country
- latitude (float), longitude (float)
- listing_date, images (array of urls), description
- amenities (array of strings)

Return null for any field not found. Never guess. Return ONLY JSON.
"""
```

---

## 4. Project Folder Structure

```
real-estate-scraper/
  ├── backend/                        # FastAPI — Railway pe deploy hoga
  │   ├── main.py                     # FastAPI app entry point
  │   ├── config.py                   # Settings from .env
  │   ├── requirements.txt
  │   ├── .env                        # API keys — NEVER commit
  │   ├── routers/
  │   │   ├── scraper.py              # POST /api/scrape
  │   │   ├── agencies.py             # GET /api/agencies
  │   │   ├── properties.py           # GET /api/properties
  │   │   └── pricing.py              # GET /api/pricing
  │   ├── scraper/
  │   │   ├── engine.py               # Layered decision logic
  │   │   ├── level1_httpx.py         # Level 1: httpx + BeautifulSoup
  │   │   ├── level2_playwright.py    # Level 2: Playwright + stealth
  │   │   ├── level3_proxy.py         # Level 3: Playwright + proxy
  │   │   └── captcha.py              # 2captcha integration
  │   ├── ai/
  │   │   ├── extractor.py            # OpenAI API call + JSON parsing
  │   │   └── prompts.py              # EXTRACTION_PROMPT
  │   ├── discovery/
  │   │   └── apify_client.py         # Apify Google Maps Actor
  │   ├── database/
  │   │   ├── models.py               # SQLAlchemy models
  │   │   ├── connection.py           # Supabase PostgreSQL connection
  │   │   └── crud.py                 # Create/Read/Update/Delete
  │   └── queue/
  │       └── redis_queue.py          # URL dedup + job queue
  │
  ├── frontend/                       # Next.js — Vercel pe deploy hoga
  │   ├── app/
  │   │   ├── layout.tsx
  │   │   ├── page.tsx                # Home — search input
  │   │   ├── agencies/page.tsx       # View 1: Agency Cards
  │   │   ├── properties/page.tsx     # View 2: Property Table
  │   │   └── pricing/page.tsx        # View 3: Pricing Intelligence
  │   ├── components/
  │   │   ├── AgencyCard.tsx
  │   │   ├── PropertyTable.tsx       # TanStack sortable table
  │   │   ├── PricingChart.tsx        # Recharts
  │   │   ├── ScrapeForm.tsx          # City + country input
  │   │   └── StatusBar.tsx           # Live scrape progress
  │   ├── lib/
  │   │   └── api.ts                  # API client functions
  │   ├── types/
  │   │   └── index.ts                # TypeScript interfaces
  │   ├── package.json
  │   └── .env.local
  │
  ├── tests/
  │   ├── test_scraper.py
  │   ├── test_extractor.py
  │   ├── test_api.py
  │   └── test_database.py
  │
  ├── IMPLEMENTATION.md               # This file — Cursor context
  ├── README.md
  └── .gitignore                      # Must include: .env, .env.local
```

---

## 5. Database Schema (Supabase PostgreSQL)

Run this SQL directly in Supabase SQL Editor:

```sql
-- Table 1: Real estate agencies
CREATE TABLE agencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  scraped_at      TIMESTAMPTZ DEFAULT NOW(),
  name            TEXT NOT NULL,
  owner_name      TEXT,
  founded_year    INT,
  description     TEXT,
  logo_url        TEXT,
  website_url     TEXT UNIQUE NOT NULL,
  email           TEXT[],
  phone           TEXT[],
  whatsapp        TEXT,
  facebook_url    TEXT,
  instagram_url   TEXT,
  linkedin_url    TEXT,
  twitter_url     TEXT,
  google_rating   FLOAT,
  review_count    INT,
  specialization  TEXT,
  price_range_min FLOAT,
  price_range_max FLOAT,
  currency        TEXT DEFAULT 'EUR',
  total_listings  INT,
  city            TEXT,
  country         TEXT,
  scrape_level    INT,
  scrape_status   TEXT DEFAULT 'pending'
);

-- Table 2: Individual property listings
CREATE TABLE properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID REFERENCES agencies(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  title           TEXT,
  property_type   TEXT,
  category        TEXT,
  description     TEXT,
  images          TEXT[],
  bedrooms        INT,
  bathroom_count  INT,
  bedroom_sqm     FLOAT,
  bathroom_sqm    FLOAT,
  total_sqm       FLOAT,
  price           FLOAT,
  price_per_sqm   FLOAT,
  currency        TEXT DEFAULT 'EUR',
  locality        TEXT,
  district        TEXT,
  city            TEXT,
  country         TEXT,
  latitude        FLOAT,
  longitude       FLOAT,
  listing_date    DATE,
  amenities       TEXT[],
  listing_url     TEXT
);

-- Indexes for fast filtering
CREATE INDEX idx_properties_agency   ON properties(agency_id);
CREATE INDEX idx_properties_locality ON properties(locality);
CREATE INDEX idx_properties_type     ON properties(property_type);
CREATE INDEX idx_properties_price    ON properties(price);
CREATE INDEX idx_agencies_city       ON agencies(city, country);
```

---

## 6. Environment Variables

### backend/.env
```env
# OpenAI — platform.openai.com
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Apify — apify.com (free $5/month)
APIFY_API_TOKEN=apify_api_...

# Supabase — supabase.com
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres

# Upstash Redis — upstash.com
REDIS_URL=rediss://default:password@xxxx.upstash.io:6379

# 2captcha (only if needed)
CAPTCHA_API_KEY=...

# Proxy — Level 3 only (optional)
PROXY_USERNAME=
PROXY_PASSWORD=
PROXY_HOST=
PROXY_PORT=
```

### frontend/.env.local
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
# Production: NEXT_PUBLIC_API_URL=https://your-app.railway.app
```

---

## 7. Phase-by-Phase Implementation Plan

### Phase 1 — Project Setup + Database + API Foundation (Days 1-2)

**What to build:**
- Complete folder structure from Section 4
- Install all dependencies
- Supabase tables using SQL from Section 5
- FastAPI app with health check
- SQLAlchemy models matching schema
- Upstash Redis connection
- Next.js app with Tailwind CSS

**backend/requirements.txt:**
```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy==2.0.30
psycopg2-binary==2.9.9
asyncpg==0.29.0
python-dotenv==1.0.1
httpx==0.27.0
beautifulsoup4==4.12.3
playwright==1.44.0
playwright-stealth==1.0.6
openai==1.30.0
apify-client==1.7.0
redis==5.0.4
pydantic==2.7.0
pydantic-settings==2.2.1
python-multipart==0.0.9
pytest==8.2.0
pytest-asyncio==0.23.6
```

**frontend/package.json key deps:**
```json
{
  "next": "14.2.3",
  "@tanstack/react-table": "^8.17.0",
  "recharts": "^2.12.7",
  "axios": "^1.7.2",
  "lucide-react": "^0.383.0",
  "tailwindcss": "^3.4.3"
}
```

**Phase 1 complete when:**
- `GET http://localhost:8000/health` returns `{"status": "ok"}`
- Supabase tables visible in dashboard
- Next.js loads at `http://localhost:3000`

---

### Phase 2 — Scraper Engine + Apify + AI Extraction (Days 3-5)

**What to build:**
- `discovery/apify_client.py` — Google Maps Actor
- `scraper/level1_httpx.py` — fast HTTP
- `scraper/level2_playwright.py` — stealth browser
- `scraper/level3_proxy.py` — proxy rotation
- `scraper/engine.py` — layered decision logic
- `scraper/captcha.py` — 2captcha integration
- `ai/prompts.py` — EXTRACTION_PROMPT from Section 3.3
- `ai/extractor.py` — OpenAI call + JSON parsing
- `database/crud.py` — save to Supabase
- `routers/scraper.py` — POST /api/scrape

**Key engine code:**
```python
# backend/scraper/engine.py
import httpx, asyncio, random
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko Firefox/125.0",
    # add 16 more for full rotation
]

class ScraperEngine:
    async def scrape(self, url: str) -> dict:
        # Level 1 — fast, zero cost
        try:
            headers = {"User-Agent": random.choice(USER_AGENTS)}
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers=headers)
                if r.status_code == 200 and len(r.text) > 1000:
                    return {"html": r.text, "level": 1, "success": True}
        except: pass

        await asyncio.sleep(random.uniform(2, 5))  # human delay

        # Level 2 — stealth browser
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await stealth_async(page)
                await page.goto(url, wait_until="networkidle")
                await page.evaluate("window.scrollTo(0, 300)")
                await page.wait_for_timeout(2000)
                html = await page.content()
                await browser.close()
                if len(html) > 1000:
                    return {"html": html, "level": 2, "success": True}
        except: pass

        await asyncio.sleep(random.uniform(2, 5))

        # Level 3 — proxy rotation
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    proxy={
                        "server": f"http://{PROXY_HOST}:{PROXY_PORT}",
                        "username": PROXY_USERNAME,
                        "password": PROXY_PASSWORD
                    }
                )
                page = await browser.new_page()
                await stealth_async(page)
                await page.goto(url, wait_until="networkidle")
                html = await page.content()
                await browser.close()
                return {"html": html, "level": 3, "success": True}
        except: pass

        return {"html": None, "level": 0, "success": False}
```

**Phase 2 complete when:**
- POST `/api/scrape` with `{"city": "Valletta", "country": "Malta"}` returns `job_id`
- Apify returns 5+ agency names and URLs
- Scraper gets HTML from 3 different websites
- OpenAI returns valid JSON with name, email, phone
- Data visible in Supabase

---

### Phase 3 — Next.js Dashboard (Days 6-8)

**What to build:**
- View 1: `app/agencies/page.tsx` + `components/AgencyCard.tsx`
- View 2: `app/properties/page.tsx` + `components/PropertyTable.tsx`
- View 3: `app/pricing/page.tsx` + `components/PricingChart.tsx`
- `components/ScrapeForm.tsx` — city + country input
- `lib/api.ts` — all API calls

**View 1 Agency Card fields:**

| Section | Fields |
|---------|--------|
| Header | Logo, agency name, Google rating stars, review count |
| Owner | Owner name, founded year |
| Contact | Email (mailto:), Phone (tel:), WhatsApp button |
| Social | Facebook, Instagram, LinkedIn, Twitter icons |
| Business | Specialization badge, price range, total listings |
| Footer | Website URL, "View Properties" button |

**View 2 Property Table columns:**
- Property title + type badge
- Agency name (linked)
- Bedrooms count + sqm
- Bathrooms count + sqm
- Total sqm (sortable)
- Price (sortable)
- Price per sqm (sortable — KEY metric)
- Locality + district
- Listing date
- **Filters:** text search, type, bedrooms, locality, price range slider, sqm slider

**View 3 Pricing Charts:**
- Bar chart — avg price/sqm by locality
- Grouped bar — price range by property type
- Scatter — total sqm vs price
- Line — bedrooms vs avg price

**Phase 3 complete when:**
- All views load with real data
- Table sorts and filters on all columns
- All 4 charts render correctly
- ScrapeForm triggers job, StatusBar shows progress

---

### Phase 4 — Hardening + Tests + Deploy (Days 9-10)

**What to build:**
- CAPTCHA detection + 2captcha auto-solve
- Retry logic: 3 attempts, exponential backoff (1s, 2s, 4s)
- Rate limiting: max 10 concurrent, 2s delay between pages
- Redis URL deduplication (7-day TTL)
- Error logging per URL
- CSV + Excel export from property table
- Full pytest test suite
- Railway + Vercel deployment

**Phase 4 complete when:**
- Full pipeline: "Dubai, UAE" → 10+ agencies → all 3 views populated
- All tests pass, 80%+ coverage
- Backend live on Railway, frontend on Vercel
- CSV export works

---

## 8. Cursor Implementation Prompts

> Save this file as `IMPLEMENTATION.md` in your project root.
> In Cursor Chat (Cmd+L), use `@IMPLEMENTATION.md` to load context.

### Phase 1 Prompt
```
@IMPLEMENTATION.md

I am building the Real Estate AI Scraper described in this document.
Implement Phase 1: Project Setup + Database + API Foundation.

1. Create the complete folder structure from Section 4 exactly.
2. Create backend/requirements.txt from the Phase 1 list in Section 7.
3. Create backend/main.py — FastAPI app with:
   - GET /health returning {"status": "ok", "version": "1.0"}
   - CORS configured for http://localhost:3000
   - Router imports for scraper, agencies, properties, pricing
4. Create backend/database/models.py — SQLAlchemy models
   matching the EXACT schema from Section 5.
5. Create backend/database/connection.py — async Supabase connection.
6. Create backend/config.py — Pydantic Settings loading all env vars from Section 6.
7. Create Next.js frontend:
   npx create-next-app@latest frontend --typescript --tailwind --app --no-src-dir
8. Create frontend/types/index.ts — TypeScript interfaces for Agency
   and Property matching the database schema.

Follow Section 4 folder structure exactly.
```

### Phase 2 Prompt
```
@IMPLEMENTATION.md

Phase 1 complete. Now implement Phase 2: Scraper + AI Extraction.

1. Create backend/discovery/apify_client.py:
   - discover_agencies(city: str, country: str) -> list[dict]
   - Uses Apify actor "apify/google-maps-scraper"
   - Search: f"real estate agency {city} {country}"

2. Create backend/scraper/level1_httpx.py — async httpx with UA rotation.
3. Create backend/scraper/level2_playwright.py — playwright-stealth.
4. Create backend/scraper/level3_proxy.py — Playwright + proxy from .env.
5. Create backend/scraper/engine.py — exact layered logic from Section 3.2.
6. Create backend/ai/prompts.py — EXTRACTION_PROMPT from Section 3.3.
7. Create backend/ai/extractor.py — OpenAI gpt-4o-mini + safe JSON parse.
8. Create backend/database/crud.py — save agencies and properties.
9. Create backend/routers/scraper.py:
   - POST /api/scrape accepting {city, country}
   - Full pipeline: discover → scrape → extract → save
   - Returns {job_id, status, agencies_found}

Run: pytest tests/test_scraper.py tests/test_extractor.py -v
All tests must pass.
```

### Phase 3 Prompt
```
@IMPLEMENTATION.md

Phases 1-2 complete. Implement Phase 3: Next.js Dashboard.

1. Create frontend/lib/api.ts:
   - scrapeCity(city, country) → POST /api/scrape
   - getAgencies(filters) → GET /api/agencies
   - getProperties(filters, sort, page) → GET /api/properties
   - getPricingData() → GET /api/pricing

2. Create AgencyCard.tsx showing all fields from View 1 table in Section 7.
   Use lucide-react icons. Clickable email, phone, WhatsApp.

3. Create PropertyTable.tsx using @tanstack/react-table:
   All columns from View 2 in Section 7.
   Sort on all numeric columns. Filter bar with all filters.
   CSV export button.

4. Create PricingChart.tsx with all 4 charts using recharts.
   Summary cards: cheapest/most expensive locality.

5. Create ScrapeForm.tsx — city + country inputs.
   Calls scrapeCity() on submit. Polls GET /api/scrape/{job_id} for progress.

6. Create all page routes per Section 4 structure.

All views must load real backend data. npm run build — zero errors.
```

### Phase 4 Prompt
```
@IMPLEMENTATION.md

Phases 1-3 complete. Implement Phase 4: Hardening + Deploy.

1. Add to engine.py: UA rotation (20 agents), random delay 2-5s,
   asyncio.Semaphore(10) for max concurrency.

2. Create captcha.py: detect "captcha" in HTML → submit to 2captcha
   API → inject solution → continue scraping.

3. Create redis_queue.py: SETEX with 7-day TTL for URL dedup.
   Skip if key exists.

4. Add retry logic to extractor.py: 3 attempts, backoff 1s/2s/4s.

5. Create tests/test_scraper.py, test_extractor.py, test_api.py.
   Run: pytest tests/ -v --cov=backend

6. Create railway.toml:
   [build]
   builder = "NIXPACKS"
   [deploy]
   startCommand = "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"

7. Deploy: railway login && railway init && railway up
   Set all env vars from Section 6 in Railway dashboard.

8. Deploy frontend: vercel --prod
   Set NEXT_PUBLIC_API_URL to Railway URL.
```

---

## 9. FastAPI Endpoints Reference

| Endpoint | Parameters | Description |
|----------|-----------|-------------|
| `POST /api/scrape` | `{city, country}` | Start scrape job. Returns `job_id`. |
| `GET /api/scrape/{job_id}` | path param | Poll job status + progress. |
| `GET /api/agencies` | `?city=&country=&search=&page=1&limit=20` | Paginated agencies. |
| `GET /api/agencies/{id}` | path param | Single agency + all its properties. |
| `GET /api/properties` | `?agency_id=&type=&bedrooms=&locality=&min_price=&max_price=&min_sqm=&max_sqm=&sort=price&order=asc&page=1&limit=50` | Filtered, sorted, paginated. |
| `GET /api/pricing` | `?city=&country=` | Aggregated data for all charts. |
| `GET /api/export/csv` | `?city=&country=` | Download all properties as CSV. |
| `DELETE /api/agencies/{id}` | path param | Remove agency + properties. |

---

## 10. Deployment Guide

### Railway (Backend)
1. Go to railway.app — create account
2. New Project → Deploy from GitHub
3. Set Root Directory: `backend`
4. Add all env vars from Section 6 in Variables tab
5. Copy Railway URL for frontend env

### Vercel (Frontend)
1. Go to vercel.com → Import Git Repository
2. Set Root Directory: `frontend`
3. Add: `NEXT_PUBLIC_API_URL = your-railway-url`
4. Deploy

### Supabase (Database)
1. supabase.com → New Project
2. SQL Editor → paste SQL from Section 5
3. Settings → Database → copy Connection String as DATABASE_URL

### Upstash (Redis)
1. upstash.com → Create Redis database
2. Copy REDIS_URL (starts with `rediss://`)
3. Add to Railway env vars

---

## 11. Anti-Detection & Anti-Bot Checklist

| Technique | Implementation |
|-----------|---------------|
| User-Agent rotation | Pool of 20+ real browser signatures. Rotate randomly per request. |
| Random delays | 2-5 seconds between pages. `random.uniform(2, 5)` |
| Playwright stealth | `playwright-stealth` removes 23 bot detection signals |
| Concurrency limit | Max 10 simultaneous browsers. `asyncio.Semaphore(10)` |
| Cookie handling | Accept all cookies automatically |
| Scroll simulation | `page.evaluate("window.scrollTo(0, 300)")` after load |
| CAPTCHA detection | Check HTML for "captcha" → auto-solve with 2captcha |
| Rate limit handling | HTTP 429 → wait 30s → retry |
| Proxy rotation | Level 3: rotate through proxy pool |
| Redis dedup | Skip URLs scraped in last 7 days |
| Robots.txt | Check before scraping, skip disallowed paths |
| GDPR (EU) | Only scrape publicly visible data |
