# Real Estate AI Scraper

Production-grade pipeline that scrapes real estate agencies in any city, extracts structured data via OpenAI, and displays it in a three-view Next.js dashboard.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, Tailwind CSS, TanStack Table, Recharts |
| Backend | FastAPI, SQLAlchemy, asyncpg |
| Scraping | httpx, Playwright + stealth, proxy rotation |
| AI | OpenAI GPT-4o-mini |
| Discovery | Apify Google Maps Actor |
| Database | Supabase PostgreSQL |
| Cache/Queue | Upstash Redis |
| Deploy | Railway (backend) + Vercel (frontend) |

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Fill in your API keys
cp .env .env  # edit the file with real values

uvicorn backend.main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok","version":"1.0"}`

### 2. Supabase

Run the SQL from `IMPLEMENTATION.md` Section 5 in your Supabase SQL Editor.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Dashboard Views

| Route | View |
|-------|------|
| `/agencies` | Agency cards with contacts, socials, ratings |
| `/properties` | Sortable, filterable property table with CSV export |
| `/pricing` | 4 Recharts: price/m² by locality, type ranges, scatter, line |

## Implementation Phases

- **Phase 1** ✅ — Project setup, folder structure, DB models, FastAPI foundation, Next.js scaffold
- **Phase 2** — Apify discovery, scraper engine (3 levels), OpenAI extraction, CRUD
- **Phase 3** — Full dashboard with real data, filters, charts
- **Phase 4** — Hardening, tests, Railway + Vercel deploy

## Environment Variables

See `backend/.env` and `frontend/.env.local` for the full list.
Never commit these files — they are in `.gitignore`.
