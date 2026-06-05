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
              args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--single-process", "--disable-setuid-sandbox"],
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

    // Capture images from DOM — try all lazy-load attributes
    let domImages: string[] = [];
    try {
      domImages = (await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return imgs
          .map((img) => {
            const el = img as HTMLImageElement & { dataset: DOMStringMap };
            // Try every common lazy-load src attribute in priority order
            return (
              el.dataset?.lazySrc ||
              el.dataset?.original ||
              el.dataset?.src ||
              el.dataset?.fullSrc ||
              el.getAttribute("data-lazy") ||
              el.getAttribute("data-image") ||
              el.src ||
              ""
            );
          })
          .filter(
            (src) =>
              src.startsWith("http") &&
              !src.includes("logo") &&
              !src.includes("icon") &&
              !src.includes(".svg") &&
              !src.includes("placeholder") &&
              !src.includes("flag") &&
              !src.includes("avatar") &&
              !src.includes("spinner") &&
              !src.includes("blank.gif") &&
              !src.includes("pixel")
          );
      })) as string[];
      domImages = [...new Set(domImages)].slice(0, 15);
    } catch { /* ignore */ }

    // ── Screenshot carousel/gallery images from the property detail page ─────
    // Strategy:
    // 1. Screenshot the first/hero gallery image
    // 2. Click the carousel "next" arrow up to 9 more times, screenshot each slide
    // 3. Also scrape img src URLs directly from DOM (for non-screenshot fallback)
    let carouselScreenshots: string[] = [];
    let pageScreenshot = "";

    // Helper: screenshot the largest visible image on screen
    const screenshotHeroImage = async (): Promise<string> => {
      try {
        const box = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
          let best: { x: number; y: number; w: number; h: number } | null = null;
          let bestArea = 0;
          for (const img of imgs) {
            const r = img.getBoundingClientRect();
            const src = img.src || (img as HTMLImageElement & {dataset: DOMStringMap}).dataset?.src || "";
            if (r.width < 200 || r.height < 150) continue;
            if (src.includes("logo") || src.includes("icon") || src.includes("avatar") ||
                src.includes("flag") || src.includes("placeholder") || src.includes(".svg")) continue;
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              best = { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
            }
          }
          return best;
        }) as { x: number; y: number; w: number; h: number } | null;

        if (box && box.w > 0 && box.h > 0) {
          const buf = await page.screenshot({
            type: "jpeg", quality: 82,
            clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.w, height: box.h },
          });
          return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
        }
      } catch { /* ignore */ }
      return "";
    };

    try {
      await page.evaluate(() => window.scrollTo(0, 0));
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

        // Try DOM-based click first (faster, no LLM)
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

        // Fallback: stagehand.act() with natural language
        if (!clicked) {
          try {
            await stagehand.act(
              "click the next arrow or right chevron button in the property photo gallery or image slider"
            );
            clicked = true;
          } catch { break; } // no more arrows → stop
        }

        if (!clicked) break;

        await page.waitForTimeout(600);
        const shot = await screenshotHeroImage();
        if (!shot || shot === carouselScreenshots[carouselScreenshots.length - 1]) break; // duplicate = end
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
  These are the large gallery/slider images on THIS individual property page.
  DO NOT include: thumbnails from other listings, logos, icons, agent photos, map images, or any image from a different property.
  Only include images that show THIS specific property's rooms, exterior, or views.

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
- listing_url (the URL of this specific property page)

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

    // Merge DOM images with AI-extracted images, filter fakes
    const isFakeImg = (u: string) =>
      !u || u.includes("example.com") || u.includes("placeholder") || u.includes("logo") || u.includes("icon");

    const allImages = [
      ...(extracted.images || []),
      ...domImages,
    ].filter((src) => src && src.startsWith("http") && !isFakeImg(src));
    const uniqueImages = [...new Set(allImages)].slice(0, 15);

    return NextResponse.json({
      status: "success",
      listing_url: currentUrl !== agency_url ? currentUrl : clean(extracted.listing_url),
      title: clean(extracted.title) || property_title,
      price: extracted.price || property_price,
      currency: clean(extracted.currency) || "EUR",
      description: clean(extracted.description),
      full_address: clean(extracted.full_address),
      locality: clean(extracted.locality) || property_city,
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
    return NextResponse.json({ error: "Property details fetch failed", detail: message }, { status: 500 });
  }
}
