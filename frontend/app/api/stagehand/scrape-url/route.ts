export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/stagehand/scrape-url
 *
 * Uses Stagehand agent() — the most powerful primitive — to autonomously:
 *   1. Navigate to the agency website
 *   2. Find and apply search filters (category, bedrooms, bathrooms, price)
 *   3. Extract every visible property listing with full detail
 *   4. Return structured data via Zod output schema
 *
 * Body: { url, city?, country?, property_type?, category?, bedrooms?,
 *         bathrooms?, min_price?, max_price? }
 */

import { NextRequest, NextResponse } from "next/server";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

// ── Zod schema for a single property ────────────────────────────────────────
const PropertyItem = z.object({
  title: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Property title or headline as shown on the listing card"),

  property_type: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Type: apartment, villa, house, studio, penthouse, townhouse, bungalow, land, commercial"),

  category: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Either 'sale' or 'rent'"),

  price: z
    .number()
    .nullable()
    .optional()
    .describe("Numeric price only — no currency symbols. E.g. 450000 or 1200"),

  currency: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Currency code: EUR, USD, GBP, AED, etc."),

  bedrooms: z
    .number()
    .nullable()
    .optional()
    .describe("Number of bedrooms as an integer"),

  bathrooms: z
    .number()
    .nullable()
    .optional()
    .describe("Number of bathrooms as an integer"),

  total_sqm: z
    .number()
    .nullable()
    .optional()
    .describe("Total floor area in square metres as a number"),

  internal_area_sqm: z
    .number()
    .nullable()
    .optional()
    .describe("Internal/indoor floor area in square metres (excluding terraces, gardens)"),

  external_area_sqm: z
    .number()
    .nullable()
    .optional()
    .describe("External area in square metres — terrace, garden, pool area, balcony combined"),

  locality: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Neighbourhood, locality, or suburb name"),

  city: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("City name"),

  full_address: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Full street address if shown"),

  description: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Property description or summary text, up to 400 characters"),

  listing_url: z
    .string()
    .nullable()
    .optional()
    .describe(
      "DIRECT link to the individual property page — must start with https://. " +
        "Do NOT invent URLs. If no direct link is visible, leave this empty or null."
    ),

  images: z
    .array(z.union([z.string(), z.null()]))
    .nullable()
    .optional()
    .default([])
    .describe("Full https:// URLs of property photos. Only real image URLs — no logos, icons, placeholders."),

  amenities: z
    .array(z.string())
    .nullable()
    .optional()
    .default([])
    .describe("Features list: pool, garage, garden, lift, AC, parking, balcony, sea view, terrace, etc."),

  furnished: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Furnished status: 'yes', 'no', or 'partial'"),

  floor_number: z
    .number()
    .nullable()
    .optional()
    .describe("Which floor the apartment is on (number)"),

  year_built: z
    .number()
    .nullable()
    .optional()
    .describe("Year the property was built (4-digit number)"),

  agent_name: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Name of the individual listing agent if shown"),

  agent_phone: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Agent or agency phone number"),

  agent_email: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Agent or agency email address"),
});

const PropertySchema = z.object({
  listings: z
    .array(PropertyItem)
    .default([])
    .describe("ALL property listing cards visible on the page. Return as a flat array. Do not skip any."),

  agency_name: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("Name of the real estate agency"),

  agency_phone: z.string().nullable().optional().default(""),
  agency_email: z.string().nullable().optional().default(""),
  agency_whatsapp: z.string().nullable().optional().default(""),
});

// ── Build human-readable filter instruction ──────────────────────────────────
function buildFilterInstruction(opts: {
  category: string;
  property_type: string;
  bedrooms?: number;
  bathrooms?: number;
  min_price?: number;
  max_price?: number;
  locality: string;
  city: string;
  country: string;
  amenities?: string[];
  furnished?: string;
  min_internal_sqm?: number;
  min_external_sqm?: number;
  floor_number?: number;
}): string {
  const parts: string[] = [];

  if (opts.category && opts.category !== "any") {
    parts.push(`for ${opts.category === "rent" ? "RENT" : "SALE"}`);
  }
  if (opts.property_type && opts.property_type !== "any") {
    parts.push(`property type: ${opts.property_type}`);
  }
  if (opts.bedrooms) parts.push(`${opts.bedrooms} bedroom(s)`);
  if (opts.bathrooms) parts.push(`${opts.bathrooms} bathroom(s)`);
  if (opts.min_price && opts.max_price) {
    parts.push(`price between ${opts.min_price} and ${opts.max_price}`);
  } else if (opts.max_price) {
    parts.push(`price under ${opts.max_price}`);
  } else if (opts.min_price) {
    parts.push(`price above ${opts.min_price}`);
  }
  // Locality is more specific than city — prefer it for the location filter
  const locationStr = opts.locality || opts.city;
  if (locationStr) parts.push(`in ${locationStr}${opts.country ? ", " + opts.country : ""}`);
  if (opts.amenities && opts.amenities.length > 0) parts.push(`must have: ${opts.amenities.join(", ")}`);
  if (opts.furnished) parts.push(`furnished: ${opts.furnished}`);
  if (opts.min_internal_sqm) parts.push(`internal area ≥ ${opts.min_internal_sqm}m²`);
  if (opts.min_external_sqm) parts.push(`external area ≥ ${opts.min_external_sqm}m²`);
  if (opts.floor_number !== undefined) parts.push(`floor ${opts.floor_number}`);

  return parts.length > 0 ? parts.join(", ") : "any properties (no specific filters)";
}

export async function POST(req: NextRequest) {
  let stagehand: InstanceType<typeof Stagehand> | null = null;

  try {
    const body = await req.json();
    const {
      url,
      city = "",
      country = "",
      locality = "",
      property_type = "any",
      category = "any",
      bedrooms,
      bathrooms,
      min_price,
      max_price,
      amenities,
      furnished,
      min_internal_sqm,
      min_external_sqm,
      floor_number,
    } = body;

    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY || "";

    // ── Detect environment: LOCAL (dev) vs BROWSERBASE (production) ──────
    // Set STAGEHAND_ENV=BROWSERBASE in Vercel env vars for production.
    // In local dev, leave it unset — LOCAL mode uses a real Playwright browser.
    const IS_BROWSERBASE = process.env.STAGEHAND_ENV === "BROWSERBASE";

    // ── Stealth user-agents (LOCAL mode only — rotated per request) ───────
    const USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    ];
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    // ── Init Stagehand ───────────────────────────────────────────────────
    stagehand = new Stagehand(
      IS_BROWSERBASE
        ? {
            // ── PRODUCTION: Browserbase cloud browser ─────────────────────
            env: "BROWSERBASE",
            apiKey: process.env.BROWSERBASE_API_KEY || "",
            projectId: process.env.BROWSERBASE_PROJECT_ID || "",
            model: { modelName: "openai/gpt-4o-mini", apiKey: openaiKey },
            verbose: 0,
            selfHeal: true,
          }
        : {
            // ── LOCAL DEV: Playwright browser on this machine ─────────────
            env: "LOCAL",
            model: { modelName: "openai/gpt-4o-mini", apiKey: openaiKey },
            verbose: 0,
            selfHeal: true,
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
                "--disable-infobars",
                "--window-size=1366,768",
                `--user-agent=${randomUA}`,
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            },
          }
    );

    await stagehand.init();

    // Stealth JS injection (LOCAL only — Browserbase handles this server-side)
    if (!IS_BROWSERBASE) {
      await stagehand.context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      });
    }

    // Use the v3-correct API: context.pages()[0]
    let page = stagehand.context.pages()[0];
    if (!page) throw new Error("No active page after Stagehand init");

    // ── HELPER: Ensure we have a live, focused page after agent runs ──────
    // After agent.execute(), the agent may open new tabs or the "active page"
    // Stagehand tracks internally becomes stale. This helper restores focus.
    async function ensureActivePage(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pages = stagehand!.context.pages();
      if (pages.length === 0) {
        // All tabs closed (site blocked the automation) — open a fresh one
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        page = await stagehand!.context.newPage();
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 25000 });
          await page.waitForTimeout(1500);
        } catch { /* proceed anyway */ }
      } else {
        // Bring the last active page to front so Stagehand's internal
        // awaitActivePage() finds it correctly
        page = pages[pages.length - 1];
        try { await (page as any).bringToFront(); } catch { /* ignore */ }
        await page.waitForTimeout(300);
      }
    }

    // ── Navigate — fast failure on unreachable sites ─────────────────────
    // Strategy: one attempt with domcontentloaded (12s).
    // On ANY network-level error → immediately return skipped (don't retry).
    // On a plain timeout (page loaded but slow) → try once more with "load" (10s).
    // This keeps the total nav time under 25s instead of the old 35s+.

    const isNetworkError = (e: unknown): boolean => {
      const msg = e instanceof Error ? e.message : String(e);
      return (
        msg.includes("ERR_CONNECTION_TIMED_OUT") ||
        msg.includes("ERR_CONNECTION_REFUSED") ||
        msg.includes("ERR_NAME_NOT_RESOLVED") ||
        msg.includes("ERR_INTERNET_DISCONNECTED") ||
        msg.includes("ERR_NETWORK_CHANGED") ||
        msg.includes("ERR_ADDRESS_UNREACHABLE") ||
        msg.includes("net::ERR")
      );
    };

    let navFailed = false;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 12000 });
    } catch (navErr) {
      if (isNetworkError(navErr)) {
        // Hard network failure — site is genuinely unreachable, don't waste more time
        console.warn(`Site unreachable (network error), skipping: ${url}`, navErr);
        try { await stagehand.close(); } catch { /* ignore */ }
        return NextResponse.json({
          success: false,
          url,
          skipped: true,
          reason: "site_unreachable",
          properties_found: 0,
          properties: [],
          agency: { name: "", phone: "", email: "", whatsapp: "", website: url },
        });
      }
      // Soft timeout (page started loading but slow) — one more attempt
      console.warn("Navigation soft timeout, retrying with load:", navErr);
      try {
        await page.goto(url, { waitUntil: "load", timeoutMs: 10000 });
      } catch (navErr2) {
        if (isNetworkError(navErr2)) {
          console.warn(`Site unreachable on retry, skipping: ${url}`);
          try { await stagehand.close(); } catch { /* ignore */ }
          return NextResponse.json({
            success: false,
            url,
            skipped: true,
            reason: "site_unreachable",
            properties_found: 0,
            properties: [],
            agency: { name: "", phone: "", email: "", whatsapp: "", website: url },
          });
        }
        // Page partially loaded — continue and try to extract whatever is there
        navFailed = true;
      }
    }
    if (!navFailed) await page.waitForTimeout(1500);

    // ── Build filter string ──────────────────────────────────────────────
    const filterStr = buildFilterInstruction({
      category,
      property_type,
      bedrooms,
      bathrooms,
      min_price,
      max_price,
      locality,
      city,
      country,
      amenities,
      furnished,
      min_internal_sqm,
      min_external_sqm,
      floor_number,
    });

    // ── Determine if we are on a homepage ────────────────────────────────
    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return "/";
      }
    })();
    const isHomepage = pathname === "/" || pathname === "" || pathname === "/index.html";

    // ── Capture DOM images early (backup for missing images) ─────────────
    let domImages: string[] = [];
    try {
      domImages = (await page.evaluate(() => {
        return Array.from(document.querySelectorAll("img[src], img[data-src], img[data-lazy]"))
          .map((img) => {
            const el = img as HTMLImageElement;
            return el.src || el.dataset?.src || el.dataset?.lazy || "";
          })
          .filter(
            (src) =>
              src.startsWith("http") &&
              !src.includes("logo") &&
              !src.includes("icon") &&
              !src.includes(".svg") &&
              !src.includes("placeholder") &&
              !src.includes("blank") &&
              !src.includes("spinner") &&
              !src.includes("avatar") &&
              !src.includes("flag") &&
              src.length < 500
          );
      })) as string[];
      domImages = [...new Set(domImages)].slice(0, 40);
    } catch { /* ignore */ }

    // ── TWO-STEP APPROACH ─────────────────────────────────────────────────
    // Step 1 (navigation agent): If on homepage, navigate to the property
    //   listings/search page and apply filters. STOP once on the listings page.
    // Step 2 (extraction): extract() ALL visible listings from the listings page.
    //
    // Splitting into two steps prevents the agent from wasting steps on DOM
    // parsing while navigating, and prevents it from clicking into individual
    // property detail pages.

    let extractedProperties: z.infer<typeof PropertyItem>[] = [];
    let agencyName = "";
    let agencyPhone = "";
    let agencyEmail = "";
    let agencyWhatsapp = "";

    // Hoisted so both the initial extraction and pagination loop can use it
    const extractInstruction =
      `Extract ALL property listing cards visible on this page. ` +
      `For each property card get EVERY available detail:\n` +
      `- title (property name/headline)\n` +
      `- property_type (apartment/villa/house/studio/penthouse/townhouse/bungalow)\n` +
      `- category (sale or rent)\n` +
      `- price (number only, no currency symbols — e.g. 450000 or 1200)\n` +
      `- currency (EUR/USD/GBP/AED/PKR etc.)\n` +
      `- bedrooms (integer)\n` +
      `- bathrooms (integer)\n` +
      `- total_sqm (total floor area in m² — use if only one area figure is shown)\n` +
      `- internal_area_sqm (indoor/internal area in m², excluding terraces and gardens)\n` +
      `- external_area_sqm (outdoor area in m² — terrace, garden, balcony, pool deck combined)\n` +
      `- locality (neighbourhood/suburb)\n` +
      `- city\n` +
      `- full_address\n` +
      `- description (up to 400 chars)\n` +
      `- listing_url (DIRECT https:// link to the individual property page — must be a real URL, ` +
      `  do NOT invent URLs. Look for "href" attributes on the listing card or "View more" links)\n` +
      `- images (real https:// photo URLs from the listing cards, NOT logo/icon/placeholder URLs)\n` +
      `- amenities (extract ALL features/amenities visible: pool, parking, garage, garden, lift, ` +
      `  balcony, sea view, AC, gym, terrace, storage, communal pool, private pool, etc.)\n` +
      `- furnished ('yes' if furnished/fully furnished, 'no' if unfurnished, 'partial' if semi-furnished)\n` +
      `- floor_number (which floor the unit is on, as a number)\n` +
      `- year_built\n` +
      `- agent_name, agent_phone, agent_email (if shown on the card)\n` +
      `Also extract: agency_name, agency_phone, agency_email.\n` +
      `IMPORTANT: Extract FROM THE LISTING CARDS on this page. Do NOT navigate anywhere.`;

    try {
      // ── STEP 1: Navigate to listings page (only if needed) ──────────────
      if (isHomepage) {
        const navAgent = stagehand.agent({
          model: "openai/gpt-4o-mini",
          systemPrompt:
            "You are a browser navigation agent for a real estate website. " +
            "Your ONLY job is to navigate to the property listings page and apply search filters. " +
            "Do NOT extract data. Do NOT click on individual property cards or detail pages. " +
            "Stop as soon as you can see a page with multiple property listing cards.",
        });

        const navInstruction =
          `You are on the homepage of a real estate agency website: ${url}\n\n` +
          `TASK: Navigate to the page showing property listings. Steps:\n` +
          `1. Look in the navigation menu for links like "Properties", "For Sale", "For Rent", ` +
          `   "Buy", "Rent", "Listings", "Search Properties", "View Properties". Click one.\n` +
          `2. Once on the listings page, look for search/filter controls:\n` +
          `   - Category filter: select "${category !== "any" ? category.toUpperCase() : "For Sale or Rent"}"\n` +
          `   ${bedrooms ? `- Bedrooms filter: select or type "${bedrooms}"\n` : ""}` +
          `   ${bathrooms ? `- Bathrooms filter: select or type "${bathrooms}"\n` : ""}` +
          `   ${locality ? `- Locality/Neighbourhood filter: type or select "${locality}" (this is the specific area, NOT the whole country)\n` : city ? `- Location/City filter: type or select "${city}"\n` : ""}` +
          `   ${min_price ? `- Min price: ${min_price}\n` : ""}` +
          `   ${max_price ? `- Max price: ${max_price}\n` : ""}` +
          `   ${property_type && property_type !== "any" ? `- Property type: "${property_type}"\n` : ""}` +
          `3. Submit/apply the filters if there is a Search or Apply button.\n` +
          `4. Wait for the results to load (you will see property cards with prices and images).\n` +
          `5. STOP. Do not click on individual property cards.`;

        await navAgent.execute({ instruction: navInstruction, maxSteps: 8 });

        // CRITICAL: restore active page after agent (may have opened tabs or closed page)
        await ensureActivePage();
        await page.waitForTimeout(1500);

        // Refresh DOM images after navigation
        try {
          const freshImages = (await page.evaluate(() => {
            return Array.from(document.querySelectorAll("img[src], img[data-src], img[data-lazy]"))
              .map((img) => {
                const el = img as HTMLImageElement;
                return el.src || el.dataset?.src || el.dataset?.lazy || "";
              })
              .filter((src) =>
                src.startsWith("http") &&
                !src.includes("logo") && !src.includes("icon") &&
                !src.includes(".svg") && !src.includes("placeholder") &&
                !src.includes("blank") && !src.includes("spinner") &&
                !src.includes("avatar") && !src.includes("flag") &&
                src.length < 500
              );
          })) as string[];
          domImages = [...new Set([...freshImages, ...domImages])].slice(0, 60);
        } catch { /* ignore */ }

      } else {
        // Already on a listings/non-homepage URL — apply filters if present
        const filterAgent = stagehand.agent({
          model: "openai/gpt-4o-mini",
          systemPrompt:
            "You are a search filter agent. Apply the given search filters on this real estate " +
            "listings page, then stop. Do NOT click into individual property pages.",
        });

        if (filterStr !== "any properties (no specific filters)") {
          await filterAgent.execute({
            instruction:
              `Apply these filters on this property listings page: ${filterStr}.\n` +
              `Look for filter dropdowns, checkboxes, or search inputs. Apply them and click Search/Apply.\n` +
              `Wait for results. Do NOT click any individual property cards. Stop.`,
            maxSteps: 5,
          });
          // Restore active page after agent
          await ensureActivePage();
          await page.waitForTimeout(1500);
        }
      }

      // ── STEP 2: Extract all listings from the current page ──────────────
      // (extractInstruction is defined above the try block and shared with pagination)

      // Always ensure active page before extract — agent may have left stale state
      await ensureActivePage();

      const extracted = await stagehand.extract(extractInstruction, PropertySchema, {
        serverCache: false,
      });

      extractedProperties = extracted.listings || [];
      agencyName = extracted.agency_name || "";
      agencyPhone = extracted.agency_phone || "";
      agencyEmail = extracted.agency_email || "";
      agencyWhatsapp = extracted.agency_whatsapp || "";

      // If extract() returned nothing, try agent() as last resort
      if (extractedProperties.length === 0) {
        console.warn("extract() returned 0 results, trying agent() fallback");
        const fallbackAgent = stagehand.agent({
          model: "openai/gpt-4o-mini",
          systemPrompt: "Extract property listings from this page. Do not navigate anywhere.",
        });
        const fallbackResult = await fallbackAgent.execute({
          instruction: extractInstruction,
          maxSteps: 8,
          output: PropertySchema,
        });
        // Restore page after fallback agent too
        await ensureActivePage();
        const fb = fallbackResult.output as z.infer<typeof PropertySchema> | undefined;
        extractedProperties = fb?.listings || [];
        agencyName = fb?.agency_name || agencyName;
        agencyPhone = fb?.agency_phone || agencyPhone;
        agencyEmail = fb?.agency_email || agencyEmail;
      }

    } catch (err) {
      console.error("Scrape error:", err);
      // Last-resort: restore page and try a plain extract
      try {
        await ensureActivePage();
        const extracted = await stagehand.extract(
          "Extract ALL property listings visible on this page with every available detail.",
          PropertySchema,
          { serverCache: false }
        );
        extractedProperties = extracted.listings || [];
        agencyName = extracted.agency_name || "";
        agencyPhone = extracted.agency_phone || "";
        agencyEmail = extracted.agency_email || "";
      } catch (e2) {
        console.error("Final fallback extract also failed:", e2);
        // Return empty gracefully — don't crash the whole request
      }
    }

    // ── PAGINATION — scrape more pages until we have 5 FILTERED matches ────
    // Strategy: after each page, apply hard filters (locality + category) to the
    // accumulated pool. Stop when we have 5+ filtered matches OR hit MAX_PAGES.
    // This is the correct approach: keep paginating until the user gets real results.
    // Uses DOM-based next-page detection (no LLM cost).

    const MAX_PAGES = 8;       // scrape up to 8 pages total
    const TARGET_FILTERED = 5; // stop once we have this many hard-filtered results

    // ── DOM anchor URL extractor — returns {url, context} pairs ────────────
    // context = the text content of the card containing the link, used for
    // text-similarity matching rather than fragile index-based matching.
    async function extractPageAnchors(baseOrigin: string): Promise<Array<{url: string; context: string}>> {
      try {
        return await page.evaluate((bo: string) => {
          const seen = new Set<string>();
          const out: Array<{url: string; context: string}> = [];
          const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
          for (const a of anchors) {
            const raw = a.getAttribute("href") || "";
            if (!raw || raw === "#" || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
            const full = raw.startsWith("http") ? raw : bo + (raw.startsWith("/") ? raw : "/" + raw);
            try { if (new URL(full).host !== new URL(bo).host) continue; } catch { continue; }
            // Property detail URL patterns — broad, covers WordPress & custom CMS
            const isDetailLink =
              /\/(property|listing|properties|rent|sale|buy|detail|unit|apartment|villa|penthouse|house|ref|id|p|item|estate|immobile|appartement)[\/-]/i.test(full) ||
              /\/\d{4,}/.test(full) ||
              /[?&](p|id|pid|ref|property_id|listing_id)=\d+/.test(full) ||
              /post_type=property/i.test(full) ||
              /\/property[-_]/.test(full);
            if (!isDetailLink) continue;
            if (seen.has(full)) continue;
            seen.add(full);
            // Walk up DOM to find the card container and capture its text
            let container: Element = a;
            for (let i = 0; i < 6; i++) {
              const parent = container.parentElement;
              if (!parent || parent.tagName === "BODY") break;
              container = parent;
              if ((container.textContent || "").trim().length > 40) break;
            }
            const context = (container.textContent || "")
              .replace(/\s+/g, " ").trim().slice(0, 300);
            out.push({ url: full, context });
          }
          return out;
        }, baseOrigin) as Array<{url: string; context: string}>;
      } catch {
        return [];
      }
    }

    // Collect anchors from page 1 immediately (browser is still on that page)
    const baseUrl = (() => {
      try { const u = new URL(url); return `${u.protocol}//${u.host}`; }
      catch { return url; }
    })();
    let allPageAnchors: Array<{url: string; context: string}> = await extractPageAnchors(baseUrl);

    // Inline filter for pagination — must match ALL user filters to count toward TARGET_FILTERED
    // This ensures we keep paginating until we have 5 properties that actually match bedrooms etc.
    function countFilteredMatches(props: typeof extractedProperties): number {
      let filtered = [...props];
      if (locality) {
        const loc = locality.toLowerCase();
        const byLoc = filtered.filter((p) =>
          (p.locality || "").toLowerCase().includes(loc) ||
          (p.city || "").toLowerCase().includes(loc) ||
          ((p as any).full_address || "").toLowerCase().includes(loc) ||
          (p.title || "").toLowerCase().includes(loc)
        );
        filtered = byLoc;
      }
      if (category && category !== "any") {
        const cat = category.toLowerCase();
        filtered = filtered.filter((p) => {
          const pCat = (p.category || "").toLowerCase();
          if (!pCat) return true;
          return pCat.includes(cat);
        });
      }
      // ── INCLUDE bedrooms in pagination count — this is the key fix ──────
      // Only count properties with the CORRECT bedroom count (or unknown).
      // We split into two groups: known-match + unknown.
      // If we already have enough known-bedroom matches → stop paginating.
      // If not, continue even if null-bedroom props bring the count up.
      if (bedrooms != null && !isNaN(Number(bedrooms))) {
        const reqBeds = Number(bedrooms);
        const knownMatch  = filtered.filter(p => p.bedrooms === reqBeds);
        const unknownBeds = filtered.filter(p => p.bedrooms == null);
        // Use known matches as the primary count; pad with unknowns only if needed
        // so we paginate until we have 5 properties that are definitely or possibly correct.
        filtered = knownMatch.length >= TARGET_FILTERED
          ? knownMatch
          : [...knownMatch, ...unknownBeds];
      }
      if (bathrooms != null && !isNaN(Number(bathrooms))) {
        const reqBaths = Number(bathrooms);
        const knownMatch  = filtered.filter(p => p.bathrooms === reqBaths);
        const unknownBaths = filtered.filter(p => p.bathrooms == null);
        filtered = knownMatch.length >= TARGET_FILTERED
          ? knownMatch
          : [...knownMatch, ...unknownBaths];
      }
      return filtered.length;
    }

    async function findNextPageUrl(): Promise<string | null> {
      try {
        return await page.evaluate((): string | null => {
          // Ranked list of next-page selectors (most specific first)
          const candidates: string[] = [
            'a[rel="next"]',
            'a[aria-label="Next page"]',
            'a[aria-label="Next"]',
            'button[aria-label="Next page"]',
            'button[aria-label="Next"]',
            'a.next',
            'a.next-page',
            'a.pagination-next',
            '[class*="next-page"] a',
            '[class*="nextpage"] a',
            '[class*="pagination"] a[class*="next"]',
            '[class*="pagination"] li:last-child a',
            // Generic: look for a visible element containing "next" text
          ];
          for (const sel of candidates) {
            const el = document.querySelector(sel) as HTMLAnchorElement | null;
            if (!el) continue;
            // Skip disabled
            if (el.getAttribute("aria-disabled") === "true") continue;
            if (el.classList.contains("disabled")) continue;
            const href = el.getAttribute("href");
            if (href && href !== "#" && !href.startsWith("javascript:")) {
              return href.startsWith("http") ? href : window.location.origin + href;
            }
          }
          // Fallback: look for any <a> or <button> whose visible text is "Next" / "›" / "»"
          const allLinks = Array.from(document.querySelectorAll("a, button")) as HTMLElement[];
          for (const el of allLinks) {
            const text = el.textContent?.trim() || "";
            if (/^(next|›|»|>|→)$/i.test(text)) {
              if ((el as HTMLAnchorElement).getAttribute?.("aria-disabled") === "true") continue;
              if (el.classList.contains("disabled")) continue;
              const href = (el as HTMLAnchorElement).getAttribute?.("href");
              if (href && href !== "#" && !href.startsWith("javascript:")) {
                return href.startsWith("http") ? href : window.location.origin + href;
              }
            }
          }
          return null;
        });
      } catch {
        return null;
      }
    }

    let currentPage = 1;
    console.log(`[Pagination] Page 1: ${extractedProperties.length} raw props, ${countFilteredMatches(extractedProperties)} filtered matches`);

    // ── Navigate to next page — tries 3 strategies in order ─────────────────
    // 1. DOM href detection (fast, zero LLM cost)
    // 2. stagehand.act() click on visible next/load-more button (handles JS pagination)
    // 3. URL pattern increment (?page=N, /page/N)
    // Returns true if we actually moved to a new page (URL changed or new content loaded).
    async function goToNextPage(): Promise<boolean> {
      await ensureActivePage();
      const urlBefore = page.url();

      // Strategy 1 — DOM href link
      const nextUrl = await findNextPageUrl();
      if (nextUrl && nextUrl !== urlBefore) {
        try {
          await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
          await page.waitForTimeout(1500);
          await ensureActivePage();
          const urlAfter = page.url();
          if (urlAfter !== urlBefore) {
            console.log(`[Pagination] S1 (DOM href) → ${urlAfter}`);
            return true;
          }
        } catch { /* fall through */ }
      }

      // Strategy 2 — stagehand.act() for JS-driven pagination (most reliable)
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await stagehand!.act(
          'Find and click the button or link that shows the NEXT PAGE of property listings. ' +
          'Look for: "Next", "Next page", ">", "»", "→", a right-arrow button, a "Load More" button, ' +
          'or the next page number in a pagination bar. ' +
          'If there is NO such element, or you are already on the last page, do nothing.'
        );
        await page.waitForTimeout(2000);
        await ensureActivePage();
        const urlAfterAct = page.url();
        if (urlAfterAct !== urlBefore) {
          console.log(`[Pagination] S2 (act click) → ${urlAfterAct}`);
          return true;
        }
        // URL didn't change — check if new content loaded (e.g. infinite scroll / AJAX append)
        // by measuring how many listing cards are now visible vs before
        const cardsNow = await page.evaluate(() =>
          document.querySelectorAll(
            '[class*="property"], [class*="listing"], [class*="card"], [class*="result"], article'
          ).length
        ).catch(() => 0);
        if (cardsNow > 0) {
          console.log(`[Pagination] S2 (act) — URL same but ${cardsNow} cards visible, treating as loaded`);
          return true; // AJAX / infinite scroll — content updated in place
        }
      } catch { /* fall through */ }

      // Strategy 3 — URL pattern increment (?page=N, /page/N, &p=N, #page-N)
      try {
        const cu = new URL(urlBefore);
        // Try ?page=
        const pageParam = cu.searchParams.get("page") || cu.searchParams.get("p") || cu.searchParams.get("pg");
        if (pageParam) {
          const n = parseInt(pageParam, 10);
          if (!isNaN(n)) {
            const key = cu.searchParams.has("page") ? "page" : cu.searchParams.has("p") ? "p" : "pg";
            cu.searchParams.set(key, String(n + 1));
            const candidate = cu.toString();
            await page.goto(candidate, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
            await page.waitForTimeout(1500);
            await ensureActivePage();
            if (page.url() !== urlBefore) {
              console.log(`[Pagination] S3 (URL param) → ${page.url()}`);
              return true;
            }
          }
        }
        // Try /page/N
        const pathMatch = cu.pathname.match(/\/page\/(\d+)/i);
        if (pathMatch) {
          cu.pathname = cu.pathname.replace(/\/page\/\d+/i, `/page/${parseInt(pathMatch[1]) + 1}`);
          const candidate = cu.toString();
          await page.goto(candidate, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
          await page.waitForTimeout(1500);
          await ensureActivePage();
          if (page.url() !== urlBefore) {
            console.log(`[Pagination] S3 (URL path) → ${page.url()}`);
            return true;
          }
        }
      } catch { /* fall through */ }

      console.log(`[Pagination] All strategies failed — no next page found after page ${currentPage}`);
      return false;
    }

    while (
      currentPage < MAX_PAGES &&
      countFilteredMatches(extractedProperties) < TARGET_FILTERED
    ) {
      const moved = await goToNextPage();
      if (!moved) break;

      try {
        const nextExtracted = await stagehand!.extract(extractInstruction, PropertySchema, {
          serverCache: false,
        });
        const nextProps = nextExtracted.listings || [];

        // Skip this page if it returned no new properties (we may have looped back)
        if (nextProps.length === 0) {
          console.log(`[Pagination] Page ${currentPage + 1} returned 0 properties — stopping.`);
          break;
        }

        // Dedup by title+price to avoid counting the same listing twice (some sites repeat top listings)
        const existingKeys = new Set(
          extractedProperties.map(p => `${(p.title || "").slice(0, 40)}|${p.price}`)
        );
        const freshProps = nextProps.filter(
          p => !existingKeys.has(`${(p.title || "").slice(0, 40)}|${p.price}`)
        );

        if (freshProps.length === 0) {
          console.log(`[Pagination] Page ${currentPage + 1} — all ${nextProps.length} props are duplicates, stopping.`);
          break;
        }

        // Collect DOM anchors from the new page
        const pageAnchors = await extractPageAnchors(baseUrl);
        allPageAnchors = [...allPageAnchors, ...pageAnchors];

        extractedProperties = [...extractedProperties, ...freshProps];
        currentPage++;
        console.log(`[Pagination] Page ${currentPage}: +${freshProps.length} fresh props (${nextProps.length - freshProps.length} dupes skipped), ${countFilteredMatches(extractedProperties)} filtered matches total`);
      } catch (pageErr) {
        console.warn(`[Pagination] Failed to scrape page ${currentPage + 1}:`, pageErr);
        break;
      }
    }

    console.log(`[Pagination] Done. Scraped ${currentPage} pages, ${extractedProperties.length} total raw, ${countFilteredMatches(extractedProperties)} filtered matches.`);

    // Deduplicate allPageAnchors by URL, preserving order
    {
      const seenUrls = new Set<string>();
      allPageAnchors = allPageAnchors.filter(a => {
        if (seenUrls.has(a.url)) return false;
        seenUrls.add(a.url);
        return true;
      });
    }
    console.log(`[Anchors] Collected ${allPageAnchors.length} unique property detail URLs across all pages`);

    // Map: listing_url → hero image base64 screenshot
    // Populated by navigating to each property's detail page
    const heroImageByUrl = new Map<string, string>();

    // Helper: given a detail page URL, navigate there and screenshot the largest img
    async function fetchHeroImage(detailUrl: string): Promise<string> {
      try {
        await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeoutMs: 20000 });
        await page.waitForTimeout(1500);

        // Detect "property not found" / 404 / error pages — skip screenshotting them
        const pageSignals = await page.evaluate((): { is404: boolean } => {
          const body = document.body?.innerText?.toLowerCase() || "";
          const title = document.title?.toLowerCase() || "";
          const is404 =
            document.querySelector("[class*='not-found'], [class*='error-page'], [class*='404']") !== null ||
            /\b(404|not found|page not found|property not found|listing not found|no longer available|removed|deleted)\b/.test(body.slice(0, 500)) ||
            /\b(404|not found)\b/.test(title);
          return { is404 };
        });

        if (pageSignals.is404) {
          console.warn(`[fetchHeroImage] Skipping ${detailUrl} — page shows 404/not-found`);
          return "";
        }

        // Find the largest visible <img> on the page (hero / gallery image)
        const bbox = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
          let best: { x: number; y: number; w: number; h: number } | null = null;
          let bestArea = 0;
          for (const img of imgs) {
            const src = img.src || "";
            // Skip logos, icons, avatars, flags
            if (!src || src.includes("logo") || src.includes("icon") ||
                src.includes("avatar") || src.includes("flag") ||
                src.includes(".svg") || src.includes("placeholder")) continue;
            const r = img.getBoundingClientRect();
            if (r.width < 150 || r.height < 100) continue;
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              best = { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
            }
          }
          return best;
        }) as { x: number; y: number; w: number; h: number } | null;

        if (bbox && bbox.w > 0 && bbox.h > 0) {
          const buf = await page.screenshot({
            type: "jpeg",
            quality: 80,
            clip: { x: Math.max(0, bbox.x), y: Math.max(0, bbox.y), width: bbox.w, height: bbox.h },
          });
          return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
        }

        // Fallback: full viewport screenshot (top portion)
        const buf = await page.screenshot({ type: "jpeg", quality: 70 });
        return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
      } catch {
        return "";
      }
    }

    // Helper: normalize text for comparison
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

    // ── Resolve listing URLs for all extracted properties ────────────────
    // Do this BEFORE closing Stagehand so we can navigate to detail pages.

    // Helper: sanitize LLM string fields
    const clean = (v: string | null | undefined): string => {
      if (!v) return "";
      const t = v.trim().toLowerCase();
      if (t === "null" || t === "undefined" || t === "n/a" || t === "none" || t === "-") return "";
      return v.trim();
    };

    const isFakeUrl = (u: string): boolean => {
      if (!u) return true;
      // Catch partial URLs like "https://" or "http://"
      if (/^https?:\/\/?$/.test(u.trim())) return true;
      try {
        const parsed = new URL(u);
        // Must be http/https
        if (!["http:", "https:"].includes(parsed.protocol)) return true;
        const host = parsed.hostname;
        // Hostname must contain a dot (real domain)
        if (!host || !host.includes(".")) return true;
        // Known fake/placeholder domains
        const fakeDomains = ["example.com", "placeholder.com", "via.placeholder.com",
          "dummyimage.com", "lorempixel.com", "picsum.photos", "placehold.it",
          "placeimg.com", "unsplash.it"];
        if (fakeDomains.some(d => host === d || host.endsWith("." + d))) return true;
        // LLM-hallucinated placeholder patterns
        if (/image[-_]url[-_]?\d*/i.test(host)) return true;
        if (/placeholder|dummy|lorem|fake[-_]?url/i.test(host)) return true;
        // Generic path patterns
        if (/\/(link|image|photo)\d+$/i.test(parsed.pathname)) return true;
        return false;
      } catch { return true; }  // new URL() throws on spaces → fake URL
    };

    // ── Smart URL resolution ──────────────────────────────────────────────
    // Priority 1: LLM-extracted listing_url (verified on same domain)
    // Priority 2: Best text-similarity match from DOM anchors
    // Priority 3: Index-based fallback (last resort)
    //
    // Text matching: tokenize property title + price + bedrooms, count how many
    // tokens appear in each DOM anchor's card context text. Highest score wins.

    function scoreMatch(
      prop: { title?: string | null; price?: number | null; bedrooms?: number | null; locality?: string | null },
      candidate: { url: string; context: string }
    ): number {
      const ctx = candidate.context.toLowerCase();
      let score = 0;
      // Title words (length > 3 to skip noise words)
      const titleWords = (prop.title || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
      for (const w of titleWords) { if (ctx.includes(w)) score += 2; }
      // Price (strong signal — exact number match)
      if (prop.price != null && ctx.includes(String(Math.round(prop.price)))) score += 8;
      // Bedrooms
      if (prop.bedrooms != null && ctx.includes(String(prop.bedrooms))) score += 2;
      // Locality
      const loc = (prop.locality || "").toLowerCase();
      if (loc.length > 2 && ctx.includes(loc)) score += 3;
      return score;
    }

    // Track which anchor URLs have been assigned to avoid duplicates
    const assignedUrls = new Set<string>();

    const resolvedUrls: string[] = extractedProperties.map((p, idx) => {
      // Priority 1: LLM-extracted URL (verified same domain, not fake)
      let u = p.listing_url || "";
      if (u && u.startsWith("/")) u = baseUrl + u;
      if (u.startsWith("http") && !isFakeUrl(u)) {
        try {
          if (new URL(u).host === new URL(baseUrl).host && !assignedUrls.has(u)) {
            assignedUrls.add(u);
            return u;
          }
        } catch { /* fall through */ }
      }

      // Priority 2: Best text-similarity match from DOM anchors
      if (allPageAnchors.length > 0) {
        // Score all unassigned candidates
        const scored = allPageAnchors
          .filter(a => !assignedUrls.has(a.url))
          .map(a => ({ ...a, score: scoreMatch(p, a) }))
          .filter(a => a.score > 0)
          .sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
          assignedUrls.add(scored[0].url);
          return scored[0].url;
        }

        // Priority 3: Index-based fallback — only use unassigned anchors
        const unassigned = allPageAnchors.filter(a => !assignedUrls.has(a.url));
        if (unassigned.length > 0) {
          assignedUrls.add(unassigned[0].url);
          return unassigned[0].url;
        }
      }

      return "";
    });

    console.log(`[URLs] Resolved ${resolvedUrls.filter(Boolean).length}/${extractedProperties.length} property URLs`);

    // ── HERO IMAGE: DISABLED ─────────────────────────────────────────────
    // Navigating to each detail page takes ~20s × 5 = 100 extra seconds,
    // which reliably causes the backend httpx timeout to fire while the
    // browser is still working — making healthy sites appear "unreachable".
    // Images from listing cards (domImages + LLM-extracted images) are
    // sufficient. fetchHeroImage is kept as a function but not called here.

    await stagehand.close();
    stagehand = null;

    const properties = extractedProperties.map((p, idx) => {
      const listingUrl = resolvedUrls[idx] || "";

      const isValidSrc = (src: string) =>
        src && (src.startsWith("data:image") || (src.startsWith("http") && !isFakeUrl(src)));

      // Hero image from property's own detail page — guaranteed correct
      const heroShot = listingUrl ? heroImageByUrl.get(listingUrl) || "" : "";
      const realImgs = (p.images || []).filter(isValidSrc);
      const imgs = heroShot ? [heroShot] : realImgs.slice(0, 1);

      return {
        title: clean(p.title),
        property_type: clean(p.property_type),
        category: clean(p.category) || (category !== "any" ? category : ""),
        price: p.price ?? null,
        currency: p.currency || "EUR",
        bedrooms: p.bedrooms ?? null,
        bathrooms: p.bathrooms ?? null,
        total_sqm: p.total_sqm ?? null,
        locality: clean(p.locality) || locality || "",
        city: clean(p.city) || city,
        country,
        full_address: clean(p.full_address),
        description: clean(p.description).slice(0, 400),
        listing_url: listingUrl,
        images: imgs.slice(0, 5),
        amenities: (p.amenities || []).filter(a => clean(a) !== "").map(a => clean(a)).slice(0, 15),
        furnished: clean(p.furnished),
        floor_number: p.floor_number ?? null,
        year_built: p.year_built ?? null,
        agency_name: clean(agencyName),
        agency_website: url,
        agency_phone: clean(p.agent_phone) || clean(agencyPhone),
        agency_email: clean(p.agent_email) || clean(agencyEmail),
        agent_name: clean(p.agent_name),
        agent_phone: clean(p.agent_phone),
        agent_whatsapp: "",
        agent_email: clean(p.agent_email),
        source_url: url,
      };
    });

    // ── Hard post-extraction filter — guarantee user preferences are respected ──
    // The navAgent tries to apply filters in the website UI, but many sites
    // ignore them or have non-standard controls. We always hard-filter here.

    let filteredProperties = [...properties];

    // 1. Locality filter — HARD (no fallback — user explicitly stated this area)
    if (locality) {
      const loc = locality.toLowerCase();
      filteredProperties = filteredProperties.filter((p) =>
        (p.locality || "").toLowerCase().includes(loc) ||
        (p.city || "").toLowerCase().includes(loc) ||
        (p.full_address || "").toLowerCase().includes(loc) ||
        (p.title || "").toLowerCase().includes(loc)
      );
      // No fallback — if site has no listings in this locality, return empty
    }

    // 2. Category filter (sale / rent) — HARD (no fallback — user explicitly stated this)
    if (category && category !== "any") {
      filteredProperties = filteredProperties.filter((p) => {
        const pCat = (p.category || "").toLowerCase();
        if (!pCat) return true; // unknown — keep it
        return pCat.includes(category.toLowerCase());
      });
      // No fallback — if site only has sale listings when user asked for rent → show nothing
    }

    // 3. Property type filter
    if (property_type && property_type !== "any") {
      const ptype = property_type.toLowerCase();
      const byType = filteredProperties.filter((p) => {
        const t = (p.property_type || "").toLowerCase();
        if (!t) return true; // unknown — keep it
        return t.includes(ptype) || ptype.includes(t);
      });
      if (byType.length > 0) filteredProperties = byType;
    }

    // 4. Bedrooms filter — STRICT exact match.
    // Pagination already handles "not enough results" by scraping more pages.
    // null/unknown bedrooms are kept (site didn't expose that field — may still be correct).
    if (bedrooms != null && !isNaN(Number(bedrooms))) {
      const reqBeds = Number(bedrooms);
      const byBeds = filteredProperties.filter((p) => {
        if (p.bedrooms == null) return true; // unknown — keep
        return p.bedrooms === reqBeds;
      });
      if (byBeds.length > 0) filteredProperties = byBeds;
      // if byBeds is empty: site didn't extract bedrooms at all — keep all (pagination will find more)
    }

    // 5. Bathrooms filter — STRICT exact match, same logic.
    if (bathrooms != null && !isNaN(Number(bathrooms))) {
      const reqBaths = Number(bathrooms);
      const byBaths = filteredProperties.filter((p) => {
        if (p.bathrooms == null) return true;
        return p.bathrooms === reqBaths;
      });
      if (byBaths.length > 0) filteredProperties = byBaths;
    }

    // 6. Price range filter
    if (max_price != null && !isNaN(Number(max_price))) {
      const maxP = Number(max_price);
      const byMaxPrice = filteredProperties.filter((p) =>
        p.price == null || p.price <= maxP
      );
      if (byMaxPrice.length > 0) filteredProperties = byMaxPrice;
    }
    if (min_price != null && !isNaN(Number(min_price))) {
      const minP = Number(min_price);
      const byMinPrice = filteredProperties.filter((p) =>
        p.price == null || p.price >= minP
      );
      if (byMinPrice.length > 0) filteredProperties = byMinPrice;
    }

    const finalProperties = filteredProperties;

    return NextResponse.json({
      success: true,
      url,
      properties_found: finalProperties.length,
      properties: finalProperties,
      agency: {
        name: agencyName,
        phone: agencyPhone,
        email: agencyEmail,
        whatsapp: agencyWhatsapp,
        website: url,
      },
    });

  } catch (err: unknown) {
    try {
      if (stagehand) await stagehand.close();
    } catch { /* ignore */ }

    const message = err instanceof Error ? err.message : String(err);
    console.error("scrape-url error:", message);
    return NextResponse.json(
      {
        error: "Scraping failed",
        detail: message,
        note: "No results from this agency. Try calling scrape_website with the next agency URL.",
      },
      { status: 500 }
    );
  }
}
