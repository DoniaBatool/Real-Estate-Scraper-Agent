# Real Estate AI Scraper & ARIA Intelligence Platform

Production-grade pipeline: discover real-estate agencies (Apify), scrape agency websites (Playwright with multipage flows), extract structured listings with OpenAI, persist to **Supabase PostgreSQL**, and explore everything in a **Next.js** dashboard — centered on **ARIA** (Advanced Real Estate Intelligence Agent), a tool-calling assistant that searches your data, runs scrapes, compares properties, reads market context, and remembers returning users.

---

## What you get

| Capability | Description |
|------------|-------------|
| **Discovery & scrape** | Queue city/country scrapes; multipage listing and detail extraction; anti-detection patterns |
| **Structured data** | Agencies (contacts, socials, ratings) and properties (price, m², beds, amenities, media, extended fields) |
| **Pricing intelligence** | Charts: average €/m² by locality, ranges by type, **m² vs price** scatter, bedrooms vs average price |
| **ARIA chat** | Natural language over your database; optional web search (Tavily + fallback); tools for scrape, pricing, agencies, comparison, area pricing |
| **Cross-session memory** | Optional **pgvector** on Supabase — embeddings + user memory for personalized context (run SQL migrations when enabled) |
| **Reports** | PDF property reports via backend (WeasyPrint + Jinja2) |
| **Voice UI** | **VoiceOrb** on the homepage + microphone on **Chat** (Web Speech API — best in Chrome) |
| **Home experience** | **Vanta.js** 3D NET background (Three.js), hero, stats, feature links |

---

## Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router), React 19, TanStack Table, Recharts, Framer Motion, Tailwind CSS, Axios |
| **3D / motion** | Vanta (`vanta.net`), Three.js, Framer Motion |
| **Backend** | FastAPI, SQLAlchemy (async), asyncpg, Pydantic |
| **Scraping** | httpx, Playwright (Chromium), multipage extraction |
| **AI** | OpenAI (JSON extraction; ARIA with tools, intent routing, optional embeddings for memory) |
| **Search (ARIA)** | Tavily API when `TAVILY_API_KEY` is set; DuckDuckGo-style fallback when not |
| **Reports** | Jinja2, WeasyPrint (PDF) |
| **Discovery** | Apify (Google Maps / agency discovery) |
| **Database** | Supabase PostgreSQL; optional **pgvector** for memory tables |
| **Jobs / cache** | Optional **Redis** (Upstash-compatible URL); scrape jobs also support **in-memory** fallback |

---

## Repository layout

| Path | Role |
|------|------|
| `backend/` | FastAPI app, models, CRUD, scraper pipeline, ARIA agent & tools, PDF reports, memory helpers |
| `backend/database/schema.sql` | Baseline DDL for new databases |
| `backend/database/migrations/` | Incremental SQL (extended `properties`, **memory / pgvector** tables, etc.) |
| `frontend/` | Next.js UI: home (Vanta), agencies, properties, pricing, chat (voice), **about-aria** |
| `IMPLEMENTATION.md` | Architecture, schema details, API notes |

---

## ARIA — tools & behavior (summary)

ARIA uses OpenAI function calling with tools such as:

- **`search_database`** — Filter/query properties and agencies in PostgreSQL  
- **`scrape_city`** — Enqueue a scrape for a city + country  
- **`web_search`** — Market/news context (Tavily when configured)  
- **`get_pricing_analysis`** — Summarize pricing dataset angles  
- **`compare_properties`** — Side-by-side comparison from stored listings  
- **`get_area_pricing`** — Locality / area pricing signals + context  
- **`get_agency_detail`** — Deep dive on one agency and related listings  

The agent applies **intent detection** (casual chat vs task-focused), can attach **personalized context** from user memory when migrations and embeddings are enabled, and returns structured **message metadata** for rich UI (tables, comparisons, etc.).

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Supabase Postgres connection string |
| `OPENAI_API_KEY` | Yes | Extraction + ARIA |
| `APIFY_API_TOKEN` | Yes (for discovery) | Agency discovery |
| `TAVILY_API_KEY` | No | Enhanced web search for ARIA |
| `redis_url` | No | Shared scrape job state (see `backend/config.py`) |

### Frontend (`frontend/.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | API base (default `http://localhost:8000`) |

---

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Run:

```bash
uvicorn backend.main:app --reload --port 8000
```

Health:

```bash
curl http://localhost:8000/health
```

### 2. Database (Supabase)

1. For a **new** project, apply DDL from **`IMPLEMENTATION.md`** or `backend/database/schema.sql` in the Supabase SQL Editor.  
2. For **existing** databases, run migrations under **`backend/database/migrations/`** (e.g. `add_properties_extended_columns.sql`, `add_memory_tables.sql` if you use vector memory). Scripts use `IF NOT EXISTS` where applicable.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `NEXT_PUBLIC_API_URL` if the API is not on port 8000.

**Production build** (uses webpack for Vanta / `canvas` external):

```bash
npm run build
npm start
```

---

## Trigger a scrape (example)

```bash
curl -X POST http://localhost:8000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"city": "Sliema", "country": "Malta"}'
```

Poll:

```bash
curl http://localhost:8000/api/scrape/<job_id>
```

---

## Dashboard routes

| Route | Description |
|-------|-------------|
| `/` | Hero with **Vanta** 3D background, scrape form, **VoiceOrb**, stats, feature links |
| `/agencies` | Agency directory, cards, contacts |
| `/properties` | Filterable table, CSV export, expanded rows, PDF report links when API available |
| `/pricing` | Summary cards + charts (tooltips tuned for dark theme) |
| `/chat` | ARIA threads, tool runs, **voice-to-text** mic on the input bar |
| `/about-aria` | Product story: capabilities, intelligence, roadmap |

---

## Documentation & secrets

- **Deep dive:** `IMPLEMENTATION.md`  
- **Secrets:** Never commit `backend/.env` or `frontend/.env.local` (see `.gitignore`)

---

## License

Private / project repository — add a `LICENSE` when you publish.
