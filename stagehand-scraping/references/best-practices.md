# Stagehand v3 — Best Practices Reference

---

## CACHING

### Browserbase Server Cache (automatic when `env: "BROWSERBASE"`)

Every `act()` call is automatically cached on Browserbase servers. Same inputs = instant response, zero tokens.

```typescript
// Disable for entire instance
const stagehand = new Stagehand({ env: "BROWSERBASE", serverCache: false });

// Disable for a single call
await stagehand.act("click login", { serverCache: false });

// Check cache status
const result = await stagehand.act("click the login button");
console.log(result.cacheStatus); // "HIT" or "MISS"
```

**Cache key** = instruction + page content + options. URL is also factored in.

**Best practices for consistent cache hits:**
1. `await page.waitForLoadState("networkidle")` before acting — ensures full DOM is captured
2. Use `selector` option to scope to a stable container
3. Use `variables` for dynamic values — cache key uses variable *keys* not values
4. Fix viewport: `await page.setViewportSize({ width: 1280, height: 720 })`
5. Keep prompt wording identical across runs — synonyms = cache miss
6. Block noisy third-party requests: `await page.route("**/*.{png,jpg,gif}", r => r.abort())`

### Local Cache (filesystem, works in LOCAL and BROWSERBASE)

```typescript
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  cacheDir: "cache/login-workflow",  // saves to filesystem
});

// First run: LLM inference + writes to cache (~20-30s, ~50k tokens)
// Subsequent runs: reads from cache (~2-3s, 0 tokens) — 10-100x faster!
```

Cache key for `agent()` = instruction + start URL + agent config + execution options.

**Organizing caches:**
```typescript
cacheDir: "cache/login-flow"         // Good: descriptive, separate per workflow
cacheDir: "cache/checkout-flow"
cacheDir: "cache/extraction-v2"
cacheDir: "cache"                    // Bad: too generic, collisions between workflows
```

**Clear cache when site changes:**
```typescript
import { rmSync } from 'fs';
rmSync('cache/login-flow', { recursive: true, force: true });

// Or version-based:
const CACHE_VERSION = 'v3';
const cacheDir = `cache/workflow-${CACHE_VERSION}`;
```

**Commit cache to version control for CI/CD:**
```gitignore
# .gitignore — allow cache directories
!cache/
!cache/**/*.json
```

---

## COST OPTIMIZATION

1. **Use the right model** — Gemini Flash for most tasks; GPT-4o or Claude only for complex reasoning.
2. **Enable local cache** — `cacheDir` eliminates LLM calls on repeat runs.
3. **Use `useTextExtract: true`** — For text-only pages, skip DOM/vision overhead.
4. **Scope with `selector`** — Reduces token cost by limiting accessibility tree snapshot.
5. **`observe()` then `act(result)`** — One LLM call plans; subsequent `act(ObserveResult)` calls are free.
6. **Limit `maxSteps`** — Simple tasks: 5-10. Complex: 20-50. Never use 100+ unless needed.
7. **Session reuse** — `keepAlive: true` in `browserbaseSessionCreateParams`.

```typescript
// Cost-optimized extraction
const data = await stagehand.extract("extract prices", PriceSchema, {
  useTextExtract: true,
  selector: "#product-grid",   // only process this container
  serverCache: true,
});
```

**Monitor token usage:**
```typescript
const metrics = await stagehand.metrics;
console.log(`Tokens: ${metrics.totalPromptTokens + metrics.totalCompletionTokens}`);
console.log(`Inference time: ${metrics.totalInferenceTimeMs}ms`);
```

---

## DETERMINISTIC vs AI — When to Use Code

Not everything needs AI. Use native Playwright/code when the structure is known:

| Task | Use Code | Use AI |
|------|----------|--------|
| Navigate to URL | `page.goto(url)` | Never |
| Click known selector | `page.click('#submit-btn')` | Only if selector unknown |
| Extract from stable structure | `page.$$eval('.price', ...)` | When structure varies |
| Wait for element | `page.waitForSelector('.results')` | Never |
| Pagination with `?page=N` | Loop with URL param | Only for complex "next" button patterns |
| Login with known form IDs | Native Playwright | Use variables + `act()` |
| Form with unknown labels | — | `agent()` with variables |

The hybrid approach — Playwright for navigation + Stagehand for extraction:
```typescript
// Code for navigation (fast, free)
await page.goto("https://shop.com/search?q=laptop");
await page.waitForSelector(".product-grid");

// AI for extraction (handles any structure)
const products = await stagehand.extract("extract all product cards", ProductsSchema);
```

---

## SPEED OPTIMIZATION

1. **Observe-then-act** — One LLM call plans all actions; subsequent `act(ObserveResult)` calls are free:
```typescript
// Slow: 3 LLM calls
await stagehand.act("fill name field");
await stagehand.act("fill email field");
await stagehand.act("click submit");

// Fast: 1 LLM call plans everything
const fields = await stagehand.observe("find all form fields to fill");
for (const field of fields) {
  await stagehand.act(field);  // no LLM, executes directly
}
```

2. **Reduce DOM complexity before processing:**
```typescript
await page.evaluate(() => {
  document.querySelectorAll('video, iframe, [style*="animation"]').forEach(el => el.remove());
});
```

3. **Shorter timeouts for simple ops:**
```typescript
await stagehand.act("click login button", { timeout: 5000 }); // default 30000ms
```

4. **`domContentLoaded` instead of full load:**
```typescript
await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
```

5. **Parallel extraction across tabs:**
```typescript
const [data1, data2] = await Promise.all([
  stagehand.extract("extract stars", StarsSchema, { page: page1 }),
  stagehand.extract("extract stars", StarsSchema, { page: page2 }),
]);
```

6. **Use local cache** — Subsequent runs are 10-100x faster with `cacheDir`.

---

## SELF-HEALING

Stagehand adapts automatically when DOM selectors change (requires `cacheDir`):

```typescript
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  selfHeal: true,        // retries with AI when cached selector fails
  cacheDir: "cache/workflow",
});
```

How self-healing works:
- When a cached action fails (element not found, stale selector), Stagehand re-runs AI inference
- The new result is cached for future runs
- Combine with `cacheDir` for best results: fast on cache hits, resilient on misses

---

## VARIABLES IN ACT AND AGENT

Variables protect sensitive data from logs and enable cache reuse across different values:

```typescript
// act() variables — use %variableName% syntax in the instruction string
await stagehand.act("type %email% into the email field", {
  variables: { email: "user@example.com" },
});

await stagehand.act("type %password% into the password field", {
  variables: { password: process.env.USER_PASSWORD },
});

// agent.execute() variables
await agent.execute({
  instruction: "Search for %query% and filter by %maxPrice% max price",
  variables: {
    query: "3-bedroom apartment",
    maxPrice: "500000",
  },
  maxSteps: 15,
});
```

**Cache behavior with variables:** The cache key uses variable *keys* not values. So `{ email: "alice@example.com" }` and `{ email: "bob@example.com" }` share the same cache entry — prime once, hit forever.

**Set `verbose: 0` to keep secrets out of logs.**

---

## MULTIPLE TABS

Stagehand automatically tracks the active tab. For manual multi-tab control:

```typescript
// Create a second tab
await stagehand.context.newPage();
const pages = stagehand.context.pages();
const page1 = pages[0];
const page2 = pages[1];

// Navigate each tab independently
await page1.goto("https://github.com/browserbase/stagehand");
await page2.goto("https://github.com/browserbase/stagehand-python");

// Extract from both simultaneously — pass { page } to specify which tab
const [stars1, stars2] = await Promise.all([
  stagehand.extract("extract the star count", z.object({ stars: z.number() }), { page: page1 }),
  stagehand.extract("extract the star count", z.object({ stars: z.number() }), { page: page2 }),
]);
```

**Note:** `stagehand.agent()` always operates on the active (most recently focused) tab. For cross-tab agent work, manage page switching manually.

---

## AGENT FALLBACK CHAINS

Use `act()` first for speed; fall back to `agent()` if layout changed:

```typescript
try {
  await stagehand.act("click the 'Sign In' button");
} catch (err) {
  const agent = stagehand.agent({ model: "anthropic/claude-sonnet-4-6" });
  const result = await agent.execute({
    instruction: "Find and click the Sign In button. It may be inside a menu or dropdown.",
    maxSteps: 10,
  });
  if (!result.success) throw err;
}
```

**Full fallback chain (most to least deterministic):**
```typescript
let results: Item[] = [];

try {
  // 1. Fastest: observe + scoped extract (1 LLM call)
  const [action] = await stagehand.observe("find the search results container");
  if (action) {
    const data = await stagehand.extract("extract all results", ResultsSchema, {
      selector: action.selector,
    });
    results = data.items;
  }
} catch {
  try {
    // 2. Slower: agent with output schema
    const agentResult = await agent.execute({
      instruction: "Find and extract all results",
      output: ResultsSchema,
      maxSteps: 20,
    });
    const out = agentResult.output as z.infer<typeof ResultsSchema> | undefined;
    results = out?.items || [];
  } catch {
    // 3. Last resort: plain extract on current page
    try {
      const extracted = await stagehand.extract("extract all items", ResultsSchema);
      results = extracted.items || [];
    } catch { /* return empty — don't throw, let caller handle */ }
  }
}
```

---

## PROMPTING BEST PRACTICES

### act() prompts — single, specific actions

```typescript
// Good: single action, element type, visible label
await stagehand.act("click the 'Add to Cart' button");
await stagehand.act("type 'user@example.com' into the email input field");
await stagehand.act("select 'United States' from the country dropdown");

// Bad: multiple actions, vague descriptions, color-based
await stagehand.act("fill out the form and submit it");
await stagehand.act("click the blue button");
await stagehand.act("login then go to dashboard");
```

**Action verbs by element type:**
- **click** → buttons, links, checkboxes, radio buttons
- **type** → text inputs, textareas
- **select** → dropdown/select elements
- **check/uncheck** → checkboxes
- **upload** → file inputs
- **scroll** → scrollable containers

### extract() prompts — describe exactly what to return

```typescript
// Good: specific, matches schema fields
const data = await stagehand.extract(
  "Extract all visible property listings. For each: title, price in numbers only (no currency), " +
  "bedroom count, and the full URL of the listing detail page.",
  PropertySchema
);

// Bad: too vague, no field guidance
const data = await stagehand.extract("get the stuff on this page", PropertySchema);
```

### agent() prompts — detailed, navigate-first, with success criteria

```typescript
// Good: specific task, clear success criteria, navigate first outside agent
await page.goto("https://amazon.com");  // navigate BEFORE agent.execute
await agent.execute({
  instruction:
    "Search for 'wireless headphones under $100'. On the results page, find the product " +
    "with the highest star rating that costs under $100. Add it to the cart. " +
    "Confirm the cart shows exactly 1 item.",
  maxSteps: 20,
});

// Bad: vague, no stop condition
await agent.execute({ instruction: "Go to amazon and get some headphones", maxSteps: 50 });
```

**System prompt template:**
```typescript
const agent = stagehand.agent({
  model: "google/gemini-2.5-flash",
  systemPrompt:
    "You are a [specific role] agent. " +
    "Your ONLY job is to [specific task]. " +
    "Do NOT navigate to external websites. " +
    "Do NOT click on individual item pages unless instructed. " +
    "Do NOT submit forms other than search/filter. " +
    "Stop once you have completed the task.",
});
```

**Step limits by task complexity:**
```typescript
// Simple (click a button, fill one form): maxSteps: 5-10
// Medium (search + extract, login flow): maxSteps: 10-20
// Complex (multi-page research, comparison): maxSteps: 25-50
```

---

## MCP INTEGRATION

MCP (Model Context Protocol) lets agents use external tools beyond browser automation.

```typescript
import { connectToMCPServer } from "@browserbasehq/stagehand";

// Option A: pass URL directly (simplest — for hosted MCP servers)
const agent = stagehand.agent({
  model: "openai/computer-use-preview",
  integrations: [
    `https://mcp.exa.ai/mcp?exaApiKey=${process.env.EXA_API_KEY}`,
  ],
  systemPrompt: "You have access to web search via Exa. Always search for current info before browsing.",
});

// Option B: connect first, then pass client
const supabaseClient = await connectToMCPServer(
  `https://server.smithery.ai/@supabase-community/supabase-mcp/mcp?api_key=${process.env.SMITHERY_API_KEY}`
);

const notionClient = await connectToMCPServer({
  command: "npx",
  args: ["-y", "@notionhq/notion-mcp-server"],
  env: { NOTION_TOKEN: process.env.NOTION_TOKEN },
});

const agent = stagehand.agent({
  model: "openai/computer-use-preview",
  integrations: [supabaseClient, notionClient],
  systemPrompt: "Use database and Notion tools to store all extracted data.",
});

await agent.execute("Extract restaurant listings and save them to the Supabase database");
```

**Authenticated MCP servers:**
```typescript
const client = await connectToMCPServer({
  serverUrl: "https://mcp-server.example.com/mcp",
  requestOptions: {
    requestInit: {
      headers: { Authorization: `Bearer ${process.env.MCP_SERVER_API_KEY}` },
    },
  },
});
```

**Browserbase MCP Server** (use Stagehand from any MCP client including Claude Desktop):
```json
{
  "mcpServers": {
    "browserbase": {
      "url": "https://mcp.browserbase.com/mcp?browserbaseApiKey=YOUR_API_KEY"
    }
  }
}
```

Add to Claude Code:
```bash
claude mcp add --transport http browserbase "https://mcp.browserbase.com/mcp?browserbaseApiKey=YOUR_KEY"
```

**MCP integrations are TypeScript-only** — not available in the Python v3 SDK.
