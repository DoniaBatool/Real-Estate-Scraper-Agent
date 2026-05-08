# Real Estate AI Scraper

Production-oriented pipeline: discover agencies (Apify), scrape websites (Playwright / multipage flow), extract structured listings with OpenAI, persist to PostgreSQL, and browse everything in a Next.js dashboard—including **ARIA**, a tool-calling chat agent for property intelligence.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, TanStack Table, Recharts, Framer Motion |
| Backend | FastAPI, SQLAlchemy (async), asyncpg |
| Scraping | httpx, Playwright, multipage listing/property extraction |
| AI | OpenAI (agency + property JSON extraction; **ARIA** chat with tools) |
| Discovery | Apify (Google Maps / agency discovery) |
| Database | Supabase PostgreSQL |
| Jobs / cache | Optional **Redis** (Upstash-compatible URL); scrape jobs also keep **in-memory** fallback |

## Repository layout

| Path | Role |
|------|------|
| `backend/` | FastAPI app, models, CRUD, scraper pipeline, ARIA tools |
| `backend/database/schema.sql` | Baseline DDL for new databases |
| `backend/database/migrations/` | Incremental SQL (e.g. extended `properties` columns) |
| `frontend/` | Next.js UI: agencies, properties, pricing, **chat** |
| `IMPLEMENTATION.md` | Architecture, schema details, API notes |

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Create `backend/.env` with at least:

- `DATABASE_URL` — Supabase Postgres connection string  
- `OPENAI_API_KEY`  
- `APIFY_API_TOKEN` — agency discovery  
- Optional: `redis_url` (see `backend/config.py`) for shared scrape job state  

Run:

```bash
uvicorn backend.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
# {"status":"ok","version":"1.0"}
```

### 2. Database (Supabase)

1. Run the DDL from **`IMPLEMENTATION.md` § Database Schema** (or `backend/database/schema.sql`) in the **Supabase SQL Editor** for a fresh project.  
2. For existing databases created earlier, run migrations under **`backend/database/migrations/`** (e.g. `add_properties_extended_columns.sql`). Safe to re-run where `IF NOT EXISTS` is used.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Point the client at your API (e.g. `NEXT_PUBLIC_API_URL=http://localhost:8000` in `frontend/.env.local`).

```bash
npm run build   # production check
```

## Trigger a scrape (example)

```bash
curl -X POST http://localhost:8000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"city": "Sliema", "country": "Malta"}'
```

Poll job status:

```bash
curl http://localhost:8000/api/scrape/<job_id>
```

## Dashboard routes

| Route | Description |
|-------|-------------|
| `/agencies` | Agency directory, cards, contacts |
| `/properties` | Filterable property table, CSV export, expanded rows |
| `/pricing` | Charts (locality, type, scatter, trends) |
| `/chat` | **ARIA** assistant (database search, scrape tools, web context when configured) |

## Documentation & env

- **Deep dive:** see **`IMPLEMENTATION.md`** (schema, flows, endpoints).  
- **Secrets:** keep `backend/.env` and `frontend/.env.local` out of git (listed in `.gitignore`).  

## License

Private / project repository — add a `LICENSE` when you publish.
