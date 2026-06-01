# Advanced Stagehand Patterns

---

## Multi-Page Pagination

```typescript
let allResults = [];
let pageNum = 1;
const maxPages = 5;

while (pageNum <= maxPages) {
  const agent = stagehand.agent({ model: "openai/gpt-4o-mini", systemPrompt: "..." });
  const result = await agent.execute({
    instruction: `Extract all listings from page ${pageNum}. ` +
      `After extracting, check if there's a "Next Page" button. If yes, click it and stop.`,
    maxSteps: 10,
    output: ListingsSchema,
  });

  const out = result.output as z.infer<typeof ListingsSchema> | undefined;
  if (out?.items?.length) allResults.push(...out.items);

  const hasMore = out?.has_next_page ?? false;
  if (!hasMore) break;
  pageNum++;
  await page.waitForTimeout(1500);
}
```

**URL-based pagination (no AI needed):**
```typescript
const allItems = [];
for (let page = 1; page <= 10; page++) {
  await stagehand.context.pages()[0].goto(`https://site.com/listings?page=${page}`, {
    waitUntil: "domcontentloaded",
    timeoutMs: 20000,
  });
  await stagehand.context.pages()[0].waitForTimeout(1000);
  const data = await stagehand.extract("extract all listings", ListingsSchema);
  if (!data.items?.length) break;
  allItems.push(...data.items);
}
```

---

## Login Flow Before Scraping

```typescript
// 1. Navigate to login page
await page.goto("https://site.com/login", { waitUntil: "domcontentloaded", timeoutMs: 30000 });

// 2. Use agent with variables for safe credential handling
const loginAgent = stagehand.agent({ model: "openai/gpt-4o-mini" });
await loginAgent.execute({
  instruction: "Fill in the login form with %email% and %password%, then click Submit.",
  variables: {
    email: process.env.SCRAPER_EMAIL || "",
    password: process.env.SCRAPER_PASSWORD || "",
  },
  maxSteps: 5,
});

await page.waitForTimeout(2000);

// 3. Now scrape authenticated content
const data = await stagehand.extract("Extract all premium listings...", Schema);
```

---

## Property Detail Extraction (Two-Step Pattern)

Best pattern when you need full detail from individual pages:

```typescript
// Step 1: agent() finds and navigates to the specific property page
const navAgent = stagehand.agent({
  model: "openai/gpt-4o-mini",
  systemPrompt: "Find a specific property and navigate to its detail page. Stop once there.",
});

await navAgent.execute({
  instruction: `Find the property: "${title}" (price: €${price}) and click into its full detail page.`,
  maxSteps: 15,
});

await page.waitForTimeout(2000);
const detailUrl = page.url(); // Capture the individual property URL

// Step 2: extract() pulls ALL detail from the now-loaded detail page
const details = await stagehand.extract(
  `Extract COMPLETE property details: description, all room dimensions,
   all features (AC/lift/pool/balconies/parking), individual agent name/phone/whatsapp/email,
   agency name/phone/email, price, address, images.`,
  PropertyDetailSchema
);
```

---

## CUA Mode Deep Dive (Screenshot-Based)

When DOM-based extraction fails on heavily JavaScript-rendered sites:

```typescript
// LOCAL mode with CUA
const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: {
    viewport: { width: 1288, height: 711 },  // REQUIRED for CUA
  },
});

const agent = stagehand.agent({
  model: "anthropic/claude-sonnet-4-6",   // or "google/gemini-2.5-computer-use-preview-10-2025"
  mode: "cua",                             // Computer Use Agent — uses screenshots
});

const result = await agent.execute({
  instruction: "...",
  maxSteps: 20,
});
```

**CUA model performance ranking (best first):**
1. `google/gemini-2.5-computer-use-preview-10-2025` — fastest + cheapest
2. `anthropic/claude-sonnet-4-6` — most accurate
3. `openai/computer-use-preview` — good for Windows/Excel tasks

**Note:** CUA is 3-5x slower and 5-10x more expensive than DOM mode. Always try DOM mode first.

---

## Anti-Bot Sites

```typescript
// BROWSERBASE has anti-bot infrastructure built in
stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  browserbaseSessionCreateParams: {
    browserSettings: {
      blockAds: true,
    },
  },
  // Browserbase handles: stealth mode, residential proxies, CAPTCHA solving
  model: { modelName: "openai/gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY || "" },
});
```

For LOCAL mode on anti-bot sites, add human-like delays:
```typescript
// Random delay (2-5 seconds, mimics human browsing)
await page.waitForTimeout(2000 + Math.random() * 3000);

// Block fingerprinting scripts
await page.route("**/*{fingerprint,analytics,tracking}*", route => route.abort());
```

---

## Serverless / Edge Deployment (Complete Config)

Always add to Next.js App Router routes:
```typescript
export const runtime = "nodejs";  // REQUIRED — never "edge"
export const maxDuration = 120;   // Vercel Pro: up to 800s; Hobby: 60s max
```

**`vercel.json` for custom durations:**
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/scrape.ts": { "maxDuration": 60 },
    "app/api/stagehand/search/route.ts": { "maxDuration": 120 }
  }
}
```

For long scrapes that exceed limits, split into sequential API calls:
1. `/api/stagehand/list` — quick page scrape (under 10s)
2. `/api/stagehand/detail` — single-URL detail scrape (under 60s)
3. Frontend calls them sequentially

**Full serverless route template:**
```typescript
export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { Stagehand } from "@browserbasehq/stagehand";

export async function POST(req: NextRequest) {
  let stagehand: InstanceType<typeof Stagehand> | null = null;
  try {
    const body = await req.json();

    stagehand = new Stagehand({
      env: "LOCAL",  // or "BROWSERBASE" in production
      model: { modelName: "openai/gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY || "" },
      verbose: 0,
    });

    await stagehand.init();
    const page = stagehand.context.pages()[0];
    if (!page) throw new Error("No active page");

    await page.goto(body.url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(2000);

    // ... extraction logic ...

    await stagehand.close();
    stagehand = null;
    return NextResponse.json({ success: true, data });

  } catch (err: unknown) {
    try { if (stagehand) await stagehand.close(); } catch { /* ignore */ }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Scraping failed", detail: message }, { status: 500 });
  }
}
```

---

## Python v3 SDK

The Python SDK supports all 4 core primitives with the same patterns:

```python
import asyncio
from stagehand import Stagehand, StagehandConfig
from pydantic import BaseModel, Field

class PropertyItem(BaseModel):
    title: str = Field(description="Property title")
    price: float | None = Field(None, description="Numeric price only")
    listing_url: str | None = Field(None, description="Direct property URL")

class PropertyList(BaseModel):
    properties: list[PropertyItem] = Field(description="All visible listings")

async def scrape_properties():
    config = StagehandConfig(
        env="LOCAL",
        model_name="openai/gpt-4o-mini",
        model_api_key="sk-...",
        verbose=0,
    )

    async with Stagehand(config) as stagehand:
        page = stagehand.page  # Python SDK: stagehand.page (not context.pages()[0])

        await page.goto("https://example-realestate.com/listings")
        await page.wait_for_timeout(2000)

        # extract() with Pydantic model
        result = await stagehand.extract(
            instruction="Extract all property listings",
            schema=PropertyList,
        )
        return result.properties

asyncio.run(scrape_properties())
```

**Python-specific notes:**
- Use `stagehand.page` (not `stagehand.context.pages()[0]`) — Python API differs here
- Use Pydantic `BaseModel` + `Field` instead of Zod schemas
- Use `wait_for_timeout` (snake_case) instead of `waitForTimeout`
- MCP integrations are **not available** in the Python SDK
- `agent()` mode is `"dom"` or `"cua"` only — `"hybrid"` is TypeScript-only

**Python agent with structured output:**
```python
from stagehand import StagehandAgent

agent = stagehand.agent(
    model="openai/gpt-4o-mini",
    system_prompt="Extract real estate listings. Do not navigate externally.",
)

result = await agent.execute(
    instruction="Extract all listings on this page",
    max_steps=15,
    output=PropertyList,  # Pydantic model
)

# Python SDK: result.output is already typed (no manual cast needed!)
for prop in result.output.properties:
    print(prop.title, prop.price)
```

---

## Playwright / Puppeteer / Selenium CDP Integration

Connect existing Playwright or Puppeteer code to a Browserbase browser:

```typescript
import { chromium } from "playwright-core";
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({ env: "BROWSERBASE", apiKey: "...", projectId: "..." });
await stagehand.init();

// Get the WebSocket endpoint
const wsEndpoint = stagehand.connectURL();

// Connect Playwright
const browser = await chromium.connectOverCDP({ wsEndpoint });
const page = browser.contexts()[0].pages()[0];

// Now use regular Playwright AND Stagehand on the same browser
await page.goto("https://example.com");
await stagehand.act("click the login button");  // AI action
const data = await page.locator(".product").all();  // Regular Playwright selector
```

**Connect Puppeteer:**
```typescript
import puppeteer from "puppeteer-core";

const browser = await puppeteer.connect({
  browserWSEndpoint: stagehand.connectURL(),
});
const page = (await browser.pages())[0];
await page.goto("https://example.com");
```

**Connect Selenium (via CDP):**
```python
# Python — connect Selenium via Chrome DevTools Protocol
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options = Options()
options.debugger_address = "localhost:9222"  # point to Browserbase CDP endpoint
driver = webdriver.Chrome(options=options)
driver.get("https://example.com")
```

---

## Fixing Relative URLs (Common Pattern)

When `listing_url` comes back as `/path/to/123` instead of `https://site.com/path/to/123`:

```typescript
const baseUrl = (() => {
  try {
    const u = new URL(targetUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return targetUrl;
  }
})();

const properties = extractedProperties.map((p) => {
  let listingUrl = p.listing_url || "";
  if (listingUrl && listingUrl.startsWith("/")) listingUrl = baseUrl + listingUrl;
  if (listingUrl && !listingUrl.startsWith("http")) listingUrl = "";
  return { ...p, listing_url: listingUrl };
});
```

---

## Error Messages Cheat Sheet

| Error | Cause | Fix |
|-------|-------|-----|
| `activePage is not a function` | Wrong v3 API | Use `stagehand.context.pages()[0]` |
| `402 Free plan browser minutes limit reached` | Browserbase plan exhausted | Switch to `env: "LOCAL"` or upgrade |
| `Browser closed unexpectedly` | Timeout too short | Increase `maxDuration`, add `waitForTimeout` |
| `Cannot find module 'playwright-core'` | Playwright not installed | `npm install playwright-core && npx playwright install chromium` |
| TypeScript error on `agentResult.output.field` | Wrong type | Cast: `agentResult.output as z.infer<typeof Schema>` |
| Empty results from `extract()` | Wrong page, no navigation | Use `agent()` with `output:` schema instead |
| `z.string().url()` parse error | Relative URLs in results | Apply baseUrl prefix fix (see above) |
| `timeout` param silently ignored | Wrong param name | Use `timeoutMs` not `timeout` in `page.goto` |
| Agent loops or doesn't stop | No stop condition | Add explicit success criteria to instruction |
| CUA returns wrong XY coordinates | Viewport not configured | Set viewport to 1288x711 |
| `cua: true is deprecated` | Old API | Use `mode: "cua"` |
| Page is blank/JS-rendered | DOM mode can't see content | Switch to `mode: "hybrid"` or `mode: "cua"` |
| Session idle timeout | Long pauses between actions | Add `keepAlive: true` in Browserbase params |
