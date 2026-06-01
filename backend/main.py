"""
ARIA Real Estate Agent — FastAPI backend.
Chat history is persisted in Supabase.
Property data is fetched live via Stagehand + Browserbase.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import chat, reports
from backend.database.connection import init_db

app = FastAPI(
    title="ARIA — Real Estate Agent API",
    version="2.0.0",
    description=(
        "ARIA browses real estate agency websites in real-time using Stagehand + Browserbase. "
        "No stale data — every search fetches live listings."
    ),
)

# ── Allowed origins ────────────────────────────────────────────────────────
# Hardcoded dev origins + FRONTEND_URL from environment (set on Render).
_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
]
_frontend_url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
if _frontend_url:
    _ORIGINS.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    # Catches all Vercel preview + production URLs (*.vercel.app + custom domains)
    allow_origin_regex=r"https://(.*\.vercel\.app|.*\.onrender\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(reports.router)


@app.on_event("startup")
async def on_startup():
    try:
        await init_db()
    except Exception as e:
        print(f"⚠️  DB startup warning (non-fatal): {e}")
        print("   Chat history may not persist, but ARIA scraping will still work.")


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "2.0.0",
        "agent": "ARIA",
        "scraping": "Stagehand + Browserbase (real-time)",
        "storage": "Supabase (chat history only)",
    }
