"use client";

import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { MaltaAgenciesPanel } from "@/components/MaltaAgenciesPanel";
import {
  hoqScrapeDetail,
  hoqScrapeList,
  workbenchSave,
  type HoqDetailResultItem,
  type WorkbenchAgency,
} from "@/lib/api";

const DEFAULT_LIST_URL = "https://www.homesofquality.com.mt/latest-properties/";

const HOQ_SORT_OPTIONS: { value: "none" | "price" | "locality" | "beds" | "baths" | "category"; label: string }[] =
  [
    { value: "none", label: "— None —" },
    { value: "price", label: "Price" },
    { value: "locality", label: "Locality" },
    { value: "beds", label: "Beds" },
    { value: "baths", label: "Baths" },
    { value: "category", label: "Category (type)" },
  ];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return `"${String(v.join("; ")).replace(/"/g, '""')}"`;
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function rowsToCsv(rows: Record<string, unknown>[], keys: string[]): string {
  const header = keys.map(csvEscape).join(",");
  const lines = rows.map((r) => keys.map((k) => csvEscape(r[k])).join(","));
  return [header, ...lines].join("\n");
}

function collectKeys(rows: Record<string, unknown>[]): string[] {
  const s = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => s.add(k)));
  return [...s].sort();
}

function mergeUniqueByRef(
  prev: Record<string, unknown>[],
  batch: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set(prev.map((r) => String(r.reference ?? "")).filter(Boolean));
  const merged = [...prev];
  for (const row of batch) {
    const ref = String(row.reference ?? "");
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    merged.push(row);
  }
  return merged;
}

function headerLabel(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusStyleClass(status: unknown) {
  const s = String(status || "").toLowerCase();
  if (s.includes("sold")) return "bg-red-500/15 text-red-400";
  if (s.includes("market")) return "bg-green-500/15 text-green-400";
  return "bg-white/10 text-slate-400";
}

/** Same visible columns as the listing table (excluding checkbox). */
const HOQ_LISTING_COLUMN_KEYS: readonly string[] = [
  "main_image_url",
  "reference",
  "title",
  "property_type",
  "status",
  "price",
  "bedrooms",
  "bathrooms",
  "internal_sqm",
  "locality",
  "badge",
];

const HOQ_CORE_ROW_KEYS = new Set<string>([...HOQ_LISTING_COLUMN_KEYS, "listing_url"]);

/** Not shown as extra columns in the detail table (hidden / redundant with listing columns). */
const HOQ_DETAIL_HIDDEN_EXTRA_KEYS = new Set<string>([
  "latitude",
  "longitude",
  "currency",
  "all_images",
  "external_sqm",
  "virtual_tour_url",
  "floor_plan_url",
  "amenities",
  "features",
  "town",
  "full_address",
  "description_preview",
  "listing_date",
  "description",
]);

const DETAIL_EXTRA_KEY_ORDER: readonly string[] = [
  "agent_name",
  "agent_phone",
  "agent_email",
  "air_conditioning",
  "balconies",
  "kitchen",
  "living_room",
  "dining_room",
  "floor_number",
  "heating",
  "lift",
  "swimming_pool",
  "dining_room_dimensions",
  "living_room_dimensions",
  "kitchen_dimensions",
  "bedroom_dimensions",
  "total_sqm",
  "floor_level",
  "furnished",
  "region",
  "price_text",
  "category",
];

/** Detail-table columns to always show (when any detail row exists), in order. */
const DETAIL_EXTRA_VISIBLE_KEYS = DETAIL_EXTRA_KEY_ORDER.filter(
  (k) => !HOQ_CORE_ROW_KEYS.has(k) && !HOQ_DETAIL_HIDDEN_EXTRA_KEYS.has(k),
);

const DETAIL_EXTRA_HEADER_LABEL: Record<string, string> = {
  air_conditioning: "Air conditioning",
  balconies: "Balconies",
  kitchen: "Kitchen",
  living_room: "Living room",
  dining_room: "Dining room",
  floor_number: "Floor no.",
  heating: "Heating",
  lift: "Lift",
  swimming_pool: "Swimming pool",
  dining_room_dimensions: "Dining room dimensions",
  living_room_dimensions: "Living room dimensions",
  kitchen_dimensions: "Kitchen dimensions",
  bedroom_dimensions: "Bedroom dimensions",
  price_text: "Price",
  total_sqm: "Total m²",
};

/** Header for detail-table extra columns */
function detailExtraColumnLabel(k: string): string {
  return DETAIL_EXTRA_HEADER_LABEL[k] ?? headerLabel(k);
}

const ROOM_DIMENSION_MERGE_PAIRS: readonly [plural: string, singular: string][] = [
  ["bedroom_dimensions", "bedroom_dimension"],
  ["kitchen_dimensions", "kitchen_dimension"],
  ["living_room_dimensions", "living_room_dimension"],
  ["dining_room_dimensions", "dining_room_dimension"],
];

const MULTI_ROOM_DIMENSION_KEYS = new Set(ROOM_DIMENSION_MERGE_PAIRS.map(([p]) => p));

function normalizeImageUrlList(v: unknown, row?: Record<string, unknown>): string[] {
  if (v == null && row) {
    v = row.all_images ?? row.images;
  }
  if (v == null) return [];
  if (typeof v === "number") return [];
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    if (t.startsWith("http")) return [t];
    if (t.startsWith("[") && t.includes("http")) {
      try {
        const p = JSON.parse(t) as unknown;
        return normalizeImageUrlList(p, undefined);
      } catch {
        return t
          .split(/[\n,;|]+/)
          .map((s) => s.trim())
          .filter((s) => s.startsWith("http"));
      }
    }
    return t
      .split(/[\n,;|]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http"));
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim().startsWith("http")) {
      out.push(x.trim());
    } else if (x && typeof x === "object" && "url" in (x as object)) {
      const u = (x as { url?: unknown }).url;
      if (typeof u === "string" && u.startsWith("http")) out.push(u);
    }
  }
  return out;
}

function HoqListingRowCells({
  row,
  onPickImage,
}: {
  row: Record<string, unknown>;
  onPickImage: (url: string) => void;
}) {
  const ref = String(row.reference ?? "");
  const img = row.main_image_url as string | undefined;
  return (
    <>
      <td className="px-2 py-2 align-middle">
        {img ? (
          <button
            type="button"
            className="relative block h-[60px] w-[80px] overflow-hidden rounded border border-white/10 bg-black/40"
            onClick={() => onPickImage(img)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </button>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-2 py-2 font-mono text-xs text-slate-300">{ref || "—"}</td>
      <td className="max-w-[200px] px-2 py-2 text-slate-200">{String(row.title ?? "")}</td>
      <td className="px-2 py-2 text-xs text-slate-400">{String(row.property_type ?? "")}</td>
      <td className="whitespace-nowrap px-2 py-2 align-middle">
        <span
          className={`inline-flex max-w-none items-center rounded-md px-2.5 py-1 text-[11px] font-medium leading-tight whitespace-nowrap ${statusStyleClass(row.status)}`}
        >
          {String(row.status ?? "—")}
        </span>
      </td>
      <td className="px-2 py-2 font-semibold text-blue-400">
        {row.price != null ? `€${Number(row.price).toLocaleString()}` : "—"}
      </td>
      <td className="px-2 py-2 text-slate-300">🛏 {String(row.bedrooms ?? "—")}</td>
      <td className="px-2 py-2 text-slate-300">🚿 {String(row.bathrooms ?? "—")}</td>
      <td className="px-2 py-2 text-slate-300">
        {row.internal_sqm != null ? `${row.internal_sqm} m²` : "—"}
      </td>
      <td className="px-2 py-2 text-slate-300">{String(row.locality ?? "")}</td>
      <td className="px-2 py-2">
        {row.badge ? (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
            {String(row.badge)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {row.listing_url ? (
          <a
            href={String(row.listing_url)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-400 underline"
            onClick={(e) => e.stopPropagation()}
          >
            View ↗
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="max-w-[min(320px,28vw)] px-2 py-2 align-top">
        {row.listing_url ? (
          <span
            className="block font-mono text-[10px] leading-snug text-slate-400 break-all"
            title={String(row.listing_url)}
          >
            {String(row.listing_url)}
          </span>
        ) : (
          "—"
        )}
      </td>
    </>
  );
}

export default function HoqScraperPage() {
  /** Last HOQ `listings_page` index included in the current table (for “Load next”). */
  const [lastLoadedListingPage, setLastLoadedListingPage] = useState(0);
  const [totalPagesHint, setTotalPagesHint] = useState<number | null>(null);
  /** How many consecutive listing pages to pull in one API call (merge + dedupe). */
  const [pagesToFetch, setPagesToFetch] = useState(10);
  const [listings, setListings] = useState<Record<string, unknown>[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  /** Spinner only on “Load listings” — not on append / load-all (user request). */
  const [primaryLoadSpinner, setPrimaryLoadSpinner] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** Keep listings visible; detail extraction opens separately when user clicks selected-details button. */
  const [showListingsGrid, setShowListingsGrid] = useState(true);

  type HoqSortField = "none" | "price" | "locality" | "beds" | "baths" | "category";
  const [sortField, setSortField] = useState<HoqSortField>("none");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filterLocality, setFilterLocality] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterMinBeds, setFilterMinBeds] = useState("");
  const [filterMinBaths, setFilterMinBaths] = useState("");
  const [filterMinPrice, setFilterMinPrice] = useState("");
  const [filterMaxPrice, setFilterMaxPrice] = useState("");

  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());

  const [detailRows, setDetailRows] = useState<Record<string, unknown>[]>([]);
  const [detailSectionOpen, setDetailSectionOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailProgress, setDetailProgress] = useState({ done: 0, total: 0 });
  const [detailError, setDetailError] = useState<string | null>(null);

  const [imgModal, setImgModal] = useState<string | null>(null);

  /** Agencies checked in the Malta / Apify table — drives the property section title. */
  const [maltaSelectedAgencies, setMaltaSelectedAgencies] = useState<WorkbenchAgency[]>([]);

  const propertyListingsTitle = useMemo(() => {
    if (!maltaSelectedAgencies.length) return "Property listings";
    const parts = maltaSelectedAgencies.map((a) => {
      const n = (a.name || "").trim();
      if (n) return n;
      const raw = (a.website_url || "").trim();
      if (!raw) return "Agency";
      try {
        const u = raw.startsWith("http") ? raw : `https://${raw}`;
        return new URL(u).hostname.replace(/^www\./i, "");
      } catch {
        return raw.slice(0, 48);
      }
    });
    return `Property listings (${parts.join(", ")})`;
  }, [maltaSelectedAgencies]);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortMenuOpen]);

  const listingKeys = useMemo(() => {
    const preferred = [
      "reference",
      "main_image_url",
      "title",
      "property_type",
      "status",
      "price",
      "currency",
      "bedrooms",
      "bathrooms",
      "internal_sqm",
      "locality",
      "badge",
      "listing_url",
    ];
    const present = new Set<string>();
    listings.forEach((r) => Object.keys(r).forEach((k) => present.add(k)));
    const ordered = preferred.filter((k) => present.has(k));
    const rest = [...present].filter((k) => !preferred.includes(k)).sort();
    return [...ordered, ...rest];
  }, [listings]);

  const displayedListings = useMemo(() => {
    let rows = [...listings];
    const loc = filterLocality.trim().toLowerCase();
    const cat = filterCategory.trim().toLowerCase();
    const minB = filterMinBeds.trim() ? Number(filterMinBeds) : NaN;
    const minBa = filterMinBaths.trim() ? Number(filterMinBaths) : NaN;
    const minP = filterMinPrice.trim() ? Number(String(filterMinPrice).replace(/,/g, "")) : NaN;
    const maxP = filterMaxPrice.trim() ? Number(String(filterMaxPrice).replace(/,/g, "")) : NaN;

    rows = rows.filter((r) => {
      if (loc) {
        const L = String(r.locality ?? "").toLowerCase();
        if (!L.includes(loc)) return false;
      }
      if (cat) {
        const c = String(r.property_type ?? "").toLowerCase();
        if (!c.includes(cat)) return false;
      }
      if (!Number.isNaN(minB)) {
        const b = Number(r.bedrooms);
        if (Number.isNaN(b) || b < minB) return false;
      }
      if (!Number.isNaN(minBa)) {
        const b = Number(r.bathrooms);
        if (Number.isNaN(b) || b < minBa) return false;
      }
      const price = Number(r.price);
      if (!Number.isNaN(minP)) {
        if (Number.isNaN(price) || price < minP) return false;
      }
      if (!Number.isNaN(maxP)) {
        if (Number.isNaN(price) || price > maxP) return false;
      }
      return true;
    });

    if (sortField === "none") return rows;

    const mul = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      const refA = String(a.reference ?? "");
      const refB = String(b.reference ?? "");
      switch (sortField) {
        case "price": {
          const pa = Number(a.price);
          const pb = Number(b.price);
          const cmp = (Number.isNaN(pa) ? 0 : pa) - (Number.isNaN(pb) ? 0 : pb);
          return cmp * mul || refA.localeCompare(refB);
        }
        case "locality":
          return (
            String(a.locality ?? "").localeCompare(String(b.locality ?? ""), undefined, {
              sensitivity: "base",
            }) * mul
          );
        case "beds":
          return (
            ((Number(a.bedrooms) || 0) - (Number(b.bedrooms) || 0)) * mul ||
            refA.localeCompare(refB)
          );
        case "baths":
          return (
            ((Number(a.bathrooms) || 0) - (Number(b.bathrooms) || 0)) * mul ||
            refA.localeCompare(refB)
          );
        case "category":
          return (
            String(a.property_type ?? "").localeCompare(String(b.property_type ?? ""), undefined, {
              sensitivity: "base",
            }) * mul
          );
        default:
          return 0;
      }
    });
    return rows;
  }, [
    listings,
    sortField,
    sortAsc,
    filterLocality,
    filterCategory,
    filterMinBeds,
    filterMinBaths,
    filterMinPrice,
    filterMaxPrice,
  ]);

  const listingByRef = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    listings.forEach((r) => {
      const ref = String(r.reference ?? "");
      if (ref) m.set(ref, r);
    });
    return m;
  }, [listings]);

  /** Merge list + detail; listing wins for ref, locality, image & internal m² (same as listings table). */
  const detailRowsMerged = useMemo(() => {
    return detailRows.map((d) => {
      const ref = String(d.reference ?? "");
      const base = listingByRef.get(ref);
      const merged = { ...(base || {}), ...d } as Record<string, unknown>;
      if (base) {
        const listRef = base.reference;
        if (listRef != null && String(listRef).trim() !== "") merged.reference = listRef;
        const loc = base.locality;
        if (loc != null && String(loc).trim() !== "") merged.locality = loc;
        const listImg = base.main_image_url;
        if (typeof listImg === "string" && listImg.trim()) merged.main_image_url = listImg.trim();
        const sqm = base.internal_sqm;
        if (sqm != null && String(sqm).trim() !== "") merged.internal_sqm = sqm;
      }
      delete merged.description_preview;
      for (const [plural, singular] of ROOM_DIMENSION_MERGE_PAIRS) {
        const val =
          d[plural] ?? d[singular] ?? merged[plural] ?? merged[singular];
        delete merged[singular];
        delete merged[plural];
        const has =
          val != null &&
          (Array.isArray(val)
            ? val.some((x) => x != null && String(x).trim() !== "")
            : String(val).trim() !== "");
        if (has) merged[plural] = val;
      }
      return merged;
    });
  }, [detailRows, listingByRef]);

  const detailExtraKeys = useMemo(() => {
    if (!detailRowsMerged.length) return [] as string[];
    const all = collectKeys(detailRowsMerged);
    const extras = all.filter(
      (k) => !HOQ_CORE_ROW_KEYS.has(k) && !HOQ_DETAIL_HIDDEN_EXTRA_KEYS.has(k),
    );
    const rest = extras.filter((k) => !DETAIL_EXTRA_VISIBLE_KEYS.includes(k)).sort();
    return [...DETAIL_EXTRA_VISIBLE_KEYS, ...rest];
  }, [detailRowsMerged]);

  const toggleRef = useCallback((ref: string) => {
    setSelectedRefs((prev) => {
      const n = new Set(prev);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });
  }, []);

  const selectAll = useCallback(() => {
    const all = displayedListings.map((r) => String(r.reference ?? "")).filter(Boolean);
    if (all.length === 0) return;
    setSelectedRefs(new Set(all));
  }, [displayedListings]);

  const clearSelection = useCallback(() => setSelectedRefs(new Set()), []);

  const runDetailScrape = useCallback(async (refsOverride?: string[]) => {
    const refs =
      refsOverride !== undefined && refsOverride.length > 0 ? refsOverride : Array.from(selectedRefs);
    if (refs.length === 0) return;
    setDetailSectionOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetailProgress({ done: 0, total: refs.length });
    const merged: Record<string, unknown>[] = [];
    try {
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]!;
        setDetailProgress({ done: i, total: refs.length });
        const res = await hoqScrapeDetail([ref]);
        const items = res.results || [];
        for (const it of items as HoqDetailResultItem[]) {
          if (it.success && it.data && typeof it.data === "object") {
            merged.push(it.data as Record<string, unknown>);
            setDetailRows([...merged]);
          }
        }
        setDetailProgress({ done: i + 1, total: refs.length });
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
      setDetailProgress({ done: refs.length, total: refs.length });
    }
  }, [selectedRefs]);

  const loadListings = useCallback(
    async (
      startPage: number,
      append: boolean,
      pageCount: number = 1,
      primaryButtonSpinner = false,
    ) => {
      setListLoading(true);
      setPrimaryLoadSpinner(primaryButtonSpinner);
      setListError(null);
      try {
        const res = await hoqScrapeList(DEFAULT_LIST_URL, startPage, pageCount);
        if (res.error) setListError(res.error);
        const next = (res.properties || []) as Record<string, unknown>[];
        setListings((prev) => (append ? mergeUniqueByRef(prev, next) : next));
        setHasMore(Boolean(res.has_more));
        if (res.total_pages != null && res.total_pages > 0) setTotalPagesHint(res.total_pages);
        const fetched = res.pages_fetched ?? pageCount;
        const endPage = startPage + Math.max(0, fetched - 1);
        if (!append) {
          setLastLoadedListingPage(endPage);
          setDetailRows([]);
          setDetailSectionOpen(false);
          setDetailError(null);
          setDetailProgress({ done: 0, total: 0 });
          setSelectedRefs(new Set());
          setShowListingsGrid(true);
        } else {
          setLastLoadedListingPage(endPage);
        }
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      } finally {
        setListLoading(false);
        setPrimaryLoadSpinner(false);
      }
    },
    [],
  );

  const exportListingsCsv = () => {
    if (!displayedListings.length) return;
    const keys = listingKeys.length ? listingKeys : collectKeys(displayedListings);
    downloadBlob(
      new Blob([rowsToCsv(displayedListings, keys)], { type: "text/csv;charset=utf-8" }),
      "hoq-listings.csv",
    );
  };

  const exportDetailCsv = () => {
    if (!detailRowsMerged.length) return;
    const keys = collectKeys(detailRowsMerged);
    downloadBlob(
      new Blob([rowsToCsv(detailRowsMerged, keys)], { type: "text/csv;charset=utf-8" }),
      "hoq-details.csv",
    );
  };

  const exportDetailJson = () => {
    if (!detailRowsMerged.length) return;
    downloadBlob(
      new Blob([JSON.stringify(detailRowsMerged, null, 2)], { type: "application/json" }),
      "hoq-details.json",
    );
  };

  const buildExcelWorkbook = () => {
    const wb = XLSX.utils.book_new();

    const listKeys = listingKeys.length ? listingKeys : collectKeys(displayedListings);
    if (displayedListings.length) {
      const ws1 = XLSX.utils.json_to_sheet(
        displayedListings.map((r) => {
          const o: Record<string, unknown> = {};
          listKeys.forEach((k) => {
            o[headerLabel(k)] = r[k] ?? "";
          });
          return o;
        }),
      );
      ws1["!cols"] = listKeys.map((k) => ({ wch: Math.min(36, Math.max(12, k.length + 2)) }));
      XLSX.utils.book_append_sheet(wb, ws1, "Listings");
    }

    if (detailRowsMerged.length) {
      const dk = collectKeys(detailRowsMerged);
      const ws2 = XLSX.utils.json_to_sheet(
        detailRowsMerged.map((r) => {
          const o: Record<string, unknown> = {};
          dk.forEach((k) => {
            const v = r[k];
            o[headerLabel(k)] = Array.isArray(v) ? (v as unknown[]).join("; ") : v ?? "";
          });
          return o;
        }),
      );
      ws2["!cols"] = dk.map((k) => ({ wch: Math.min(48, Math.max(10, k.length + 2)) }));
      XLSX.utils.book_append_sheet(wb, ws2, "Details");
    }

    const imgRows: Record<string, unknown>[] = [];
    const src = detailRowsMerged.length ? detailRowsMerged : displayedListings;
    for (const row of src) {
      const ref = String(row.reference ?? "");
      const imgs = normalizeImageUrlList(row.all_images, row);
      if (!ref && imgs.length === 0) continue;
      const o: Record<string, unknown> = { Reference: ref };
      imgs.forEach((u, i) => {
        o[`Image ${i + 1} URL`] = u;
      });
      imgRows.push(o);
    }
    if (imgRows.length) {
      const ws3 = XLSX.utils.json_to_sheet(imgRows);
      XLSX.utils.book_append_sheet(wb, ws3, "Images");
    }

    return wb;
  };

  const exportListingsExcel = () => {
    if (!displayedListings.length) return;
    const wb = XLSX.utils.book_new();
    const keys = listingKeys.length ? listingKeys : collectKeys(displayedListings);
    const ws = XLSX.utils.json_to_sheet(
      displayedListings.map((r) => {
        const o: Record<string, unknown> = {};
        keys.forEach((k) => {
          o[headerLabel(k)] = r[k] ?? "";
        });
        return o;
      }),
    );
    XLSX.utils.book_append_sheet(wb, ws, "Listings");
    XLSX.writeFile(wb, "hoq-listings.xlsx");
  };

  const exportFullExcel = () => {
    const wb = buildExcelWorkbook();
    if (!wb.SheetNames.length) return;
    XLSX.writeFile(wb, "hoq-export.xlsx");
  };

  const exportDetailExcelOnly = () => {
    if (!detailRowsMerged.length) return;
    const wb = XLSX.utils.book_new();
    const dk = collectKeys(detailRowsMerged);
    const ws2 = XLSX.utils.json_to_sheet(
      detailRowsMerged.map((r) => {
        const o: Record<string, unknown> = {};
        dk.forEach((k) => {
          const v = r[k];
          o[headerLabel(k)] = Array.isArray(v) ? (v as unknown[]).join("; ") : v ?? "";
        });
        return o;
      }),
    );
    XLSX.utils.book_append_sheet(wb, ws2, "Details");
    const imgRows: Record<string, unknown>[] = [];
    for (const row of detailRowsMerged) {
      const ref = String(row.reference ?? "");
      const imgs = normalizeImageUrlList(row.all_images, row);
      if (!ref && !imgs.length) continue;
      const o: Record<string, unknown> = { Reference: ref };
      imgs.forEach((u, i) => {
        o[`Image ${i + 1} URL`] = u;
      });
      imgRows.push(o);
    }
    if (imgRows.length) {
      const ws3 = XLSX.utils.json_to_sheet(imgRows);
      XLSX.utils.book_append_sheet(wb, ws3, "Images");
    }
    XLSX.writeFile(wb, "hoq-details.xlsx");
  };

  const saveToDatabase = async () => {
    if (!detailRowsMerged.length) {
      alert("Run detail extraction first.");
      return;
    }
    const payload = detailRowsMerged.map((d) => ({
      ...d,
      images: normalizeImageUrlList(d.all_images, d),
    }));
    const res = await workbenchSave({
      data: payload,
      agency_name: "Homes of Quality",
      city: "Malta",
      country: "Malta",
      website_url: "https://www.homesofquality.com.mt/",
    });
    alert(res.error ? res.error : `Saved ${res.saved} properties.`);
  };

  const progressPct =
    detailProgress.total > 0 ? Math.round((detailProgress.done / detailProgress.total) * 100) : 0;

  return (
    <div className="min-h-[calc(100vh-60px)] bg-[var(--bg-base)] px-4 py-8 text-[var(--text-primary)] md:px-8">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
              ← Home
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-white md:text-3xl">Workbench</h1>
          </div>
        </div>

        <MaltaAgenciesPanel onSelectionChange={setMaltaSelectedAgencies} />

        {/* Section 1 */}
        <section className="mb-12 rounded-xl border border-white/10 bg-[var(--bg-card)] p-5 md:p-6">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1 space-y-2">
              <h2 className="text-lg font-semibold text-white">{propertyListingsTitle}</h2>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-slate-200">No. of pages</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pagesToFetch}
                    onChange={(e) => setPagesToFetch(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    className="w-20 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white"
                    aria-label="No. of pages"
                  />
                </div>
                {totalPagesHint != null && (
                  <p className="text-xs text-slate-400">
                    Pagination on site: ~<strong className="text-slate-200">{totalPagesHint}</strong> listing pages
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={listLoading}
                onClick={() => void loadListings(1, false, pagesToFetch, true)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {primaryLoadSpinner ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    Loading…
                  </>
                ) : (
                  <>🔄 Load listings</>
                )}
              </button>
              <button
                type="button"
                disabled={listLoading || !totalPagesHint || totalPagesHint <= 1}
                onClick={() => {
                  const n = totalPagesHint ?? 0;
                  if (n > 25 && !window.confirm(`Load all ${n} listing pages? This can take a long time.`)) return;
                  void loadListings(1, false, n, false);
                }}
                className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-500/20 disabled:opacity-40"
              >
                Load all pages
              </button>
              <button
                type="button"
                onClick={selectAll}
                disabled={!displayedListings.length}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40"
              >
                ✅ Select all
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!selectedRefs.size}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-400 hover:bg-white/5 disabled:opacity-40"
              >
                Clear selection
              </button>
              <button
                type="button"
                disabled={selectedRefs.size === 0 || detailLoading}
                onClick={() => void runDetailScrape()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {detailLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    Loading…
                  </>
                ) : (
                  <>🔍 Get detail for selected ({selectedRefs.size})</>
                )}
              </button>
            </div>
          </div>

          {listError && <p className="mb-3 text-sm text-amber-400">{listError}</p>}

          {hasMore && (
            <div className="mb-4">
              <button
                type="button"
                disabled={listLoading}
                onClick={() => void loadListings(lastLoadedListingPage + 1, true, 1, false)}
                className="text-sm font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                Load next listing page ({lastLoadedListingPage + 1}
                {totalPagesHint ? ` / ~${totalPagesHint}` : ""})
              </button>
            </div>
          )}

          {!showListingsGrid && listings.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[var(--bg-base)]/50 px-3 py-2 text-sm text-slate-400">
              <span>
                {listings.length} listing{listings.length === 1 ? "" : "s"} loaded — detail table below.
              </span>
              <button
                type="button"
                onClick={() => setShowListingsGrid(true)}
                className="text-blue-400 underline hover:text-blue-300"
              >
                Show listings table
              </button>
            </div>
          )}

          {showListingsGrid ? (
            <>
          <div className="mb-4 rounded-xl border border-white/10 bg-[var(--bg-card)]/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Sort & filter table
            </p>
            <div className="flex flex-wrap items-end gap-3 md:gap-4">
              <div ref={sortMenuRef} className="relative text-xs text-slate-500">
                <span className="block">Sort by</span>
                <button
                  type="button"
                  onClick={() => setSortMenuOpen((o) => !o)}
                  className="mt-1 flex min-w-[180px] items-center justify-between gap-2 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-left text-sm text-slate-100 shadow-inner shadow-black/20 hover:border-white/20 hover:bg-[var(--bg-card)]"
                  aria-expanded={sortMenuOpen}
                  aria-haspopup="listbox"
                >
                  <span>{HOQ_SORT_OPTIONS.find((o) => o.value === sortField)?.label ?? "—"}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${sortMenuOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
                {sortMenuOpen && (
                  <ul
                    role="listbox"
                    className="absolute left-0 top-full z-50 mt-1 max-h-60 min-w-full overflow-auto rounded-lg border border-white/10 bg-[var(--bg-card)] py-1 shadow-xl shadow-black/50 ring-1 ring-white/5"
                  >
                    {HOQ_SORT_OPTIONS.map((opt) => (
                      <li key={opt.value}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={sortField === opt.value}
                          onClick={() => {
                            setSortField(opt.value);
                            setSortMenuOpen(false);
                          }}
                          className={`flex w-full px-3 py-2 text-left text-sm transition-colors ${
                            sortField === opt.value
                              ? "bg-blue-500/20 font-medium text-blue-200"
                              : "text-slate-200 hover:bg-white/10"
                          }`}
                        >
                          {opt.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                disabled={sortField === "none"}
                onClick={() => setSortAsc((v) => !v)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
              >
                {sortAsc ? "Ascending ↑" : "Descending ↓"}
              </button>
              <label className="text-xs text-slate-500">
                Locality contains
                <input
                  value={filterLocality}
                  onChange={(e) => setFilterLocality(e.target.value)}
                  placeholder="e.g. Sliema"
                  className="mt-1 block w-36 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white md:w-44"
                />
              </label>
              <label className="text-xs text-slate-500">
                Category / type contains
                <input
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  placeholder="e.g. Apartment, Villa"
                  className="mt-1 block w-40 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white md:w-52"
                />
              </label>
              <label className="text-xs text-slate-500">
                Min beds
                <input
                  type="number"
                  min={0}
                  value={filterMinBeds}
                  onChange={(e) => setFilterMinBeds(e.target.value)}
                  className="mt-1 block w-20 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-500">
                Min baths
                <input
                  type="number"
                  min={0}
                  value={filterMinBaths}
                  onChange={(e) => setFilterMinBaths(e.target.value)}
                  className="mt-1 block w-20 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-500">
                Min €
                <input
                  type="number"
                  min={0}
                  value={filterMinPrice}
                  onChange={(e) => setFilterMinPrice(e.target.value)}
                  className="mt-1 block w-28 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-500">
                Max €
                <input
                  type="number"
                  min={0}
                  value={filterMaxPrice}
                  onChange={(e) => setFilterMaxPrice(e.target.value)}
                  className="mt-1 block w-28 rounded-lg border border-white/10 bg-[var(--bg-base)] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setSortField("none");
                  setSortAsc(true);
                  setFilterLocality("");
                  setFilterCategory("");
                  setFilterMinBeds("");
                  setFilterMinBaths("");
                  setFilterMinPrice("");
                  setFilterMaxPrice("");
                }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5"
              >
                Clear filters
              </button>
            </div>
          </div>

          <div
            className={`relative rounded-lg border border-white/10 overflow-x-scroll overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] ${
              displayedListings.length > 10 ? "max-h-[min(560px,65vh)]" : ""
            }`}
          >
            <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[#152038] text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="border-b border-white/10 px-2 py-2">☐</th>
                  <th className="border-b border-white/10 px-2 py-2">Image</th>
                  <th className="border-b border-white/10 px-2 py-2">Ref</th>
                  <th className="border-b border-white/10 px-2 py-2">Title</th>
                  <th className="border-b border-white/10 px-2 py-2">Type</th>
                  <th className="whitespace-nowrap border-b border-white/10 px-2 py-2">Status</th>
                  <th className="border-b border-white/10 px-2 py-2">Price</th>
                  <th className="border-b border-white/10 px-2 py-2">Beds</th>
                  <th className="border-b border-white/10 px-2 py-2">Baths</th>
                  <th
                    className="border-b border-white/10 px-2 py-2"
                    title="Internal area in square metres"
                  >
                    Int. m²
                  </th>
                  <th className="border-b border-white/10 px-2 py-2">Locality</th>
                  <th className="border-b border-white/10 px-2 py-2">Badge</th>
                  <th className="border-b border-white/10 px-2 py-2">Open</th>
                  <th className="border-b border-white/10 px-2 py-2">Full listing URL</th>
                </tr>
              </thead>
              <tbody>
                {displayedListings.map((row, idx) => {
                  const ref = String(row.reference ?? "");
                  const sel = ref && selectedRefs.has(ref);
                  return (
                    <tr key={ref || `row-${idx}`} className="border-b border-white/5 bg-[var(--bg-row-alt)]/40">
                      <td className="px-2 py-2 align-middle">
                        <input
                          type="checkbox"
                          checked={!!sel}
                          onChange={() => ref && toggleRef(ref)}
                          aria-label={`Select ${ref}`}
                        />
                      </td>
                      <HoqListingRowCells row={row} onPickImage={(u) => setImgModal(u)} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!listings.length && !listLoading && (
              <p className="p-6 text-center text-sm text-slate-500">
                Use “Load listings” above, then select properties and click “Get detail for selected”.
              </p>
            )}
            {listings.length > 0 && displayedListings.length === 0 && (
              <p className="p-6 text-center text-sm text-amber-400/90">
                No rows match the current filters — adjust or clear filters.
              </p>
            )}
          </div>
            </>
          ) : null}
        </section>

        {/* Section 2 */}
        {(detailSectionOpen || detailLoading || detailRows.length > 0 || detailError) && (
          <section className="mb-12 rounded-xl border border-white/10 bg-[var(--bg-card)] p-5 md:p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Detail extraction</h2>
            {detailLoading && (
              <div className="mb-4 space-y-2">
                <p className="text-sm text-slate-400">
                  Extracting details for {detailProgress.total} propert{detailProgress.total === 1 ? "y" : "ies"}…{" "}
                  {detailProgress.done}/{detailProgress.total}
                </p>
                <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
            {detailError && <p className="mb-3 text-sm text-red-400">{detailError}</p>}

            {detailRowsMerged.length > 0 && (
              <div className="max-h-[min(560px,65vh)] overflow-x-scroll overflow-y-auto rounded-lg border border-white/10 [scrollbar-gutter:stable] [scrollbar-width:thin]">
                <table
                  className="w-full border-collapse text-left text-sm"
                  style={{ minWidth: `${Math.max(1280, 1280 + detailExtraKeys.length * 140)}px` }}
                >
                  <thead className="sticky top-0 z-10 bg-[#152038] text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="border-b border-white/10 px-2 py-2">Image</th>
                      <th className="border-b border-white/10 px-2 py-2">Ref</th>
                      <th className="border-b border-white/10 px-2 py-2">Title</th>
                      <th className="border-b border-white/10 px-2 py-2">Type</th>
                      <th className="whitespace-nowrap border-b border-white/10 px-2 py-2">Status</th>
                      <th
                        className="border-b border-white/10 px-2 py-2"
                        title="Numeric price from listing scrape"
                      >
                        Amount (€)
                      </th>
                      <th className="border-b border-white/10 px-2 py-2">Beds</th>
                      <th className="border-b border-white/10 px-2 py-2">Baths</th>
                      <th
                        className="border-b border-white/10 px-2 py-2"
                        title="Internal area in square metres"
                      >
                        Int. m²
                      </th>
                      <th className="border-b border-white/10 px-2 py-2">Locality</th>
                      <th className="border-b border-white/10 px-2 py-2">Badge</th>
                      <th className="border-b border-white/10 px-2 py-2">Open</th>
                      <th className="border-b border-white/10 px-2 py-2">Full listing URL</th>
                      {detailExtraKeys.map((k) => (
                        <th key={k} className="border-b border-white/10 px-2 py-2 whitespace-nowrap">
                          {detailExtraColumnLabel(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRowsMerged.map((row, ri) => (
                      <tr
                        key={String(row.reference ?? ri)}
                        className="border-b border-white/5 bg-[var(--bg-row-alt)]/40"
                      >
                        <HoqListingRowCells row={row} onPickImage={(u) => setImgModal(u)} />
                        {detailExtraKeys.map((k) => (
                          <td key={k} className="max-w-[260px] px-2 py-2 align-top text-slate-300">
                            <DetailExtraCell k={k} row={row} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Section 3 */}
        <section className="rounded-xl border border-white/10 bg-[var(--bg-card)] p-5 md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Export</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportListingsCsv}
              disabled={!displayedListings.length}
              className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300 hover:bg-green-500/20 disabled:opacity-40"
            >
              📊 Export listings CSV
            </button>
            <button
              type="button"
              onClick={exportListingsExcel}
              disabled={!displayedListings.length}
              className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300 hover:bg-green-500/20 disabled:opacity-40"
            >
              📊 Export listings Excel
            </button>
            <button
              type="button"
              onClick={exportDetailCsv}
              disabled={!detailRows.length}
              className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-40"
            >
              📊 Export detail CSV
            </button>
            <button
              type="button"
              onClick={exportDetailExcelOnly}
              disabled={!detailRows.length}
              className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-40"
            >
              📊 Export detail Excel
            </button>
            <button
              type="button"
              onClick={exportFullExcel}
              disabled={!displayedListings.length && !detailRows.length}
              className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-40"
            >
              📊 Export all Excel (list + detail + images)
            </button>
            <button
              type="button"
              onClick={exportDetailJson}
              disabled={!detailRows.length}
              className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-sm text-purple-300 hover:bg-purple-500/20 disabled:opacity-40"
            >
              📋 Export detail JSON
            </button>
            <button
              type="button"
              onClick={() => void saveToDatabase()}
              disabled={!detailRows.length}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
            >
              💾 Save to database
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Multi-sheet Excel includes Listings, Details, and Images (when detail rows include <code className="text-slate-400">all_images</code>).
          </p>
        </section>
      </div>

      {imgModal && (
        <button
          type="button"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setImgModal(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgModal} alt="" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
        </button>
      )}

    </div>
  );
}

function DetailExtraCell({
  k,
  row,
}: {
  k: string;
  row: Record<string, unknown>;
}) {
  const v = row[k];

  if (MULTI_ROOM_DIMENSION_KEYS.has(k)) {
    if (v == null || v === "") return <span className="text-slate-600">—</span>;
    if (Array.isArray(v)) {
      const lines = v.map((x) => String(x).trim()).filter(Boolean);
      if (!lines.length) return <span className="text-slate-600">—</span>;
      return (
        <ul className="m-0 max-h-[min(280px,40vh)] min-w-[140px] max-w-[min(340px,42vw)] list-none space-y-1 overflow-y-auto py-0.5 pr-1 text-[13px] leading-snug text-slate-200">
          {lines.map((line, i) => (
            <li key={i} className="border-l-2 border-blue-500/40 pl-2">
              {line}
            </li>
          ))}
        </ul>
      );
    }
    const s = String(v).trim();
    if (!s) return <span className="text-slate-600">—</span>;
    return (
      <div className="max-h-[min(280px,40vh)] min-w-[140px] max-w-[min(340px,42vw)] overflow-y-auto whitespace-pre-wrap text-[13px] leading-snug text-slate-200">
        {s}
      </div>
    );
  }

  if (k === "total_sqm") {
    if (v === null || v === undefined || v === "") return <span className="text-slate-600">—</span>;
    const n = Number(v);
    if (!Number.isNaN(n)) return <span>{n.toLocaleString()} m²</span>;
    return <span>{String(v)} m²</span>;
  }

  if (Array.isArray(v)) return <span className="line-clamp-3">{v.map((x) => String(x)).join(", ")}</span>;
  if (v != null && typeof v === "object")
    return <span className="font-mono text-[10px]">{JSON.stringify(v)}</span>;
  return <span className="line-clamp-4">{v === null || v === undefined ? "—" : String(v)}</span>;
}
