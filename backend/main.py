from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import scraper, agencies, properties, pricing, chat
from backend.database.connection import init_db

app = FastAPI(
    title="Real Estate AI Scraper API",
    version="1.0.0",
    description="Scrapes real estate agencies in any city and extracts structured data via OpenAI.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scraper.router)
app.include_router(agencies.router)
app.include_router(properties.router)
app.include_router(pricing.router)
app.include_router(chat.router)


@app.on_event("startup")
async def on_startup():
    await init_db()


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0"}
