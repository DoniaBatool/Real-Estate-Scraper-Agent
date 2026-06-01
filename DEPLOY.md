# ARIA — Deployment Guide (Render — Frontend + Backend)

> **Architecture (sabse simple + sasta):**
> - **Frontend** (Next.js + Stagehand) → **Render** — Playwright LOCAL mode, no Browserbase needed
> - **Backend** (FastAPI + ARIA agent) → **Render**
> - **Database** (chat history) → **Supabase**
> - **Browser automation** → Chromium on Render's Linux server (FREE)
>
> **Total cost: ~$14/mo** (2 × Render Starter @ $7/mo)
> **Browserbase: Not needed** — Render runs real Playwright browser

---

## Accounts needed

| Service | URL | Free? |
|---------|-----|-------|
| GitHub | github.com | ✅ Free |
| Render | render.com | Starter $7/mo per service |
| Supabase | supabase.com | ✅ Free tier |
| OpenAI | platform.openai.com | Pay per use (~$0.01/scrape) |
| Tavily | tavily.com | ✅ Free tier (1000 searches/mo) |

---

## Step 1 — Push code to GitHub

```bash
cd /path/to/AI_Sraper_RealEstate

git init
git add .
git commit -m "feat: production ready"

# GitHub pe naya repo banao, phir:
git remote add origin https://github.com/YOUR_USERNAME/aria-real-estate.git
git push -u origin main
```

> ⚠️ Make sure `.env` and `.env.local` are in `.gitignore` — API keys kabhi push mat karo!

---

## Step 2 — Deploy Backend on Render

### 2a. New Web Service banao

1. [render.com](https://render.com) → **New** → **Web Service**
2. GitHub repo connect karo
3. Settings:
   - **Name:** `aria-backend`
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Starter ($7/mo)

> 💡 Render automatically `render.yaml` detect karega — **"Use render.yaml"** button press karo toh sab auto-fill ho jaega.

### 2b. Environment variables set karo (Render Dashboard → Environment)

```
OPENAI_API_KEY       = sk-proj-...
OPENAI_MODEL         = gpt-4o-mini
DATABASE_URL         = postgresql://...     ← Supabase se milega
SUPABASE_URL         = https://xxx.supabase.co
SUPABASE_KEY         = eyJ...
TAVILY_API_KEY       = tvly-...
APIFY_API_KEY        = apify_api_...
FRONTEND_URL         = (baad mein fill karo — Step 3 ke baad)
USE_ARIA_AGENT       = true
ARIA_MAX_TOOL_ROUNDS = 10
```

### 2c. Deploy karo — Backend URL note karo

Deploy hone ke baad URL milega:
```
https://aria-backend.onrender.com
```

### 2d. Test karo

```bash
curl https://aria-backend.onrender.com/health
# Response: {"status":"ok","version":"2.0.0",...}
```

---

## Step 3 — Deploy Frontend on Render

### 3a. New Web Service banao

1. Render → **New** → **Web Service**
2. Same GitHub repo connect karo
3. Settings:
   - **Name:** `aria-frontend`
   - **Root Directory:** `frontend`
   - **Runtime:** Node
   - **Build Command:**
     ```
     npm install && npx playwright install chromium --with-deps && npm run build
     ```
     > Yeh Chromium (~170MB) install karta hai — pehli build 3-4 min legi, baad mein cache se fast hogi
   - **Start Command:** `npm run start`
   - **Plan:** Starter ($7/mo)

### 3b. Environment variables set karo

```
STAGEHAND_ENV        = LOCAL
OPENAI_API_KEY       = sk-proj-...
NEXT_PUBLIC_API_URL  = https://aria-backend.onrender.com
BACKEND_PROXY_URL    = https://aria-backend.onrender.com
```

> `STAGEHAND_ENV=LOCAL` matlab Playwright Render ke Linux server pe chalega — **Browserbase bilkul free nahi chahiye!**

### 3c. Deploy karo — Frontend URL note karo

```
https://aria-frontend.onrender.com
```

---

## Step 4 — Backend mein Frontend URL update karo

1. Render → `aria-backend` service → **Environment**
2. `FRONTEND_URL` update karo:
   ```
   FRONTEND_URL = https://aria-frontend.onrender.com
   ```
3. **Manual Deploy → Deploy Latest Commit** — restart karo

---

## Step 5 — End-to-end test karo

1. `https://aria-frontend.onrender.com` browser mein kholo
2. Type karo: `find me 2 bedroom apartments in Dubai`
3. ARIA clarifying questions puchega ✅
4. Jawab do → ARIA scrape karega aur properties dikhayega ✅
5. **"More Details"** button click karo ✅

---

## Troubleshooting

### Cold start (free plan pe pehli request slow hoti hai)
- Starter plan ($7/mo) pe yeh problem nahi hoti — service always-on rehti hai
- Free plan: 15 min idle hone pe service so jaati hai, pehli request ~30s leti hai

### Chromium install fail on build
Build logs mein check karo. Agar error aaye:
```bash
# Build command change karo:
npm install && npx playwright install --with-deps chromium && npm run build
```

### "Cannot connect to backend" error frontend pe
- `NEXT_PUBLIC_API_URL` aur `BACKEND_PROXY_URL` dono set hain? Check karo
- Backend ka `/health` endpoint kaam kar raha hai? Check karo

### Scraping timeout (bahut rare Render pe)
- Render Starter mein request timeout 30 minutes hai — scraping ke liye kaafi hai
- Agar bhi issue ho: Render Dashboard → Service → Settings → Request Timeout badhao

### CORS error
- Backend ka `FRONTEND_URL` exactly match karta hai frontend URL se? (no trailing slash)
- Backend redeploy karo after updating env var

---

## Final Cost Summary

| Service | Plan | Cost |
|---------|------|------|
| Render (Frontend) | Starter | $7/mo |
| Render (Backend) | Starter | $7/mo |
| Supabase | Free | $0 |
| OpenAI | Pay per use | ~$5–20/mo (usage dependent) |
| Tavily Search | Free (1000/mo) | $0 |
| Browserbase | **Not needed** | $0 |
| **Total** | | **~$14–34/mo** |

---

## Environment Variables Quick Reference

### aria-frontend (Render)
| Variable | Value |
|----------|-------|
| `STAGEHAND_ENV` | `LOCAL` |
| `OPENAI_API_KEY` | `sk-proj-...` |
| `NEXT_PUBLIC_API_URL` | `https://aria-backend.onrender.com` |
| `BACKEND_PROXY_URL` | `https://aria-backend.onrender.com` |

### aria-backend (Render)
| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `DATABASE_URL` | `postgresql://...` |
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | `eyJ...` |
| `FRONTEND_URL` | `https://aria-frontend.onrender.com` |
| `TAVILY_API_KEY` | `tvly-...` |
| `APIFY_API_KEY` | `apify_api_...` |
