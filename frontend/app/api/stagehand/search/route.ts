export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/stagehand/search
 *
 * Legacy city-wide discovery route — kept for compatibility.
 * Uses Stagehand agent() + structured output to find and scrape agency listings.
 *
 * Body: { city, country, property_type?, category?, max_agencies?, specific_url? }
 */

import { NextRequest, NextResponse } from "next/server";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

// ── Schemas ────────────────────────────────────────────────────────────────

const PropertyItem = z.object({
  title: z
    .string().nullable().optional().default("")
    .describe("Property title or headline as shown on the listing card"),
  property_type: z
    .string().nullable().optional().default("")
    .describe("Type: apartment, villa, house, studio, penthouse, townhouse, bungalow, land, commercial"),
  category: z
    .string().nullable().optional().default("")
    .describe("Either 'sale' or 'rent'"),
  price: z
    .number().nullable().optional()
    .describe("Numeric price only — no currency symbols. E.g. 450000 or 1200"),
  currency: z
    .string().nullable().optional().default("")
    .describe("Currency code: EUR, USD, GBP, AED, etc."),
  bedrooms: z
    .number().nullable().optional()
    .describe("Number of bedrooms as an integer"),
  bathrooms: z
    .number().nullable().optional()
    .describe("Number of bathrooms as an integer"),
  total_sqm: z
    .number().nullable().optional()
    .describe("Total floor area in square metres as a number"),
  locality: z
    .string().nullable().optional().default("")
    .describe("Neighbourhood, locality, or suburb name"),
  city: z
    .string().nullable().optional().default("")
    .describe("City name"),
  full_address: z
    .string().nullable().optional().default("")
    .describe("Full street address if shown"),
  description: z
    .string().nullable().optional().default("")
    .describe("Property description or summary text, up to 400 characters"),
  listing_url: z
    .string().url().nullable().optional()
    .describe("DIRECT link to the individual property page — must start with https://"),
  images: z
    .array(z.string().url()).nullable().optional().default([])
    .describe("Full https:// URLs of property photos. Only real image URLs — no logos."),
  amenities: z
    .array(z.string()).nullable().optional().default([])
    .describe("Features list: pool, garage, garden, lift, AC, parking, balcony, sea view, etc."),
  furnished: z
    .string().nullable().optional().default("")
    .describe("Furnished status: 'yes', 'no', or 'partial'"),
  floor_number: z
    .number().nullable().optional()
    .describe("Which floor the apartment is on (number)"),
  year_built: z
    .number().nullable().optional()
    .describe("Year the property was built (4-digit number)"),
  agent_name: z
    .string().nullable().optional().default("")
    .describe("Name of the individual listing agent if shown"),
  agent_phone: z
    .string().nullable().optional().default("")
    .describe("Agent or agency phone number"),
  agent_email: z
    .string().nullable().optional().default("")
    .describe("Agent or agency email address"),
});

const PropertySchema = z.object({
  properties: z
    .array(PropertyItem).default([])
    .describe("ALL property listings visible on the page. Do not skip any."),
  agency_name: z
    .string().nullable().optional().default("")
    .describe("Name of the real estate agency"),
  agency_phone: z.string().nullable().optional().default(""),
  agency_email: z.string().nullable().optional().default(""),
  agency_whatsapp: z.string().nullable().optional().default(""),
});

// ── Helper ─────────────────────────────────────────────────────────────────

async function createStagehand() {
  const IS_BROWSERBASE = process.env.STAGEHAND_ENV === "BROWSERBASE";
  const openaiKey = process.env.OPENAI_API_KEY || "";

  const stagehand = new Stagehand(
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
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          },
        }
  );

  await stagehand.init();
  return stagehand;
}

// ── Main Route Handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let stagehand: InstanceType<typeof Stagehand> | null = null;

  try {
    const body = await req.json();
    const {
      city = "",
      country = "",
      property_type = "any",
      category = "any",
      specific_url = "",
    } = body;

    if (!city && !country && !specific_url) {
      return NextResponse.json(
        { error: "Provide city + country or a specific_url" },
        { status: 400 }
      );
    }

    const targetUrl = specific_url || `https://www.google.com/search?q=real+estate+agency+${encodeURIComponent(city + " " + country)}+property+listings`;

    stagehand = await createStagehand();

    // v3 correct API: context.pages()[0]
    const page = stagehand.context.pages()[0];
    if (!page) throw new Error("No active page after Stagehand init");

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(2000);

    // Build filter string for agent instructions
    const filterParts: string[] = [];
    if (category && category !== "any") filterParts.push(`for ${category === "rent" ? "RENT" : "SALE"}`);
    if (property_type && property_type !== "any") filterParts.push(`property type: ${property_type}`);
    if (city) filterParts.push(`in ${city}${country ? ", " + country : ""}`);
    const filterStr = filterParts.length > 0 ? filterParts.join(", ") : "any properties";

    const agent = stagehand.agent({
      model: "openai/gpt-4o-mini",
      systemPrompt:
        "You are a real estate data extraction agent. " +
        "Your ONLY job is to extract property listings from real estate websites. " +
        "Do NOT navigate to external websites. " +
        "Do NOT click on individual property pages — stay on the listings/search results page. " +
        "When done extracting, return the structured data.",
    });

    const agentInstruction =
      specific_url
        ? `You are on a real estate listings page at ${targetUrl}. ` +
          `\n\nExtract ALL property listings matching: ${filterStr}` +
          `\n\nFor each property get: title, type (apartment/villa/house/studio/penthouse/bungalow), ` +
          `category (sale/rent), price (number only), currency, bedrooms, bathrooms, area in sqm, ` +
          `full address, locality, city, description (up to 400 chars), DIRECT listing URL, ` +
          `image URLs (https://...), amenities, furnished status, floor number, year built, ` +
          `agent name/phone/email. Also extract agency name, phone, email.`
        : `You are on a Google search results page. ` +
          `\n\nFind a real estate agency website for ${city}, ${country}, click into it, ` +
          `navigate to their property listings, then extract ALL listings matching: ${filterStr}. ` +
          `Get full details for each: title, type, price (number), currency, bedrooms, bathrooms, ` +
          `sqm, address, locality, description, listing URL, image URLs, amenities, furnished, ` +
          `floor, year built, agent contact. Also return agency name, phone, email.`;

    let extractedProperties: z.infer<typeof PropertyItem>[] = [];
    let agencyName = "";
    let agencyPhone = "";
    let agencyEmail = "";
    let agencyWhatsapp = "";

    try {
      const agentResult = await agent.execute({
        instruction: agentInstruction,
        maxSteps: 25,
        output: PropertySchema,
      });

      const agentOutput = agentResult.output as z.infer<typeof PropertySchema> | undefined;
      if (agentOutput?.properties && agentOutput.properties.length > 0) {
        extractedProperties = agentOutput.properties;
        agencyName = agentOutput.agency_name || "";
        agencyPhone = agentOutput.agency_phone || "";
        agencyEmail = agentOutput.agency_email || "";
        agencyWhatsapp = agentOutput.agency_whatsapp || "";
      } else {
        // Fallback: plain extract() on whatever page we're on
        const extracted = await stagehand.extract(
          "Extract ALL property listings visible on this page with every available detail.",
          PropertySchema,
          { serverCache: false }
        );
        extractedProperties = extracted.properties || [];
        agencyName = extracted.agency_name || "";
        agencyPhone = extracted.agency_phone || "";
        agencyEmail = extracted.agency_email || "";
        agencyWhatsapp = extracted.agency_whatsapp || "";
      }
    } catch (agentErr) {
      console.warn("Agent failed, falling back to extract():", agentErr);
      try {
        const extracted = await stagehand.extract(
          "Extract ALL property listings visible on this page with every available detail.",
          PropertySchema,
          { serverCache: false }
        );
        extractedProperties = extracted.properties || [];
        agencyName = extracted.agency_name || "";
        agencyPhone = extracted.agency_phone || "";
        agencyEmail = extracted.agency_email || "";
      } catch (extractErr) {
        console.error("Extract fallback also failed:", extractErr);
      }
    }

    await stagehand.close();
    stagehand = null;

    // Fix relative listing URLs
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

      return {
        title: p.title || "",
        property_type: p.property_type || "",
        category: p.category || (category !== "any" ? category : ""),
        price: p.price ?? null,
        currency: p.currency || "EUR",
        bedrooms: p.bedrooms ?? null,
        bathrooms: p.bathrooms ?? null,
        total_sqm: p.total_sqm ?? null,
        locality: p.locality || "",
        city: p.city || city,
        country,
        full_address: p.full_address || "",
        description: (p.description || "").slice(0, 400),
        listing_url: listingUrl,
        images: (p.images || []).filter((u): u is string => !!u && u.startsWith("http")).slice(0, 5),
        amenities: (p.amenities || []).slice(0, 15),
        furnished: p.furnished || "",
        floor_number: p.floor_number ?? null,
        year_built: p.year_built ?? null,
        agency_name: agencyName || "",
        agency_phone: p.agent_phone || agencyPhone || "",
        agency_email: p.agent_email || agencyEmail || "",
        agent_name: p.agent_name || "",
        source_url: targetUrl,
      };
    });

    return NextResponse.json({
      success: true,
      city,
      country,
      property_type,
      category,
      agencies_scraped: 1,
      agencies: [{ name: agencyName, website: baseUrl }],
      properties_found: properties.length,
      properties: properties.slice(0, 50),
      agency: {
        name: agencyName,
        phone: agencyPhone,
        email: agencyEmail,
        whatsapp: agencyWhatsapp,
        website: specific_url || baseUrl,
      },
    });
  } catch (err: unknown) {
    try {
      if (stagehand) await stagehand.close();
    } catch { /* ignore */ }

    const message = err instanceof Error ? err.message : String(err);
    console.error("Stagehand search error:", message);

    return NextResponse.json(
      { error: "Scraping failed", detail: message },
      { status: 500 }
    );
  }
}
