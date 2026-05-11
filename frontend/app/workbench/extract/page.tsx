"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { MaltaAgenciesPanel } from "@/components/MaltaAgenciesPanel";
import {
  workbenchFetchUrls,
  workbenchMatchReferenceUrls,
  workbenchQualifyPropertyUrls,
  type WorkbenchUrlBuckets,
} from "@/lib/api";

const API = "";

type DiscoveredRow = {
  url: string;
  reference?: string | null;
  preview?: string | null;
  signals?: Record<string, boolean>;
};

/** Flatten classified buckets into one ordered list (property/listing URLs first). */
function bucketsToDiscovered(groups: WorkbenchUrlBuckets): DiscoveredRow[] {
  const seen = new Set<string>();
  const out: DiscoveredRow[] = [];
  const order: (keyof WorkbenchUrlBuckets)[] = [
    "property_pages",
    "listing_pages",
    "about_pages",
    "contact_pages",
    "other_pages",
  ];
  for (const key of order) {
    for (const e of groups[key]) {
      const u = e.url?.trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({
        url: u,
        reference: null,
        preview: e.text ?? null,
      });
    }
  }
  return out;
}

type ColDef = {
  key: string;
  label: string;
  type: string;
};

// ─── EXACT COLUMNS REQUIRED ───
const COLUMNS: ColDef[] = [
  { key: "main_image", label: "Image", type: "image" },
  { key: "reference_number", label: "Ref", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "property_type", label: "Type", type: "badge" },
  { key: "status", label: "Status", type: "status" },
  { key: "bedrooms", label: "Beds", type: "number" },
  { key: "bathrooms", label: "Baths", type: "number" },
  { key: "internal_sqm", label: "Int. m²", type: "number" },
  { key: "locality", label: "Locality", type: "text" },
  { key: "badge", label: "Badge", type: "badge" },
  { key: "listing_url", label: "Open", type: "link" },
  { key: "listing_url_full", label: "Full Listing URL", type: "url" },
  { key: "agent_name", label: "Agent Name", type: "text" },
  { key: "agent_phone", label: "Agent Phone", type: "text" },
  { key: "agent_email", label: "Agent Email", type: "text" },
  { key: "has_airconditioning", label: "Air Conditioning", type: "bool" },
  { key: "balconies", label: "Balconies", type: "text" },
  { key: "kitchens", label: "Kitchen", type: "number" },
  { key: "living_rooms", label: "Living Room", type: "number" },
  { key: "dining_rooms", label: "Dining Room", type: "number" },
  { key: "sitting_room", label: "Sitting Room", type: "number" },
  { key: "hallway", label: "Hallway", type: "number" },
  { key: "laundry", label: "Laundry", type: "text" },
  { key: "garage", label: "Garage", type: "text" },
  { key: "garage_capacity", label: "Garage Capacity", type: "number" },
  { key: "yard", label: "Yard", type: "text" },
  { key: "roof", label: "Roof", type: "text" },
  { key: "terrace", label: "Terrace", type: "text" },
  { key: "floor_number", label: "Floor No.", type: "number" },
  { key: "heating", label: "Heating", type: "text" },
  { key: "has_lift", label: "Lift", type: "bool" },
  { key: "has_pool", label: "Swimming Pool", type: "bool" },
  { key: "dining_room_dims", label: "Dining Room Dimensions", type: "text" },
  { key: "living_room_dims", label: "Living Room Dimensions", type: "text" },
  { key: "kitchen_dims", label: "Kitchen Dimensions", type: "text" },
  { key: "bedroom_dims", label: "Bedroom Dimensions", type: "dims" },
  { key: "total_sqm", label: "Total m²", type: "number" },
  { key: "floor_level", label: "Floor Level", type: "text" },
  { key: "furnished", label: "Furnished", type: "text" },
  { key: "price_text", label: "Price", type: "text" },
  { key: "category", label: "Category", type: "badge" },
];

/** Merge nested LLM shapes ({ data: {...} }) so normalizeProperty sees flat fields. */
function coerceExtractPayload(raw: Record<string, unknown>): Record<string, unknown> {
  let acc: Record<string, unknown> = {};
  const nestKeys = [
    "data",
    "property",
    "extracted",
    "listing",
    "details",
    "property_data",
    "home_details",
    "additional_details",
    "result",
  ];
  for (const nk of nestKeys) {
    const v = raw[nk];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      acc = { ...acc, ...(v as Record<string, unknown>) };
    }
  }
  return { ...acc, ...raw };
}

/** True when API returned only { error, listing_url } with no extractable fields. */
function isEmptyFailurePayload(r: Record<string, unknown>): boolean {
  const err = r.error;
  if (err === undefined || err === null || String(err).trim() === "") return false;
  const keys = [
    "title",
    "reference_number",
    "reference",
    "price",
    "bedrooms",
    "bathrooms",
    "internal_sqm",
    "total_sqm",
    "description",
    "property_type",
    "locality",
  ];
  const anyVal = keys.some((k) => r[k] != null && String(r[k]).trim() !== "");
  return !anyVal;
}

function normalizeProperty(raw: Record<string, unknown>, url: string): Record<string, unknown> {
  let details: Record<string, unknown> = {};
  if (typeof raw.home_details === "object" && raw.home_details !== null) {
    details = { ...details, ...(raw.home_details as Record<string, unknown>) };
  }
  if (typeof raw.additional_details === "object" && raw.additional_details !== null) {
    details = { ...details, ...(raw.additional_details as Record<string, unknown>) };
  }

  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
      const normK = k.toLowerCase().replace(/[_\s]/g, "");
      for (const [dk, dv] of Object.entries(details)) {
        if (dk.toLowerCase().replace(/[_\s]/g, "") === normK) return dv;
      }
    }
    return null;
  };

  let bedroomDims: string | Record<string, unknown> = "";
  const bd = raw.bedroom_dims ?? raw.bedroom_dimensions;
  if (bd && typeof bd === "object" && !Array.isArray(bd)) {
    bedroomDims = Object.entries(bd as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
  } else if (typeof bd === "string") {
    bedroomDims = bd;
  }

  const imgsRaw = raw.all_images ?? raw.images ?? raw.photos ?? raw.image_urls;
  const imgs = Array.isArray(imgsRaw)
    ? (imgsRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  return {
    main_image: imgs[0] ?? null,
    all_images: imgs,
    reference_number: get("reference_number", "reference", "ref", "listing_reference"),
    title: get("title", "name", "property_title"),
    property_type: get("property_type", "type"),
    status: get("status"),
    badge: get("badge"),
    category: get("category"),
    price: get("price", "asking_price", "price_eur", "sale_price"),
    price_text: get("price_text"),
    currency: get("currency") || "EUR",
    bedrooms: get("bedrooms", "no_of_bedrooms", "No of Bedrooms"),
    bathrooms: get("bathrooms", "no_of_bathrooms", "No of Bathrooms"),
    internal_sqm: get("internal_sqm", "internal_area", "area_internal"),
    total_sqm: get("total_sqm", "total_area", "built_area"),
    external_sqm: get("external_sqm"),
    locality: get("locality"),
    town: get("town"),
    region: get("region", "town", "locality"),
    country: get("country"),
    full_address: get("full_address"),
    floor_number: get("floor_number", "floor_no", "Floor No"),
    floor_level: get("floor_level", "floor_number"),
    year_built: get("year_built"),
    furnished: get("furnished", "is_furnished"),
    has_airconditioning: get("has_airconditioning", "airconditioning", "Airconditioning"),
    has_lift: get("has_lift", "lift", "Lift"),
    has_pool: get("has_pool", "swimming_pool", "Swimming Pool"),
    living_rooms: get("living_rooms", "Living Rooms"),
    kitchens: get("kitchens", "Kitchens"),
    dining_rooms: get("dining_rooms", "Dining Rooms"),
    sitting_room: get("sitting_room", "Sitting Room"),
    hallway: get("hallway", "Hallway"),
    laundry: get("laundry", "Laundry"),
    garage: get("garage", "Garage"),
    garage_capacity: get("garage_capacity", "Garage Capacity"),
    yard: get("yard", "Yard"),
    roof: get("roof", "Roof"),
    terrace: get("terrace", "terraces", "Terraces"),
    balconies: get("balconies", "balconies_front", "Balconies (Front)"),
    heating: get("heating", "Heating"),
    bedroom_dims: bedroomDims || get("bedroom_dims", "Bedroom 1 Dims"),
    living_room_dims: get("living_room_dims", "Living Room Dims"),
    kitchen_dims: get("kitchen_dims", "Kitchen Dims"),
    dining_room_dims: get("dining_room_dims", "Dining Room Dims"),
    agent_name: get("agent_name"),
    agent_phone: get("agent_phone"),
    agent_email: get("agent_email"),
    agency_name: get("agency_name"),
    listing_url: url,
    listing_url_full: url,
    description: get("description"),
    amenities: raw.amenities || [],
    features: raw.features || [],
  };
}

/** True when a table cell should be considered empty for deep-merge fill. */
const ZERO_IS_EMPTY_KEYS = new Set([
  "price",
  "bedrooms",
  "bathrooms",
  "internal_sqm",
  "total_sqm",
  "kitchens",
  "living_rooms",
  "dining_rooms",
  "floor_number",
]);

function isDeepMergeEmpty(v: unknown, key?: string): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "" || s === "-" || s === "—" || s === "n/a" || s === "na" || s === "null" || s === "none";
  }
  if (typeof v === "number") {
    if (Number.isNaN(v)) return true;
    if (key && ZERO_IS_EMPTY_KEYS.has(key) && v <= 0) return true;
    return false;
  }
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function mergeExtractedFillEmpty(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(incoming)) {
    if (isDeepMergeEmpty(out[key], key) && !isDeepMergeEmpty(val, key)) {
      out[key] = val;
    }
  }
  return out;
}

/** For exact listing page deep extraction, prefer incoming non-empty values. */
function mergeExtractedPreferIncoming(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(incoming)) {
    if (!isDeepMergeEmpty(val, key)) {
      out[key] = val;
    }
  }
  return out;
}

/** Crawl pool URLs whose path/query contains the property reference (case-insensitive). */
function urlsMatchingReference(ref: string, pool: string[]): string[] {
  const r = String(ref ?? "").trim();
  if (!r || !pool.length) return [];
  const low = r.toLowerCase();
  const hyphenated = r.replace(/\s+/g, "-").toLowerCase();
  const hits = pool.filter((u) => {
    const ul = u.toLowerCase();
    return ul.includes(low) || ul.includes(hyphenated) || u.includes(encodeURIComponent(r));
  });
  const uniq = [...new Set(hits)];
  uniq.sort((a, b) => {
    const pri = (u: string) => {
      const s = u.toLowerCase();
      if (s.includes("/property/") || s.includes("/listing/") || s.includes("listing-page")) return 0;
      if (s.includes("reference=") || s.includes("ref=")) return 1;
      return 2;
    };
    return pri(a) - pri(b);
  });
  return uniq.slice(0, 12);
}

function rowHasAnyEmptyColumn(row: Record<string, unknown>): boolean {
  return COLUMNS.some((c) => isDeepMergeEmpty(row[c.key], c.key));
}

async function fetchBestExtractForUrl(url: string): Promise<Record<string, unknown> | null> {
  const scoreRow = (row: Record<string, unknown> | null | undefined): number => {
    if (!row) return 0;
    const keys: string[] = [
      "reference_number",
      "title",
      "property_type",
      "price_text",
      "price",
      "bedrooms",
      "bathrooms",
      "internal_sqm",
      "total_sqm",
      "locality",
      "agent_name",
      "agent_phone",
      "agent_email",
      "kitchens",
      "living_rooms",
      "dining_rooms",
      "has_airconditioning",
      "has_lift",
      "has_pool",
      "category",
      "listing_url",
      "main_image",
    ];
    let s = 0;
    for (const k of keys) {
      const v = row[k];
      if (!isDeepMergeEmpty(v, k)) s += 1;
    }
    return s;
  };

  let best: Record<string, unknown> | null = null;
  let bestScore = 0;

  // Same approach as main Workbench extract pipeline: /extract (smart scrape + comprehensive LLM)
  try {
    const res = await fetch(`${API}/api/workbench/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url] }),
    });
    const data = await res.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (res.ok && first && first.success && first.data && typeof first.data === "object") {
      const cand = first.data as Record<string, unknown>;
      best = cand;
      bestScore = scoreRow(cand);
    }
  } catch {
    // fallback below
  }

  // Also query universal single extractor endpoint; pick richer payload.
  try {
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), 120_000);
    const res = await fetch(`${API}/api/workbench/extract-single`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    window.clearTimeout(t);
    const data = await res.json();
    if (res.ok && data.result && typeof data.result === "object") {
      const cand = data.result as Record<string, unknown>;
      const sc = scoreRow(cand);
      if (sc >= bestScore) {
        best = cand;
        bestScore = sc;
      }
    }
  } catch {
    // no-op
  }
  return best;
}

export default function ExtractPage() {
  const [listingUrl, setListingUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredRow[]>([]);
  /** How many discovered properties to run detail extraction on (first N in list). */
  const [propertiesToExtract, setPropertiesToExtract] = useState(1);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  /** Extraction-only errors (kept separate from Step 1 discovery errors). */
  const [extractErr, setExtractErr] = useState("");
  /** Playwright HTML pages opened during site crawl + stats */
  const [crawlInfo, setCrawlInfo] = useState<{
    pagesVisited: number;
    cap: number;
    uniqueUrls: number;
  } | null>(null);
  /** Cap pages to visit (each page = Playwright navigation). Lower = faster finish. */
  const [maxCrawlPages, setMaxCrawlPages] = useState(120);
  const [qualifying, setQualifying] = useState(false);
  const [requireAgentOnFilter, setRequireAgentOnFilter] = useState(false);
  const [qualifyFilterStats, setQualifyFilterStats] = useState<{ before: number; after: number } | null>(null);
  /** Every internal URL from last crawl (for deep extract: find pages mentioning a ref). */
  const [allCrawlUrls, setAllCrawlUrls] = useState<string[]>([]);
  const [selectedResultIndices, setSelectedResultIndices] = useState<Set<number>>(new Set());
  const [deepExtracting, setDeepExtracting] = useState(false);
  const resultsRef = useRef<Record<string, unknown>[]>([]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const pct = useMemo(
    () => (progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0),
    [progress.done, progress.total],
  );

  const handleDiscover = async () => {
    if (!listingUrl.trim()) return;
    setDiscovering(true);
    setError("");
    setDiscovered([]);
    setAllCrawlUrls([]);
    setSelectedResultIndices(new Set());
    setCrawlInfo(null);
    setQualifyFilterStats(null);
    setResults([]);
    try {
      const data = await workbenchFetchUrls(
        listingUrl.trim(),
        Math.min(800, Math.max(1, Math.floor(maxCrawlPages) || 120)),
      );
      if (data.error) {
        setError(data.error);
        return;
      }
      const props = bucketsToDiscovered(data.groups);
      const uniq = data.all_urls?.length ?? data.total_urls ?? props.length;
      const pv = data.pages_visited ?? 0;
      const cap = data.crawl_max_pages ?? 400;
      setCrawlInfo({
        pagesVisited: pv,
        cap,
        uniqueUrls: uniq,
      });
      if (data.warning && props.length === 0) {
        setError(data.warning);
        return;
      }
      if (!props.length) {
        setError("No internal URLs found on this domain.");
        return;
      }
      setDiscovered(props);
      const pool = new Set<string>();
      for (const u of data.all_urls ?? []) {
        if (typeof u === "string" && u.trim()) pool.add(u.trim());
      }
      for (const p of props) {
        if (p.url?.trim()) pool.add(p.url.trim());
      }
      setAllCrawlUrls([...pool]);
      setPropertiesToExtract(props.length > 0 ? props.length : 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const timedOut =
        msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("exceeded");
      setError(
        timedOut
          ? "Request timed out before the crawl finished. Lower “Max pages” (e.g. 40–80), or ensure the API keeps running (uvicorn on :8000)."
          : `Discovery failed: ${msg}`,
      );
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (!discovered.length) return;
    setPropertiesToExtract((prev) => Math.min(Math.max(1, prev), discovered.length));
  }, [discovered]);

  const handleQualifyFilter = useCallback(async () => {
    if (!discovered.length) return;
    const urls = discovered.map((p) => p.url).filter(Boolean);
    setQualifying(true);
    setError("");
    try {
      const before = urls.length;
      const res = await workbenchQualifyPropertyUrls(urls, {
        require_agent: requireAgentOnFilter,
        concurrency: 6,
      });
      const rows: DiscoveredRow[] = (res.qualified || []).map((q) => ({
        url: q.url,
        reference: q.reference ?? null,
        preview: q.preview ?? null,
        signals: q.signals,
      }));
      if (!rows.length) {
        setError(
          `No URLs passed the HTML check (${res.rejected_total} rejected). Try turning off “Require agent text”, or crawl property-detail URLs.`,
        );
        setQualifyFilterStats({ before, after: 0 });
        return;
      }
      setDiscovered(rows);
      setQualifyFilterStats({ before, after: rows.length });
      setPropertiesToExtract(rows.length);
    } catch (e: unknown) {
      setError(`Filter failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQualifying(false);
    }
  }, [discovered, requireAgentOnFilter]);

  const handleExtract = useCallback(async () => {
    const n = Math.min(Math.max(1, propertiesToExtract), discovered.length);
    const urls = discovered
      .slice(0, n)
      .map((p) => p.url)
      .filter(Boolean);
    if (!urls.length) return;

    setExtracting(true);
    setResults([]);
    setSelectedResultIndices(new Set());
    setProgress({ done: 0, total: urls.length, current: "" });
    setExtractErr("");

    const extracted: Record<string, unknown>[] = [];
    const seenRefs = new Set<string>();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      setProgress({
        done: i,
        total: urls.length,
        current: url.split("/").pop() || url,
      });

      try {
        const controller = new AbortController();
        const t = window.setTimeout(() => controller.abort(), 120_000);
        const res = await fetch(`${API}/api/workbench/extract-single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        window.clearTimeout(t);
        const data = await res.json();

        if (!res.ok) {
          const msg =
            (typeof data.detail === "string" && data.detail) ||
            (Array.isArray(data.detail) ? JSON.stringify(data.detail) : null) ||
            data.message ||
            res.statusText;
          setExtractErr((prev) => (prev ? `${prev}\n${url}: ${msg}` : `${url}: ${msg}`));
          continue;
        }

        if (data.result && typeof data.result === "object") {
          const r = coerceExtractPayload(data.result as Record<string, unknown>);
          if (isEmptyFailurePayload(r)) {
            setExtractErr((prev) =>
              prev
                ? `${prev}\n${url}: ${String(r.error)}`
                : `${url}: ${String(r.error ?? "Unknown error")}`,
            );
          } else {
            const ref = String(r.reference_number ?? r.reference ?? url);
            if (!seenRefs.has(ref)) {
              seenRefs.add(ref);
              extracted.push(normalizeProperty(r, url));
              setResults([...extracted]);
            }
          }
        } else if (data.error) {
          console.error(`Failed: ${url}`, data.error);
          setExtractErr((prev) => (prev ? `${prev}\n${url}: ${data.error}` : `${url}: ${data.error}`));
        }
      } catch (e) {
        console.error(`Failed: ${url}`, e);
        setExtractErr((prev) =>
          prev
            ? `${prev}\n${url}: ${e instanceof Error ? e.message : String(e)}`
            : `${url}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      setProgress({
        done: i + 1,
        total: urls.length,
        current: url.split("/").pop() || url,
      });
    }

    setProgress({
      done: urls.length,
      total: urls.length,
      current: "Complete!",
    });
    setExtracting(false);
  }, [discovered, propertiesToExtract]);

  const toggleResultRowSelected = useCallback((idx: number) => {
    setSelectedResultIndices((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }, []);

  const toggleSelectAllResults = useCallback(() => {
    setSelectedResultIndices((prev) => {
      if (prev.size === results.length) return new Set();
      return new Set(results.map((_, i) => i));
    });
  }, [results]);

  const handleDeepExtract = useCallback(async () => {
    const idxs = [...selectedResultIndices].sort((a, b) => a - b);
    if (!idxs.length) {
      setExtractErr("Select at least one row (checkbox), then run deep extract.");
      return;
    }
    const pool =
      allCrawlUrls.length > 0 ? allCrawlUrls : discovered.map((d) => d.url).filter(Boolean);
    if (!pool.length) {
      setExtractErr("No crawl URL pool — run Step 1 crawl first so we can find pages by reference.");
      return;
    }

    setDeepExtracting(true);
    setExtractErr("");
    setProgress({ done: 0, total: idxs.length, current: "Deep extract…" });

    let step = 0;
    let updatedRows = 0;
    for (const idx of idxs) {
      const baseRow = resultsRef.current[idx];
      if (!baseRow) {
        step += 1;
        continue;
      }
      const ref = String(baseRow.reference_number ?? baseRow.reference ?? "").trim();
      setProgress({
        done: step,
        total: idxs.length,
        current: ref ? `Deep: ${ref}` : `Deep: row ${idx + 1}`,
      });

      if (!ref) {
        setExtractErr((p) =>
          p ? `${p}\nRow ${idx + 1}: missing reference_number` : `Row ${idx + 1}: missing reference_number`,
        );
        step += 1;
        continue;
      }

      let targets = urlsMatchingReference(ref, pool);
      if (!targets.length) {
        try {
          const matched = await workbenchMatchReferenceUrls({
            reference: ref,
            urls: pool,
            max_scan: 600,
            max_matches: 20,
            concurrency: 6,
          });
          targets = matched.matched.map((m) => m.url).filter(Boolean);
        } catch {
          /* ignore and continue with empty targets */
        }
      }
      const primary = String(baseRow.listing_url ?? baseRow.listing_url_full ?? "").trim();
      if (primary && !targets.includes(primary)) {
        targets = [primary, ...targets];
      }
      targets = [...new Set(targets)].slice(0, 10);

      if (!targets.length) {
        setExtractErr((p) =>
          p
            ? `${p}\n${ref}: no crawl URL contains this reference`
            : `${ref}: no crawl URL contains this reference`,
        );
        step += 1;
        continue;
      }

      let merged: Record<string, unknown> = { ...baseRow };
      const beforeSnapshot = JSON.stringify(baseRow);
      // Force exact listing URL extraction first (requested behavior).
      if (primary) {
        try {
          const best = await fetchBestExtractForUrl(primary);
          if (best && typeof best === "object") {
            const r = coerceExtractPayload(best);
            if (!isEmptyFailurePayload(r)) {
              const norm = normalizeProperty(r, primary);
              merged = mergeExtractedPreferIncoming(merged, norm);
            }
          }
        } catch {
          /* continue with fallback URLs */
        }
      }
      for (const url of targets) {
        if (!rowHasAnyEmptyColumn(merged)) break;
        try {
          const best = await fetchBestExtractForUrl(url);
          if (best && typeof best === "object") {
            const r = coerceExtractPayload(best);
            if (!isEmptyFailurePayload(r)) {
              const norm = normalizeProperty(r, url);
              merged = mergeExtractedFillEmpty(merged, norm);
            }
          }
        } catch {
          /* try next URL */
        }
      }

      setResults((prev) => {
        const next = [...prev];
        if (next[idx]) {
          next[idx] = merged;
          resultsRef.current = next;
        }
        return next;
      });
      if (JSON.stringify(merged) !== beforeSnapshot) updatedRows += 1;
      step += 1;
      setProgress({ done: step, total: idxs.length, current: ref ? `Done: ${ref}` : `Done row ${idx + 1}` });
    }

    setProgress({ done: idxs.length, total: idxs.length, current: "Deep extract complete" });
    if (updatedRows === 0) {
      setExtractErr((p) =>
        p
          ? `${p}\nDeep extract completed but no empty cells were filled.`
          : "Deep extract completed but no empty cells were filled.",
      );
    }
    setDeepExtracting(false);
  }, [selectedResultIndices, allCrawlUrls, discovered]);

  const exportExcel = () => {
    if (!results.length) return;

    const headers = COLUMNS.map((c) => c.label);
    const rows = results.map((row) =>
      COLUMNS.map((col) => {
        const val = row[col.key];
        if (val === null || val === undefined) return "";
        if (typeof val === "boolean") return val ? "Yes" : "No";
        if (Array.isArray(val)) return val.join("; ");
        return String(val);
      }),
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = COLUMNS.map((c) => ({
      wch: Math.min(Math.max(c.label.length + 2, 10), 40),
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Properties");

    const imgRows = results
      .filter((r) => Array.isArray(r.all_images) && (r.all_images as unknown[]).length)
      .map((r) => {
        const imgs = r.all_images as string[];
        const row: Record<string, string> = {
          ref: String(r.reference_number ?? ""),
          title: String(r.title ?? ""),
        };
        imgs.forEach((u, i) => {
          row[`image_${i + 1}`] = u;
        });
        return row;
      });
    if (imgRows.length) {
      const wsImg = XLSX.utils.json_to_sheet(imgRows);
      XLSX.utils.book_append_sheet(wb, wsImg, "Images");
    }

    XLSX.writeFile(wb, `properties_${Date.now()}.xlsx`);
  };

  const exportCSV = () => {
    if (!results.length) return;
    const headers = COLUMNS.map((c) => c.label).join(",");
    const rows = results
      .map((row) =>
        COLUMNS.map((col) => {
          const val = row[col.key];
          if (val === null || val === undefined) return "";
          if (typeof val === "boolean") return val ? "Yes" : "No";
          const str = String(val).replace(/"/g, '""');
          return str.includes(",") ? `"${str}"` : str;
        }).join(","),
      )
      .join("\n");

    const blob = new Blob([headers + "\n" + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `properties_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `properties_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const renderCell = (col: ColDef, row: Record<string, unknown>) => {
    const val = row[col.key];

    if (col.type === "image") {
      const src = typeof val === "string" ? val : "";
      return src ? (
        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-[#1a2744]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          {Array.isArray(row.all_images) && (row.all_images as unknown[]).length > 1 && (
            <span className="absolute right-0 bottom-0 bg-black/70 px-1 text-[9px] text-white">
              📷{(row.all_images as unknown[]).length}
            </span>
          )}
        </div>
      ) : (
        <div className="flex h-12 w-16 items-center justify-center rounded bg-[#1a2744] text-xs text-gray-600">
          —
        </div>
      );
    }

    if (col.type === "link") {
      return val ? (
        <a
          href={String(val)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-blue-400 underline hover:text-blue-300"
        >
          Open ↗
        </a>
      ) : (
        <span className="text-gray-600">—</span>
      );
    }

    if (col.type === "url") {
      return val ? (
        <span className="block max-w-[120px] truncate text-xs text-gray-400" title={String(val)}>
          {String(val)}
        </span>
      ) : (
        <span className="text-gray-600">—</span>
      );
    }

    if (col.type === "price") {
      const n = Number(val);
      return val != null && val !== "" && !Number.isNaN(n) ? (
        <span className="text-xs font-semibold text-blue-400">€{n.toLocaleString()}</span>
      ) : (
        <span className="text-gray-600">—</span>
      );
    }

    if (col.type === "bool") {
      if (val === null || val === undefined) return <span className="text-gray-600">—</span>;
      const isYes = val === true || String(val).toLowerCase() === "yes";
      return (
        <span className={`text-xs font-medium ${isYes ? "text-green-400" : "text-red-400"}`}>
          {isYes ? "✓ Yes" : "✗ No"}
        </span>
      );
    }

    if (col.type === "status") {
      if (!val) return <span className="text-gray-600">—</span>;
      const s = String(val).toLowerCase();
      const color = s.includes("market")
        ? "text-green-400 bg-green-400/10"
        : s.includes("sold")
          ? "text-red-400 bg-red-400/10"
          : "text-gray-400 bg-gray-400/10";
      return <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${color}`}>{String(val)}</span>;
    }

    if (col.type === "badge") {
      if (!val) return <span className="text-gray-600">—</span>;
      return (
        <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">{String(val)}</span>
      );
    }

    if (col.type === "dims") {
      if (!val) return <span className="text-gray-600">—</span>;
      return (
        <span className="whitespace-pre-wrap text-xs text-gray-300">
          {typeof val === "object" && val !== null
            ? Object.entries(val as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")
            : String(val)}
        </span>
      );
    }

    if (val === null || val === undefined || val === "") return <span className="text-gray-600">—</span>;
    if (typeof val === "boolean")
      return <span className={val ? "text-green-400" : "text-red-400"}>{val ? "Yes" : "No"}</span>;
    return <span className="text-xs text-gray-300">{String(val)}</span>;
  };

  return (
    <div className="min-h-[calc(100vh-60px)] bg-[#070b14] p-6 text-white">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Link href="/workbench" className="text-sm text-blue-400 hover:text-blue-300">
            ← Workbench
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="mb-1 text-2xl font-bold text-white">🔬 Property Extractor</h1>
          <p className="text-sm text-gray-400">
            Paste an agency website → Playwright crawls internal pages → extract structured data from chosen URLs
          </p>
        </div>

        <MaltaAgenciesPanel />

        <div className="mb-6 rounded-xl border border-white/10 bg-[#0f1728] p-6">
          <h2 className="mb-4 text-sm font-medium tracking-wider text-gray-400 uppercase">
            Step 1 — Agency website (full crawl)
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Same-domain links are opened in Playwright (breadth-first). Each page takes a few seconds — use a lower{" "}
            <strong className="text-slate-400">Max pages</strong> first if it feels stuck (large crawls can take many
            minutes).
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <input
              value={listingUrl}
              onChange={(e) => setListingUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
              placeholder="https://www.example-agency.com.mt/"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#1a2744] px-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor="max-crawl-pages" className="text-xs font-medium text-gray-500">
                Max pages to open
              </label>
              <input
                id="max-crawl-pages"
                type="number"
                min={1}
                max={800}
                value={maxCrawlPages}
                onChange={(e) =>
                  setMaxCrawlPages(Math.min(800, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))
                }
                disabled={discovering}
                title="Starts at 120 — not a result from the crawl. Raise only if you need more URLs and can wait."
                className="w-24 rounded-lg border border-white/10 bg-[#1a2744] px-3 py-2.5 text-sm text-white"
              />
              <span className="max-w-[140px] text-[10px] leading-tight text-gray-600">
                Default <span className="font-mono text-slate-500">120</span> = safety cap, change before crawl
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleDiscover()}
              disabled={discovering || !listingUrl.trim()}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {discovering ? "Crawling…" : "🔍 Crawl all pages"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        {discovered.length > 0 && (
          <div className="mb-6 rounded-xl border border-white/10 bg-[#0f1728] p-6">
            <h2 className="mb-4 text-sm font-medium tracking-wider text-gray-400 uppercase">Step 2 — Extract</h2>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-white">
                  URLs ready to extract:{" "}
                  <span className="text-blue-300">{discovered.length}</span>
                </p>
                {crawlInfo != null && (
                  <p className="mt-1 text-xs text-gray-500">
                    Playwright opened{" "}
                    <span className="font-mono text-slate-300">{crawlInfo.pagesVisited}</span>
                    {" / "}
                    <span className="font-mono text-slate-400">{crawlInfo.cap}</span> pages ·{" "}
                    <span className="font-mono text-slate-300">{crawlInfo.uniqueUrls}</span> unique internal URLs
                    collected
                  </p>
                )}
                <p className="mt-1 max-w-xl text-xs text-gray-500">
                  Ordered by relevance (property and listing URLs first). Reduce “URLs to extract” if you only need a
                  subset.
                </p>
                {qualifyFilterStats != null && (
                  <p className="mt-2 text-xs text-emerald-400/90">
                    HTML filter last run:{" "}
                    <span className="font-mono text-emerald-300">{qualifyFilterStats.before}</span> →{" "}
                    <span className="font-mono text-emerald-300">{qualifyFilterStats.after}</span> URLs kept
                  </p>
                )}
                <div className="mt-4 flex flex-col gap-3 rounded-lg border border-white/10 bg-[#1a2744]/40 p-4">
                  <p className="text-xs text-slate-400">
                    Before LLM extract, scan each URL (fast scrape) and <strong className="text-slate-300">keep only</strong>{" "}
                    pages that look like property listings: reference (or listing JSON-LD), email or phone, and
                    bedrooms/bathrooms or area signals. This cuts empty table columns on generic site pages.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={requireAgentOnFilter}
                      onChange={(e) => setRequireAgentOnFilter(e.target.checked)}
                      disabled={qualifying}
                      className="rounded border-white/20"
                    />
                    Require agent / “listed by” text (stricter)
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleQualifyFilter()}
                    disabled={qualifying || discovered.length === 0}
                    className="w-fit rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    {qualifying ? "Scanning URLs…" : "Scan & keep only property-like pages"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="properties-extract" className="text-sm font-medium text-slate-200">
                    URLs to extract
                  </label>
                  <input
                    id="properties-extract"
                    type="number"
                    min={1}
                    max={discovered.length}
                    value={propertiesToExtract}
                    onChange={(e) =>
                      setPropertiesToExtract(
                        Math.min(
                          discovered.length,
                          Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                        ),
                      )
                    }
                    className="w-24 rounded-lg border border-white/10 bg-[#1a2744] px-3 py-2 text-sm text-white"
                    aria-label="How many URLs to extract"
                  />
                  <span className="text-[11px] text-gray-500">Max {discovered.length} URLs</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleExtract()}
                  disabled={extracting || qualifying || discovered.length === 0}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {extracting
                    ? `Extracting ${progress.done}/${progress.total}...`
                    : `Extract (${Math.min(propertiesToExtract, discovered.length)}) →`}
                </button>
              </div>
            </div>
            {extractErr && (
              <p className="mt-4 whitespace-pre-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {extractErr}
              </p>
            )}
          </div>
        )}

        {(extracting || deepExtracting) && (
          <div className="mb-6 rounded-xl border border-white/10 bg-[#0f1728] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-gray-300">
                {deepExtracting ? "Deep extract" : "Extracting"} {progress.done}/{progress.total}
              </span>
              <span className="font-mono text-sm text-blue-400">{pct}%</span>
            </div>
            <div className="mb-2 h-2 w-full rounded-full bg-[#1a2744]">
              <div
                className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="truncate text-xs text-gray-500">{progress.current}</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0f1728] p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium tracking-wider text-gray-400 uppercase">Extracted Data</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleDeepExtract()}
                  disabled={
                    deepExtracting ||
                    extracting ||
                    qualifying ||
                    selectedResultIndices.size === 0
                  }
                  className="rounded-lg border border-amber-500/50 bg-amber-600/25 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-600/35 disabled:opacity-45"
                  title="Re-scrape crawl URLs that contain this row’s reference; fill only empty columns"
                >
                  {deepExtracting ? "Deep extract…" : "⚡ Deep extract"}
                </button>
                <button
                  type="button"
                  onClick={exportCSV}
                  disabled={deepExtracting}
                  className="rounded-lg border border-green-600/40 bg-green-600/20 px-3 py-1.5 text-xs text-green-400 hover:bg-green-600/30 disabled:opacity-40"
                >
                  📄 CSV
                </button>
                <button
                  type="button"
                  onClick={exportExcel}
                  disabled={deepExtracting}
                  className="rounded-lg border border-blue-600/40 bg-blue-600/20 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-600/30 disabled:opacity-40"
                >
                  📊 Excel
                </button>
                <button
                  type="button"
                  onClick={exportJSON}
                  disabled={deepExtracting}
                  className="rounded-lg border border-purple-600/40 bg-purple-600/20 px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-600/30 disabled:opacity-40"
                >
                  📋 JSON
                </button>
              </div>
            </div>
            <p className="mb-3 text-[11px] text-gray-500">
              <strong className="text-slate-400">Deep extract:</strong> uses this row’s{" "}
              <span className="font-mono text-slate-500">reference_number</span> to pick crawl URLs that contain that
              ref, runs extract on each (max 10) until table columns are filled — only empty cells are updated.
            </p>

            <div className="max-h-[65vh] overflow-auto rounded-xl border border-white/10">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#1a2744]">
                  <tr>
                    <th className="w-10 border-b border-white/10 px-2 py-2.5 text-left font-medium text-gray-400">
                      <input
                        type="checkbox"
                        checked={results.length > 0 && selectedResultIndices.size === results.length}
                        onChange={toggleSelectAllResults}
                        disabled={deepExtracting || !results.length}
                        className="rounded border-white/20"
                        title="Select all rows"
                        aria-label="Select all rows"
                      />
                    </th>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="border-b border-white/10 px-3 py-2.5 text-left font-medium whitespace-nowrap text-gray-400"
                        style={{
                          minWidth:
                            col.type === "image"
                              ? 80
                              : col.type === "url"
                                ? 140
                                : col.type === "text" && col.key === "title"
                                  ? 200
                                  : col.type === "dims"
                                    ? 160
                                    : 90,
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr
                      key={`${String(row.reference_number ?? row.listing_url ?? "row")}-${i}`}
                      className={`border-b border-white/5 hover:bg-blue-500/5 ${
                        i % 2 === 0 ? "bg-[#0a0f1a]" : "bg-[#0f1320]"
                      }`}
                    >
                      <td className="align-middle px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedResultIndices.has(i)}
                          onChange={() => toggleResultRowSelected(i)}
                          disabled={deepExtracting}
                          aria-label={`Select row ${String(row.reference_number ?? i + 1)}`}
                          className="rounded border-white/20"
                        />
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="align-top px-3 py-2">
                          {renderCell(col, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
