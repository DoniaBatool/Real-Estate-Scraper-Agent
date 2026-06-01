---
name: stagehand-scraping
description: >
  Expert guide for building AI-powered web scraping and browser automation with Stagehand v3 and Browserbase.
  Use this skill whenever the user mentions Stagehand, Browserbase, browser automation with AI, web scraping,
  headless browser, playwright automation with AI, or building routes/scripts that navigate websites and extract structured data.
  Also trigger for: real estate scrapers, e-commerce scrapers, job board scrapers, any structured data extraction
  from websites. This skill prevents all common v3 mistakes and provides production-quality patterns.
---

# Stagehand v3 + Browserbase — Complete Expert Guide

You have deep expertise in Stagehand v3. Apply every pattern here without being asked. When writing ANY Stagehand code, follow these rules exactly — they come from the official Stagehand v3 documentation.

---

## 1. WHAT IS STAGEHAND

Stagehand is an AI-powered browser automation framework built on top of Playwright. It lets you control browsers with natural language. Version 3 is built and maintained by Browserbase.

**The 4 Core Primitives:**

```
act()      → Single DOM action (click, type, select) — deterministic
extract()  → Pull structured data from the current page — AI-powered
observe()  → Discover actionable elements on the page — AI-powered
agent()    → Autonomous multi-step workflows — MOST POWERFUL
```

**When to use each:**
- `act()` — focused single actions: "click the Submit button", "type text into email field"
- `extract()` — read data off the current page with a Zod schema
- `observe()` — plan actions before doing them; returns ObserveResult[] to act on
- `agent()` — full autonomous workflows, form fills, multi-page navigation, complex tasks

---

## 2. THE 4 CORE METHODS — Full Signatures

### `act(instruction, options?)`

Performs a single action on the page.

```typescript
await stagehand.act("click the 'Sign In' button");

await stagehand.act("type %email% into the email field", {
  variables: { email: "user@example.com" },
  useVision: false,             // default: false — use DOM not screenshots
  domSettleTimeoutMs: 3000,     // ms to wait for DOM to settle after action
  timeout: 30000,               // ms before action times out
  slowType: false,              // type one character at a time (human-like)
  verifyActSuccess: true,       // verify action completed (default: true)
  delayBetweenCharacters: 50,   // ms delay between keystrokes when slowType=true
  serverCache: true,            // Browserbase server-side cache (default: true)
});
```

**ActResult:**
```typescript
const result = await stagehand.act("click login");
console.log(result.success);        // boolean
console.log(result.cacheStatus);    // "HIT" | "MISS" — when using Browserbase
console.log(result.message);        // description of what happened
```

### `extract(instruction, schema, options?)`

Extracts structured data from the current page.

```typescript
import { z } from "zod";

// With Zod schema (recommended)
const data = await stagehand.extract(
  "extract the product title and price",
  z.object({
    title: z.string().describe("The product name"),
    price: z.number().describe("Price as a number, no currency symbol"),
  })
);

// With options
const data = await stagehand.extract(
  "extract all listings",
  ListingsSchema,
  {
    useTextExtract: true,        // use text-only extraction (faster, cheaper)
    domSettleTimeoutMs: 3000,    // wait for DOM stability
    timeout: 30000,              // timeout in ms
    selector: "#results-list",   // scope to a CSS selector (faster + better caching)
    serverCache: false,          // disable Browserbase cache for this call
  }
);
```

### `observe(instruction?, options?)`

Discovers actionable elements. Returns `ObserveResult[]` that can be passed directly to `act()`.

```typescript
// Find elements
const buttons = await stagehand.observe("find the login button");

// Act on the result — no LLM call needed
if (buttons.length > 0) {
  await stagehand.act(buttons[0]);  // ObserveResult passed directly
}

// With options
const elements = await stagehand.observe("find all form fields", {
  useVision: false,           // use DOM (default) or screenshots
  domSettleTimeoutMs: 3000,
  timeout: 30000,
  returnAction: true,         // include the action to take (default: true)
});
```

**Performance tip:** Calling `observe()` then `act(observeResult)` avoids a second LLM call — `act()` on an `ObserveResult` executes deterministically (no AI inference). This is 2-3x faster.

### `agent(config?)` + `agent.execute(options)`

Autonomous multi-step agent.

```typescript
const agent = stagehand.agent({
  model: "google/gemini-2.5-flash",      // model string
  systemPrompt: "You are a helpful assistant that automates web tasks.",
  mode: "dom",                            // "dom" | "hybrid" | "cua"
  // integrations: [...],                 // MCP integrations
});

const result = await agent.execute({
  instruction: "Search for 'laptop' and extract the first 5 results with prices",
  maxSteps: 25,                          // max LLM steps before stopping
  output: ProductListSchema,             // Zod schema for structured output
  variables: { query: "laptop" },        // %variableName% substitution
  // excludeTools: ["OBSERVE"],          // exclude specific tools
  // signal: abortController.signal,     // AbortSignal for cancellation
});

// result.success: boolean
// result.output: Record<string, unknown>  ← must cast to your type
// result.actions: array of actions taken
// result.completed: boolean
```

**CRITICAL: Cast the output**
```typescript
const agentOutput = result.output as z.infer<typeof ProductListSchema> | undefined;
if (agentOutput?.products?.length) {
  // use agentOutput.products
}
```

---

## 3. CORRECT v3 APIS — CRITICAL MISTAKES TO AVOID

These bugs will crash your code silently or loudly. Memorize them.

```typescript
// ✅ CORRECT — v3 page access
const page = stagehand.context.pages()[0];

// ❌ WRONG — "activePage is not a function" crash
const page = stagehand.context.activePage();
```

```typescript
// ✅ CORRECT — timeout parameter name for page.goto
await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });

// ❌ WRONG — silently ignored in v3 Playwright wrapper
await page.goto(url, { timeout: 30000 });
```

```typescript
// ✅ CORRECT — waiting between actions
await page.waitForTimeout(2000);

// ❌ WRONG — not a reliable general pattern (valid only before cache-sensitive ops)
await page.waitForLoadState("networkidle");
```

```typescript
// ✅ CORRECT — agent mode
const agent = stagehand.agent({ mode: "cua", model: "google/gemini-2.5-flash" });

// ❌ DEPRECATED — will be removed in future version
const agent = stagehand.agent({ cua: true });
```

---

## 4. AGENT MODES

| Mode | Description | When to Use |
|------|-------------|-------------|
| `"dom"` | Default. Reads the DOM/accessibility tree. Fast and cheap. | Most tasks — forms, clicks, navigation |
| `"hybrid"` | Combines DOM and vision (screenshots). More capable. | Dynamically rendered content, canvas elements |
| `"cua"` | Computer Use Agent. Uses screenshots + XY coordinates. | Heavily JS-rendered apps, drag-and-drop, visually complex pages |

**CUA browser dimensions are required** (default 1288x711 if not specified):
```typescript
// LOCAL
const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: { viewport: { width: 1288, height: 711 } },
});

// BROWSERBASE
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  browserbaseSessionCreateParams: {
    browserSettings: { viewport: { width: 1288, height: 711 } },
  },
});
```

**CUA supported models:**
```typescript
const agent = stagehand.agent({ mode: "cua", model: "google/gemini-2.5-computer-use-preview-10-2025" });
const agent = stagehand.agent({ mode: "cua", model: "anthropic/claude-sonnet-4-6" });
const agent = stagehand.agent({ mode: "cua", model: "openai/computer-use-preview" });
```

---

## 5. ZOD SCHEMA PATTERNS

`.describe()` on every field dramatically improves AI extraction accuracy. Never omit it.

```typescript
import { z } from "zod";

const PropertySchema = z.object({
  properties: z.array(
    z.object({
      title: z.string().nullable().optional().default("")
        .describe("Property title or headline as shown on the listing card"),
      price: z.number().nullable().optional()
        .describe("Numeric price only — no currency symbols. E.g. 450000 or 1200"),
      currency: z.string().nullable().optional().default("")
        .describe("Currency code: EUR, USD, GBP, AED, etc."),
      bedrooms: z.number().nullable().optional()
        .describe("Number of bedrooms as an integer"),
      is_available: z.boolean()
        .describe("Whether the property is available for sale or rent right now"),
      listing_url: z.string().url().nullable().optional()
        .describe("DIRECT link to the property page — must start with https://. Do NOT invent URLs."),
      images: z.array(z.string().url()).nullable().optional().default([])
        .describe("Full https:// URLs of property photos only. No logos, icons, or placeholders."),
      amenities: z.array(z.string()).nullable().optional().default([])
        .describe("Features: pool, garage, garden, lift, AC, parking, balcony, sea view, etc."),
    })
  ).default([]).describe("ALL listings visible on page. Do not skip any."),
  agency_name: z.string().nullable().optional().default(""),
});
```

**Key rules:**
- Use `z.string().url()` for URL fields — tells Stagehand to extract full valid URLs
- Use `.nullable().optional().default("")` so missing fields don't break parsing
- Numbers: `z.number().nullable().optional()` — avoid `.default(0)` (hides missing data)
- Arrays: `z.array(z.string()).nullable().optional().default([])` prevents parse errors on empty

**Single value extraction:**
```typescript
const contactUrl = await stagehand.extract("extract the contact page URL", z.string().url());
```

---

## 6. TYPESCRIPT CAST FOR AGENT OUTPUT

`agentResult.output` is typed as `Record<string, unknown>` — always cast:

```typescript
const agentResult = await agent.execute({
  instruction: "...",
  output: MySchema,
  maxSteps: 20,
});

// Must cast — TypeScript won't infer the Zod shape
const output = agentResult.output as z.infer<typeof MySchema> | undefined;
if (output?.items && output.items.length > 0) {
  return output.items;
}
```

---

## 7. ENVIRONMENT SETUP (Quick Reference)

### LOCAL mode (development — free, uses your Mac)

```typescript
const stagehand = new Stagehand({
  env: "LOCAL",
  model: { modelName: "openai/gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY || "" },
  verbose: 0,
});
await stagehand.init();
const page = stagehand.context.pages()[0];  // ✅ Always use this
```

**Required once per machine:**
```bash
npm install playwright-core
npx playwright install chromium
```

### BROWSERBASE mode (production — cloud browsers)

```typescript
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY!,
  projectId: process.env.BROWSERBASE_PROJECT_ID!,
  model: "google/gemini-2.5-flash",
  disablePino: true,
});
```

### Next.js App Router (REQUIRED headers)

```typescript
// app/api/scrape/route.ts
export const runtime = "nodejs";   // REQUIRED — Edge runtime blocks Playwright
export const maxDuration = 120;    // Vercel Pro: up to 800s; Hobby: 60s
```

---

## 8. ERROR MESSAGES CHEAT SHEET

| Error | Cause | Fix |
|-------|-------|-----|
| `activePage is not a function` | Wrong v3 API | Use `stagehand.context.pages()[0]` |
| `402 Free plan browser minutes limit reached` | Browserbase plan exhausted | Switch to `env: "LOCAL"` or upgrade plan |
| `Browser closed unexpectedly` | Timeout too short / heavy page | Increase `maxDuration`, add `waitForTimeout` |
| `Cannot find module 'playwright-core'` | Playwright not installed | `npm install playwright-core && npx playwright install chromium` |
| TypeScript error on `agentResult.output.field` | `output` is `Record<string,unknown>` | Cast: `agentResult.output as z.infer<typeof Schema>` |
| Empty results from `extract()` | AI didn't navigate to right page | Use `agent()` with `output:` schema instead |
| `z.string().url()` parse failure | Relative URLs like `/path/123` | Apply baseUrl prefix fix (see advanced-patterns.md) |
| Cache not being used | Instruction/URL mismatch across runs | Enable `verbose: 2` to see cache debug logs |
| `timeout` param silently ignored | Wrong param name for `page.goto` | Use `timeoutMs` not `timeout` |
| Agent loops or doesn't stop | No clear stop condition in prompt | Add explicit success criteria to instruction |
| CUA returns wrong XY coordinates | Viewport not configured | Set explicit viewport: 1288x711 |
| `cua: true is deprecated` | Old API usage | Use `mode: "cua"` instead |
| MCP tools not used by agent | Vague system prompt | Explicitly name tools and when to use them |

---

## 9. QUICK REFERENCE TABLE

| Task | Code |
|------|------|
| Get page | `stagehand.context.pages()[0]` |
| Navigate | `page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 })` |
| Wait | `page.waitForTimeout(2000)` |
| Single action | `stagehand.act("click the Submit button")` |
| Action with variable | `stagehand.act("type %email% into field", { variables: { email } })` |
| Extract structured | `stagehand.extract("instruction", ZodSchema)` |
| Extract scoped | `stagehand.extract("...", Schema, { selector: "#container" })` |
| Find elements | `const [el] = await stagehand.observe("find the login button")` |
| Observe + act (fast) | `const [el] = await stagehand.observe("..."); await stagehand.act(el)` |
| Create agent | `const agent = stagehand.agent({ model: "google/gemini-2.5-flash" })` |
| Run agent | `await agent.execute({ instruction: "...", maxSteps: 20 })` |
| Agent with output | `await agent.execute({ instruction: "...", output: ZodSchema, maxSteps: 20 })` |
| Cast output | `result.output as z.infer<typeof Schema> \| undefined` |
| CUA mode | `stagehand.agent({ mode: "cua", model: "openai/computer-use-preview" })` |
| Local dev | `env: "LOCAL"` |
| Cloud production | `env: "BROWSERBASE"` |
| Enable local cache | `new Stagehand({ cacheDir: "cache/workflow" })` |
| Disable server cache | `{ serverCache: false }` in options |
| Check cache | `result.cacheStatus // "HIT" \| "MISS"` |
| Self-heal | `new Stagehand({ selfHeal: true })` |
| Multiple tabs | `stagehand.context.pages()` returns array |
| New tab | `await stagehand.context.newPage()` |
| Connect Playwright | `chromium.connectOverCDP({ wsEndpoint: stagehand.connectURL() })` |
| Connect Puppeteer | `puppeteer.connect({ browserWSEndpoint: stagehand.connectURL() })` |

---

## REFERENCE FILES

For deeper patterns, see:

- **`references/best-practices.md`** — Caching (server + local), cost optimization, deterministic vs AI, speed tips, self-healing, variables, multiple tabs, agent fallback chains, prompting best practices, MCP integration
- **`references/advanced-patterns.md`** — Multi-page pagination, login flows, two-step detail extraction, CUA deep dive, anti-bot patterns, Python v3 SDK, Playwright/Puppeteer/Selenium CDP integration, serverless deployment, error reference
