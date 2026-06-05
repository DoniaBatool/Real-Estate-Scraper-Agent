---
name: gcp-stagehand-deployment
description: >
  Complete guide for deploying Next.js + Stagehand v3 + Playwright on Google Cloud Platform.
  Covers RAM requirements, Chrome flags, CHROME_PATH setup, PM2 env vars, all real errors
  encountered (ECONNREFUSED, OOM build crash, no-zygote, single-process) and their fixes.
  Use this skill whenever deploying or troubleshooting Stagehand/Playwright on any Linux VM
  or cloud environment (GCP, AWS, DigitalOcean, Railway, etc).
version: 1.0.0
tags: [stagehand, playwright, gcp, deployment, chrome, vm, nextjs, pm2]
---

# GCP Stagehand Deployment Skill

## What This Skill Is

Complete intelligence for deploying a **Next.js + Stagehand v3 + Playwright** app on Google Cloud Platform. Covers every issue encountered during real deployment of the ARIA Real Estate Scraper Agent, including root causes, fixes, and what to watch out for next time.

---

## Project Context

- **App:** ARIA Real Estate Scraper Agent
- **Stack:** Next.js 14 (frontend + Stagehand API routes) + FastAPI backend (Python)
- **Stagehand version:** v3.4.0
- **Playwright:** playwright-core v1.60.0 (NOT full playwright — no bundled browser)
- **Deployment target:** GCP VM (Ubuntu)
- **Process manager:** PM2

---

## ⚠️ Critical: RAM Requirements

**This is the #1 issue. Do not deploy without sufficient RAM.**

| Task | Min RAM needed |
|---|---|
| `npm run build` (Next.js TypeScript) | ~1.5GB |
| Next.js running (`next start`) | ~300MB |
| FastAPI backend | ~150MB |
| Chrome (Stagehand LOCAL mode) per request | ~400–600MB |
| **Total for one concurrent scrape** | **~2.5–3GB** |

### VM Recommendations

| VM type | RAM | Verdict |
|---|---|---|
| e2-micro | 1GB | ❌ Too small — build OOM crash, Chrome crash |
| e2-small | 2GB | ⚠️ Marginal — build may OOM, scrapes unreliable |
| **e2-medium** | **4GB** | **✅ Minimum viable — recommended** |
| e2-standard-2 | 8GB | ✅ Comfortable — handles concurrent scrapes |

**e2-micro is NOT free-forever for this project.** The GCP "always free" e2-micro has 1GB RAM which is insufficient for Playwright/Stagehand.

---

## Issues Encountered & Fixes

### Issue 1: `connect ECONNREFUSED 127.0.0.1:<port>`

**Symptom:** Stagehand throws `scrape-url error: connect ECONNREFUSED 127.0.0.1:XXXXX`

**What it means:** Chrome process starts (gets a port), but crashes before Playwright can connect. The port is occupied for a split second then dies.

**Root cause A: `CHROME_PATH` not set**
- `playwright-core` does NOT bundle a browser
- If `executablePath` is `undefined`, Playwright can't find Chrome
- Result: Chrome never actually launches properly

**Fix A:**
```bash
# Find your Playwright Chromium path
find ~/.cache/ms-playwright -name "chrome" -type f 2>/dev/null

# Set in .env.local
CHROME_PATH=/home/username/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome

# Also set in PM2 explicitly
CHROME_PATH=/home/username/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
  pm2 restart aria-frontend --update-env

# Verify it's in PM2's env
pm2 env <process_id> | grep CHROME
```

**Root cause B: Low RAM → Chrome crash**
- VM doesn't have enough free memory when Chrome tries to launch
- Chrome starts, gets a port, then OOM-killed by kernel
- Result: same ECONNREFUSED

**Fix B:** Upgrade VM to e2-medium (4GB) or add swap:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

### Issue 2: `npm run build` → JavaScript heap out of memory

**Symptom:**
```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
Next.js build worker exited with code: null and signal: SIGABRT
```

**Root cause:** Node.js default heap limit (~512MB) is too small for Next.js TypeScript compilation on large projects.

**Fix:**
```bash
NODE_OPTIONS="--max-old-space-size=2048" npm run build
# If VM has only 2GB RAM:
NODE_OPTIONS="--max-old-space-size=1024" npm run build
```

**Make it permanent in package.json:**
```json
"scripts": {
  "build": "NODE_OPTIONS='--max-old-space-size=2048' next build --webpack"
}
```

---

### Issue 3: PM2 env vars not passed to Next.js process

**Symptom:** `CHROME_PATH` is set in shell but Next.js `process.env.CHROME_PATH` is undefined at runtime.

**Root cause:** PM2 stores its own env snapshot. Shell env vars don't automatically flow into PM2-managed processes.

**Fix:**
```bash
# Always use --update-env when changing env vars
CHROME_PATH=/path/to/chrome pm2 restart aria-frontend --update-env

# Verify
pm2 env <process_id> | grep CHROME
```

**Also add to `.env.local`** so it survives PM2 restarts from the ecosystem file.

---

### Issue 4: `EADDRINUSE: address already in use :::3000`

**Symptom:** PM2 restarts aria-frontend rapidly, logs show port 3000 already in use.

**Root cause:** Previous process didn't fully die before new one started. Common when PM2 auto-restarts on crash.

**Fix:**
```bash
# Kill whatever is on port 3000
fuser -k 3000/tcp
# Then restart cleanly
pm2 restart aria-frontend
```

---

### Issue 5: `Failed to find Server Action "x"`

**Symptom:** Browser makes requests that return "Failed to find Server Action" errors.

**Root cause:** Browser tab has stale JS from an older build. The new build has different server action hashes.

**Fix:** Hard refresh browser (`Ctrl+Shift+R`) or clear browser cache. This is NOT a server issue.

---

## Required Chrome Flags for GCP VM

These flags are required in `localBrowserLaunchOptions.args`:

```typescript
args: [
  "--headless=new",          // Use new headless mode (more stable than old)
  "--no-sandbox",            // Required on Linux VMs (no user namespace)
  "--disable-dev-shm-usage", // /dev/shm is tiny on GCP VMs (64MB default)
  "--disable-gpu",           // No GPU on VM
  "--no-zygote",             // Avoids zygote process issues on restricted kernels
  "--single-process",        // KEY: reduces memory, avoids multi-process crashes on VMs
  "--disable-setuid-sandbox",
]
```

**`--single-process` is the most important flag for VM stability.** It makes Chrome run in a single OS process instead of spawning child processes, which:
- Reduces total memory footprint
- Avoids sandbox/namespace permission issues
- Prevents the "Chrome starts then crashes" pattern

---

## Complete `localBrowserLaunchOptions` Config

```typescript
localBrowserLaunchOptions: {
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1366,768",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
}
```

---

## How to Verify Chrome Works on VM (Before Deploying)

**Test 1: Chrome binary directly**
```bash
/path/to/chrome --headless=new --no-sandbox --disable-dev-shm-usage \
  --disable-gpu --no-zygote --remote-debugging-port=9222 2>&1 | head -5
# Should show: DevTools listening on ws://127.0.0.1:9222/...
```

**Test 2: playwright-core launch (exact Stagehand path)**
```bash
cd ~/your-project/frontend
node -e "
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--headless=new','--no-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--no-zygote','--single-process'],
  });
  const page = await browser.newPage();
  await page.goto('https://example.com');
  console.log('Title:', await page.title());
  await browser.close();
  console.log('SUCCESS!');
})().catch(e => console.error('ERROR:', e.message));
"
```

If Test 2 passes, Stagehand will work.

---

## Full GCP Deployment Checklist

### VM Setup
- [ ] VM type: e2-medium (4GB) minimum — NOT e2-micro
- [ ] OS: Ubuntu 22.04 LTS
- [ ] Firewall rules: allow HTTP (80), HTTPS (443), custom port if needed
- [ ] Swap: add 2–4GB swap if RAM < 8GB

### Software Install
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
npm install -g pm2

# Python 3.11
sudo apt-get install -y python3.11 python3.11-venv

# Playwright Chromium + system deps
cd frontend
npx playwright install chromium --with-deps

# Verify Chrome path
find ~/.cache/ms-playwright -name "chrome" -type f
```

### Environment Variables
**`frontend/.env.local`**
```env
STAGEHAND_ENV=LOCAL
CHROME_PATH=/home/USERNAME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_API_URL=http://localhost:8000
BACKEND_PROXY_URL=http://localhost:8000
```

### Build & Start
```bash
# Build with extra heap
cd frontend
NODE_OPTIONS="--max-old-space-size=2048" npm run build

# Start with PM2 + env
CHROME_PATH=/home/USERNAME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome \
  pm2 start "npm start" --name aria-frontend --update-env

pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name aria-backend

# Save PM2 config to survive reboots
pm2 save
pm2 startup
```

### Verify
```bash
# Check all processes are online
pm2 list

# Check CHROME_PATH is in PM2 env
pm2 env <frontend_process_id> | grep CHROME

# Check memory usage
free -h
pm2 monit

# Test scrape
curl -X POST http://localhost:3000/api/stagehand/scrape-url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","city":"test"}' | head -c 200
```

---

## Security Notes

- **Never expose `.env.local` or `.env`** — contains API keys
- **VM is publicly scanned** — the backend logs show constant probing for `/api/.env`, `/api/config.json` etc. This is normal internet noise. All return 404 correctly.
- **Firewall:** Only open ports you actually need (80/443 for web, 22 for SSH)
- **Use HTTPS** — set up Nginx + Certbot for SSL in production

---

## Nginx Reverse Proxy Config (for production)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;  # Stagehand scrapes take up to 2 min
    }
}
```

---

## Cost Estimate (GCP)

| VM | RAM | Monthly cost (us-central1) |
|---|---|---|
| e2-micro | 1GB | Free (but won't work) |
| e2-small | 2GB | ~$13/mo |
| **e2-medium** | **4GB** | **~$27/mo** |
| e2-standard-2 | 8GB | ~$49/mo |

Add: ~$0.10/GB/month for persistent disk (10GB = $1/mo)

---

## The `--no-zygote` Journey (What Was Tried)

This was the longest debugging path. Here's the full chronology so you don't repeat it.

### What is the zygote process?
Chrome uses a "zygote" process on Linux — a pre-forked process that spawns renderer/GPU child processes quickly. On cloud VMs with restricted namespaces (like GCP), the zygote can fail to fork, causing Chrome to crash at startup.

### What was tried

**Attempt 1: `--no-zygote` alone**
```
args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"]
```
Result: Still `ECONNREFUSED`. Chrome started, got a port, crashed.

**Attempt 2: `--no-zygote` + verify Chrome works independently**
Ran chrome-launcher test directly:
```bash
node -e "
const { launch } = require('./node_modules/chrome-launcher');
(async () => {
  const chrome = await launch({
    chromePath: '/home/user/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    chromeFlags: ['--headless=new','--remote-allow-origins=*','--no-sandbox',
                  '--disable-dev-shm-usage','--disable-gpu','--no-zygote'],
    startingUrl: 'about:blank',
  });
  console.log('CDP:', json.webSocketDebuggerUrl ? 'YES' : 'NO');
  console.log('SUCCESS!');
})();
"
```
Result: `CDP: YES — SUCCESS!` ✅ Chrome binary works fine.

**Key insight from this test:** Chrome binary itself was never the problem. The issue was that `CHROME_PATH` was not being passed to the PM2/Next.js process, so `playwright-core` didn't know where Chrome was.

**Attempt 3: `--no-zygote` + `CHROME_PATH` in PM2**
Set `CHROME_PATH` via PM2. Error port changed (new error, not cached). Still ECONNREFUSED.

**Root cause confirmed:** Even with correct `CHROME_PATH`, Chrome was crashing because of **insufficient RAM** — not the zygote at all. The VM (e2-micro, 1GB) didn't have enough free memory when Next.js + backend were both running.

**Final fix: `--single-process` + sufficient RAM**
`--single-process` tells Chrome to run everything in one OS process instead of forking children. This:
- Bypasses the zygote entirely
- Reduces memory footprint by ~40%
- Works reliably on RAM-constrained VMs

### Lesson
> `--no-zygote` alone is NOT enough on low-RAM VMs. The zygote is one failure mode; OOM is another. You need BOTH `--no-zygote` AND `--single-process`, plus enough RAM. If you still get `ECONNREFUSED` after adding both flags, the problem is RAM — upgrade the VM.

### Flags in order of importance for VM stability
1. `--single-process` ← most important, add this first
2. `--no-sandbox` ← required, without this Chrome refuses to run as root
3. `--disable-dev-shm-usage` ← required, /dev/shm is 64MB on GCP by default
4. `--no-zygote` ← good to have, prevents one class of crash
5. `--disable-gpu` ← always add on headless VMs
6. `--headless=new` ← use new headless (old `--headless` is deprecated)

---

## Zod Schema Gotchas with Stagehand/LLM Extraction

These bugs cause silent failures where valid data is extracted but the schema rejects it.

### Bug 1: Field named `properties` causes nested object instead of array

**Symptom:**
```json
{"properties": {"properties": [], "agency_name": "..."}}
```
The LLM returns an object instead of an array for the `properties` field.

**Root cause:** `properties` is a reserved keyword in JSON Schema. When the Zod schema field is also named `properties`, the LLM gets confused and nests the entire schema under that key.

**Fix:** Rename the field from `properties` to `listings` or `property_list`:
```typescript
// ❌ WRONG - clashes with JSON Schema keyword
const PropertySchema = z.object({
  properties: z.array(PropertyItem).default([])
    .describe("ALL property listings..."),
});

// ✅ CORRECT
const PropertySchema = z.object({
  listings: z.array(PropertyItem).default([])
    .describe("ALL property listing cards. Return as a flat array."),
});
```

### Bug 2: `images: [null]` - null inside array fails validation

**Symptom:** `"Invalid input: expected string, received null"` on `images[0]`

**Root cause:** LLM returns `[null]` when no images found. `z.array(z.string())` rejects null items.

**Fix:** Accept nullable items, filter in post-processing:
```typescript
// ❌ WRONG
images: z.array(z.string()).nullable().optional().default([])

// ✅ CORRECT
images: z.array(z.union([z.string(), z.null()])).nullable().optional().default([])

// Then in post-processing:
const cleanImages = (p.images || []).filter((u): u is string => 
  typeof u === "string" && isRealUrl(u)
);
```

### Bug 3: `listing_url: "https://"` partial URL passes startsWith check

**Symptom:** Properties with `listing_url: "https://"` show "No link" but don't error.

**Root cause:** `"https://".startsWith("http")` is true, so it passes the old check. `new URL("https://")` throws, but only if the try/catch reaches it.

**Fix:** Add explicit guard before URL parsing:
```typescript
const isFakeUrl = (u: string): boolean => {
  if (!u) return true;
  if (/^https?:\/\/?$/.test(u.trim())) return true;  // catches "https://" and "http://"
  try {
    const parsed = new URL(u);
    if (!parsed.hostname || !parsed.hostname.includes(".")) return true;
    // ... rest of checks
  } catch { return true; }
};
```

### Bug 4: Concurrent SQLAlchemy session (memory update)

**Symptom:** `InvalidRequestError: This session is provisioning a new connection; concurrent operations are not permitted`

**Root cause:** `asyncio.ensure_future(update_user_memory(db, ...))` passes the SAME session to a background task while the main request is still using it.

**Fix:** Create a fresh session inside the background task:
```python
async def _run_memory_update():
    _, factory = _get_engine()
    async with factory() as fresh_db:
        await update_user_memory(fresh_db, ...)

asyncio.ensure_future(_run_memory_update())
```

---

## Summary: What Went Wrong & What Fixed It

1. **Chrome not found** → Set `CHROME_PATH` in `.env.local` AND PM2 env via `--update-env`
2. **Chrome crash (ECONNREFUSED)** → Add `--single-process` flag + ensure sufficient RAM
3. **Build OOM** → Use `NODE_OPTIONS="--max-old-space-size=2048"` 
4. **Port conflict** → `fuser -k 3000/tcp` before restart
5. **Root cause of everything** → e2-micro (1GB RAM) is too small; use e2-medium (4GB) minimum
