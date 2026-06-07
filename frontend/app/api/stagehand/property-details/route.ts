export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/stagehand/property-details
 *
 * Navigate to an agency website, find a specific property by title/price,
 * click into its individual page, and extract FULL details + agent contact.
 *
 * Body: { agency_url, property_title, property_price?, property_city? }
 */

import { NextRequest, NextResponse } from "next/server";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const PropertyDetailSchema = z.object({
  title: z.string().nullable().optional().default("")
    .describe("Property title or headline shown at the top of the listing page"),
  price: z.number().nullable().optional()
    .describe("Numeric sale or rent price only — no currency symbols. E.g. 425000 or 1200"),
  currency: z.string().nullable().optional().default("")
    .describe("Currency code: EUR, USD, GBP, AED, etc."),
  description: z.string().nullable().optional().default("")
    .describe("Full property description text as shown on the page"),
  full_address: z.string().nullable().optional().default("")
    .describe("Complete street address of the property"),
  locality: z.string().nullable().optional().default("")
    .describe("Neighbourhood or area name, e.g. Sliema, Valletta, Gzira"),
  bedrooms: z.number().nullable().optional()
    .describe("Number of bedrooms as an integer"),
  bathrooms: z.number().nullable().optional()
    .describe("Number of bathrooms as an integer"),
  total_sqm: z.number().nullable().optional()
    .describe("Total area in square metres as a number, e.g. 209"),
  floor_number: z.number().nullable().optional()
    .describe("Floor level number as an integer"),
  furnished: z.string().nullable().optional().default("")
    .describe("Furnished status: yes, no, or partial"),
  features: z.array(z.string()).nullable().optional().default([])
    .describe("Every key-value feature from Home Details table: e.g. 'Air Conditioning: Yes', 'Lift: Yes', 'Swimming Pool: No', 'Balconies: 1', 'Parking: Yes'"),
  images: z.array(z.string()).nullable().optional().default([])
    .describe("Full https:// URLs of THIS property's photos — large gallery images only. NO logos, icons, thumbnails from other listings, or placeholder images. Only images that show THIS specific property's interior or exterior."),
  // Individual agent (not just agency)
  agent_name: z.string().nullable().optional().default("")
    .describe("Full name of the specific agent/consultant listed for this property"),
  agent_title: z.string().nullable().optional().default("")
    .describe("Job title of the agent, e.g. Property Sales Consultant"),
  agent_phone: z.string().nullable().optional().default("")
    .describe("Direct phone number of the agent"),
  agent_whatsapp: z.string().nullable().optional().default("")
    .describe("WhatsApp number of the agent"),
  agent_email: z.string().nullable().optional().default("")
    .describe("Email address of the agent"),
  // Agency
  agency_name: z.string().nullable().optional().default("")
    .describe("Name of the real estate agency"),
  agency_phone: z.string().nullable().optional().default("")
    .describe("Agency's main phone number"),
  agency_email: z.string().nullable().optional().default("")
    .describe("Agency's main email address"),
  listing_url: z.string().nullable().optional().default("")
    .describe("The exact URL of this specific property's page — must start with https://"),
});

export async function POST(req: NextRequest) {
  let stagehand: InstanceType<typeof Stagehand> | null = null;

  try {
    const body = await req.json();
    const {
      agency_url,
      property_title = "",
      property_price,
      property_city = "",
    } = body;

    if (!agency_url) {
      return NextResponse.json({ error: "agency_url is required" }, { status: 400 });
    }

    const IS_BROWSERBASE = process.env.STAGEHAND_ENV === "BROWSERBASE";
    const openaiKey = process.env.OPENAI_API_KEY || "";

    stagehand = new Stagehand(
      IS_BROWSERBASE
        ? {
            env: "BROWSERBASE",
            apiKey: process.env.BROWSERBASE_API_KEY || "",
            projectId: process.env.BROWSERBASE_PROJECT_ID || "",
            model: { modelName: "openai/gpt-4o-mini", apiKey: openaiKey },
            verbose: 0,
          }
        : {
            env: "LOCAL",
            model: { modelName: "openai/gpt-4o-mini", apiKey: openaiKey },
            verbose: 0,
            localBrowserLaunchOptions: {
              executablePath: process.env.CHROME_PATH || undefined,
              args: [
                // Headless: off in local dev so you can see the browser live.
                // Set HEADLESS=true in .env.local to re-enable.
                ...(process.env.HEADLESS === "true" ? ["--headless=new"] : []),
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
                "--window-size=1366,768",
                // --no-zygote and --single-process crash Chrome on Mac — only add on Linux (GCP/Docker)
                ...(process.env.CHROME_PATH ? ["--no-zygote", "--single-process"] : []),
              ],
            },
          }
    );

    await stagehand.init();

    // v3 correct API: context.pages()[0]
    const page = stagehand.context.pages()[0];
    if (!page) throw new Error("No active page");

    // Detect if agency_url is already a direct property page
    // (has a meaningful path beyond just the domain root)
    const isDirectPropertyUrl = (() => {
      try {
        const u = new URL(agency_url);
        const path = u.pathname.replace(/\/$/, "");
        // Treat as direct if path contains a property-like segment
        return (
          /\/(property|listing|detail|ref|id|sale|rent|appartement|villa|penthouse|apartment)[\/-]/i.test(path) ||
          /\/[a-z0-9-]+-\d{4,}/i.test(path) ||     // slug with ID: "3-bed-apartment-12345"
          /\/\d{4,}/.test(path) ||                   // numeric ID in path
          path.split("/").filter(Boolean).length >= 2 // at least 2 path segments
        );
      } catch { return false; }
    })();

    // Navigate to the URL
    await page.goto(agency_url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(2000);

    if (!isDirectPropertyUrl) {
      // Not a direct page — use agent to find and navigate to the property
      const priceHint = property_price ? `€${property_price}` : "";
      const searchHint = [property_title, priceHint, property_city].filter(Boolean).join(" — ");

      const agent = stagehand.agent({
        model: "openai/gpt-4o-mini",
        systemPrompt:
          "You are a real estate property detail extractor. " +
          "Your job: find a specific property listing on this website and navigate to its individual page. " +
          "Do NOT navigate to external websites. Stay on this domain only.",
      });

      await agent.execute({
        instruction:
          `Find the property matching: "${searchHint}" on this real estate website. ` +
          `If you are on the homepage, first navigate to the properties/listings section. ` +
          `Then find the matching property card and click it to open the full property detail page. ` +
          `Once on the property detail page, stop — do not click further.`,
        maxSteps: 15,
      });

      await page.waitForTimeout(2000);
    }
    // If isDirectPropertyUrl → already on the property page, no agent navigation needed

    // Capture the current URL (this is the individual property page URL)
    const currentUrl = page.url();

    // Scroll the page so lazy-loaded images initialise before we grab URLs
    try {
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    } catch { /* ignore */ }

    // Capture image URLs from DOM — only large, ACTUALLY LOADED images
    // naturalWidth > 10 ensures we skip spinners, 1px trackers, and unloaded lazy imgs
    let domImages: string[] = [];
    try {
      domImages = (await page.evaluate(() => {
        const BAD = ["logo", "icon", ".svg", "placeholder", "flag",
                     "avatar", "spinner", "blank.gif", "pixel",
                     "map", "street-view", "static-map", "data:image/gif"];
        const imgs = Array.from(document.querySelectorAll("img")) as (HTMLImageElement & { dataset: DOMStringMap })[];
        return imgs
          .filter((img) => {
            const r = img.getBoundingClientRect();
            if (r.width < 200 || r.height < 150) return false;          // too small
            if (!img.complete || img.naturalWidth < 10) return false;   // not loaded yet
            const src = img.dataset?.lazySrc || img.dataset?.original ||
                        img.dataset?.src || img.src || "";
            if (!src.startsWith("http")) return false;
            if (BAD.some(kw => src.toLowerCase().includes(kw))) return false;
            return true;
          })
          .map((img) => (
            img.dataset?.lazySrc ||
            img.dataset?.original ||
            img.dataset?.src ||
            img.dataset?.fullSrc ||
            img.getAttribute("data-lazy") ||
            img.getAttribute("data-image") ||
            img.src ||
            ""
          ))
          .filter(Boolean);
      })) as string[];
      domImages = [...new Set(domImages)].slice(0, 15);
    } catch { /* ignore */ }

    // ── Screenshot carousel/gallery images from the property detail page ─────
    let carouselScreenshots: string[] = [];
    let pageScreenshot = "";

    // Wait for the largest image on the page to fully load (naturalWidth > 0)
    const waitForHeroImageLoad = async (timeoutMs = 6000): Promise<void> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const loaded = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
          return imgs.some(img => {
            const r = img.getBoundingClientRect();
            const src = img.src || "";
            if (r.width < 200 || r.height < 150) return false;
            if (!src || src.includes("logo") || src.includes("icon") || src.includes("data:image/gif")) return false;
            return img.complete && img.naturalWidth > 10; // loaded and not a 1px tracker
          });
        });
        if (loaded) return;
        await page.waitForTimeout(400);
      }
    };

    // Screenshot the largest LOADED image currently visible on screen.
    // Clips height to the lesser of the rendered height and viewport height
    // so we never capture white-space below a partially-rendered image.
    const screenshotHeroImage = async (): Promise<string> => {
      try {
        const box = await page.evaluate(() => {
          const BAD = ["logo", "icon", "avatar", "flag", "placeholder", ".svg", "data:image/gif", "spinner"];
          const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
          let best: { x: number; y: number; w: number; h: number; nh: number } | null = null;
          let bestArea = 0;
          for (const img of imgs) {
            const r = img.getBoundingClientRect();
            const src = img.src || "";
            if (r.width < 200 || r.height < 150) continue;
            if (BAD.some(kw => src.toLowerCase().includes(kw))) continue;
            if (!img.complete || img.naturalWidth < 10) continue;
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              // naturalHeight lets us calculate true content height ratio
              const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0;
              // rendered content height = rendered width / aspect ratio
              const contentH = ratio > 0 ? Math.round(r.width / ratio) : r.height;
              best = {
                x: r.left, y: r.top + window.scrollY,
                w: r.width,
                // clip to actual content height — avoids white padding in image container
                h: Math.min(r.height, contentH, window.innerHeight),
                nh: img.naturalHeight,
              };
            }
          }
          return best;
        }) as { x: number; y: number; w: number; h: number; nh: number } | null;

        if (box && box.w > 0 && box.h > 0) {
          const buf = await page.screenshot({
            type: "jpeg", quality: 85,
            clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.w, height: Math.max(50, box.h) },
          });
          return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
        }
      } catch { /* ignore */ }
      return "";
    };

    try {
      // Scroll down a bit to trigger lazy-load, then back to top
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);

      // Wait until at least one hero image has actually loaded
      await waitForHeroImageLoad(6000);
      // Extra render settle time — JPEG progressive rendering needs this
      await page.waitForTimeout(1000);

      // Screenshot first image
      const firstShot = await screenshotHeroImage();
      if (firstShot) carouselScreenshots.push(firstShot);

      // Click through carousel — up to 9 more slides
      const carouselNextSelectors = [
        'button[aria-label*="next" i]',
        'button[aria-label*="Next" i]',
        '[class*="next"] button',
        '[class*="carousel"] [class*="next"]',
        '[class*="slider"] [class*="next"]',
        '[class*="swiper-button-next"]',
        '.slick-next',
        '[class*="arrow-right"]',
        '[class*="arrow_right"]',
        'button[class*="right"]',
      ];

      for (let slide = 0; slide < 9; slide++) {
        let clicked = false;

        for (const sel of carouselNextSelectors) {
          try {
            const found = await page.evaluate((s: string) => {
              const el = document.querySelector(s) as HTMLElement | null;
              if (el) { el.click(); return true; }
              return false;
            }, sel);
            if (found) { clicked = true; break; }
          } catch { /* try next selector */ }
        }

        if (!clicked) {
          try {
            await stagehand.act(
              "click the next arrow or right chevron button in the property photo gallery or image slider"
            );
            clicked = true;
          } catch { break; }
        }

        if (!clicked) break;

        // Wait for new slide image to load before screenshotting
        await page.waitForTimeout(800);
        await waitForHeroImageLoad(3000);

        const shot = await screenshotHeroImage();
        if (!shot || shot === carouselScreenshots[carouselScreenshots.length - 1]) break;
        carouselScreenshots.push(shot);
      }

      pageScreenshot = carouselScreenshots[0] || "";

      // Fallback: full viewport if no carousel found
      if (carouselScreenshots.length === 0) {
        const buf = await page.screenshot({ type: "jpeg", quality: 75 });
        pageScreenshot = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
        carouselScreenshots = [pageScreenshot];
      }
    } catch { /* ignore */ }

    // Extract ALL details from the individual property page
    const extracted = await stagehand.extract(
      `Extract the COMPLETE details of this individual property listing. Get EVERYTHING:

PROPERTY INFO:
- title (property name)
- price (number only)
- currency (EUR/USD/GBP)
- description (FULL text of the property description)
- full_address
- locality (area/neighborhood)
- bedrooms (number)
- bathrooms (number)
- total_sqm (size in sqm)
- floor_number
- furnished (yes/no/partial)

FEATURES (extract ALL features shown in "Home Details" or property specs section):
- features: list every feature with its value, e.g. "Air Conditioning: Yes", "Lift: Yes",
  "Swimming Pool: No", "Balconies: 1", "Floor No: 4", "Bedroom 1 Dims: 3.4m by 4.1m",
  "Heating: None", "Parking: Yes", "Bus Stop: Close by", "Shops: Close by", "UCA: Yes", etc.
  Include ALL key-value pairs from the home details table.

IMAGES (CRITICAL):
- images: full https:// URLs of THIS property's own photos ONLY.
  These must be REAL URLs visible on this exact page — do NOT invent or guess URLs.
  DO NOT use example.com, placeholder.com, or any URL you are not certain exists on this page.
  DO NOT include: thumbnails from other listings, logos, icons, agent photos, map images.
  If you cannot find real image URLs, return an empty array [].

INDIVIDUAL AGENT CONTACT (the specific consultant/agent listed for this property, NOT just general agency):
- agent_name (the person's full name, e.g. "Paul Bondin")
- agent_title (their title, e.g. "Property Sales Consultant")
- agent_phone (their direct phone number)
- agent_whatsapp (their WhatsApp number)
- agent_email (their email address)

AGENCY:
- agency_name
- agency_phone
- agency_email
- listing_url (the EXACT URL from your browser address bar for this property page — do NOT invent)

Return everything you can see on this page.`,
      PropertyDetailSchema
    );

    await stagehand.close();

    // Helper: strip LLM string artifacts like "null", "n/a", "none"
    const clean = (v: string | null | undefined): string => {
      if (!v) return "";
      const t = v.trim().toLowerCase();
      if (t === "null" || t === "undefined" || t === "n/a" || t === "none" || t === "-") return "";
      return v.trim();
    };

    // Filter: reject known-fake or non-property image URLs
    const BAD_IMG_KEYWORDS = [
      "example.com", "placeholder", "logo", "icon", "avatar", "flag",
      "spinner", "blank", "pixel", "map", "static-map", "street-view",
      "agent-photo", "staff", "team", "profile",
    ];
    const isValidPropertyImg = (u: string) =>
      !!u &&
      u.startsWith("http") &&
      !BAD_IMG_KEYWORDS.some(kw => u.toLowerCase().includes(kw));

    // Cross-domain validation — LLM sometimes hallucinates URLs from training data.
    // If extracted listing_url is from a different domain than the page we scraped, discard it.
    const agencyDomain = (() => { try { return new URL(agency_url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const currentDomain = (() => { try { return new URL(currentUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();

    const isSameDomain = (u: string) => {
      try {
        const host = new URL(u).hostname.replace(/^www\./, "");
        return host === agencyDomain || host === currentDomain;
      } catch { return false; }
    };

    // AI-extracted images: only keep URLs from the actual scraped domain
    // (prevents hallucinated example.com / other-site images slipping through)
    const aiImages = (extracted.images || []).filter(u =>
      isValidPropertyImg(u) && isSameDomain(u)
    );
    const domOnly = domImages.filter(u => isValidPropertyImg(u) && !aiImages.includes(u));
    const uniqueImages = [...aiImages, ...domOnly].slice(0, 15);

    // Use navigation URL as listing_url (most reliable) — only fall back to LLM
    // extracted URL if it's on the same domain
    const extractedListingUrl = clean(extracted.listing_url);
    const safeListingUrl =
      currentUrl !== agency_url
        ? currentUrl
        : (extractedListingUrl && isSameDomain(extractedListingUrl) ? extractedListingUrl : currentUrl);

    // Sanitize text fields — reject if they look hallucinated (contain placeholder domain)
    const safeText = (v: string | null | undefined) => {
      const s = clean(v);
      if (s.includes("example.com") || s.includes("placeholder.com")) return "";
      return s;
    };

    return NextResponse.json({
      status: "success",
      listing_url: safeListingUrl,
      title: safeText(extracted.title) || property_title,
      price: extracted.price || property_price,
      currency: clean(extracted.currency) || "EUR",
      description: safeText(extracted.description),
      full_address: safeText(extracted.full_address),
      locality: safeText(extracted.locality) || property_city,
      bedrooms: extracted.bedrooms,
      bathrooms: extracted.bathrooms,
      total_sqm: extracted.total_sqm,
      floor_number: extracted.floor_number,
      furnished: clean(extracted.furnished),
      features: (extracted.features || []).map(clean).filter(Boolean),
      images: uniqueImages,
      page_screenshot: pageScreenshot,
      carousel_screenshots: carouselScreenshots,
      agent: {
        name:      clean(extracted.agent_name),
        title:     clean(extracted.agent_title),
        phone:     clean(extracted.agent_phone),
        whatsapp:  clean(extracted.agent_whatsapp),
        email:     clean(extracted.agent_email),
      },
      agency: {
        name:    clean(extracted.agency_name),
        phone:   clean(extracted.agency_phone),
        email:   clean(extracted.agency_email),
        website: agency_url,
      },
    });
  } catch (err: unknown) {
    try { if (stagehand) await stagehand.close(); } catch { /**/ }
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack  : "";
    console.error("[property-details] FATAL ERROR:", message);
    console.error("[property-details] STACK:", stack);
    return NextResponse.json({ error: "Property details fetch failed", detail: message }, { status: 500 });
  }
}
