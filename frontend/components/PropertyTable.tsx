"use client";

import Link from "next/link";
import { useState, useMemo, useRef, useEffect, type CSSProperties, Fragment } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import type { Property } from "@/types";
import { propertyImageSrc, resolvePropertyImages } from "@/lib/listingImages";
import {
  Bath,
  Bed,
  Building2,
  Download,
  ExternalLink,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Share2,
  ChevronDown,
} from "lucide-react";

const col = createColumnHelper<Property>();

function fmtNum(n?: number | null, dec = 0) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: dec });
}

function currencyPrefix(cur?: string | null) {
  const c = (cur || "EUR").toUpperCase();
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  if (c === "GBP") return "£";
  if (c === "AED") return "AED ";
  return `${c} `;
}

function fmtMoney(amount?: number | null, currency?: string | null) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const sym = currencyPrefix(currency);
  const n = Number(amount);
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${sym}${fmtNum(Math.round(n), 0)}`;
  return `${sym}${fmtNum(n, n % 1 === 0 ? 0 : 2)}`;
}

function csvEscape(cell: string | number | undefined | null) {
  const s = cell === undefined || cell === null ? "" : String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const TYPE_BADGES: Record<string, string> = {
  apartment: "badge-blue",
  villa: "badge-gold",
  townhouse: "badge-purple",
  commercial: "badge-teal",
  land: "badge-green",
  studio: "badge-teal",
  other: "badge-blue",
};

function furnishedState(p: Property): "furnished" | "unfurnished" | "unknown" {
  const f = p.furnished;
  if (f == null) return "unknown";
  if (typeof f === "boolean") return f ? "furnished" : "unfurnished";
  const s = String(f).toLowerCase();
  if (/unfurn|no\s*furniture|^no$/i.test(s)) return "unfurnished";
  if (/furnish|furniture/i.test(s)) return "furnished";
  return "unknown";
}

function amenityChip(raw: string): { emoji: string; label: string } {
  const s = raw.toLowerCase();
  if (/pool|swim/i.test(s)) return { emoji: "🏊", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  if (/park|garage|car/i.test(s)) return { emoji: "🚗", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  if (/garden|yard/i.test(s)) return { emoji: "🌿", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  if (/gym|fitness/i.test(s)) return { emoji: "🏋️", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  if (/elevator|lift/i.test(s)) return { emoji: "🛗", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  if (/balcon|terrace/i.test(s)) return { emoji: "🌅", label: raw.length > 14 ? `${raw.slice(0, 12)}…` : raw };
  return { emoji: "✨", label: raw.length > 18 ? `${raw.slice(0, 16)}…` : raw };
}

function PricePerSqmHint({
  value,
  avg,
  currency,
}: {
  value?: number | null;
  avg: number;
  currency?: string | null;
}) {
  if (value == null || !Number.isFinite(Number(value))) {
    return <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>—</span>;
  }
  const sym = currencyPrefix(currency);
  const v = Number(value);
  const color =
    avg > 0 ? (v < avg * 0.9 ? "var(--green)" : v > avg * 1.1 ? "var(--red)" : "var(--amber)") : "var(--text-primary)";
  let ctx = "Near avg";
  if (avg > 0) {
    if (v < avg * 0.9) ctx = "Below avg";
    else if (v > avg * 1.1) ctx = "Above avg";
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color, fontWeight: 700, fontSize: "0.76rem" }}>
        Per m²: {sym}
        {fmtNum(v, v >= 100 ? 0 : 2)}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.65rem", color: "var(--text-muted)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
        {ctx}
      </span>
    </div>
  );
}

function usePropertyStats(rows: Property[]) {
  return useMemo(() => {
    const prices = rows.map((p) => p.price).filter((x): x is number => x != null && Number.isFinite(x));
    const sqms = rows.map((p) => p.total_sqm).filter((x): x is number => x != null && Number.isFinite(x));
    const ppm = rows.map((p) => p.price_per_sqm).filter((x): x is number => x != null && Number.isFinite(x));
    const sum = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) : 0);
    const typeCounts = new Map<string, number>();
    for (const p of rows) {
      const t = (p.property_type || "other").toLowerCase();
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }
    let commonType = "—";
    let commonCount = 0;
    for (const [t, n] of typeCounts) {
      if (n > commonCount) {
        commonCount = n;
        commonType = t;
      }
    }
    return {
      count: rows.length,
      avgPrice: prices.length ? sum(prices) / prices.length : null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      avgSqm: sqms.length ? sum(sqms) / sqms.length : null,
      avgPriceSqm: ppm.length ? sum(ppm) / ppm.length : 0,
      commonType,
      commonTypeCount: commonCount,
    };
  }, [rows]);
}

type SortMode =
  | "price_asc"
  | "price_desc"
  | "size_asc"
  | "size_desc"
  | "ppm_asc"
  | "ppm_desc"
  | "date_asc"
  | "date_desc";

type SelectOption = { value: string; label: string };

function ThemeSelect({
  value,
  onChange,
  options,
  minWidth,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-primary)",
          padding: "0.5rem 0.65rem",
          fontSize: "0.78rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth,
          width: "100%",
          cursor: "pointer",
        }}
      >
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>{selected?.label}</span>
        <ChevronDown size={14} color="var(--text-muted)" />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "100%",
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 40,
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.24)",
            background: "#0f1728",
            boxShadow: "0 14px 34px rgba(0,0,0,0.42)",
            padding: 4,
          }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={`${o.value}-${o.label}`}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 8,
                  padding: "0.4rem 0.5rem",
                  fontSize: "0.76rem",
                  cursor: "pointer",
                  color: active ? "#dbeafe" : "var(--text-secondary)",
                  background: active ? "rgba(37,99,235,0.2)" : "transparent",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function sortRows(rows: Property[], mode: SortMode): Property[] {
  const copy = [...rows];
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const parseDate = (v: unknown) => {
    if (v == null) return null;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : null;
  };
  copy.sort((a, b) => {
    let cmp = 0;
    switch (mode) {
      case "price_asc":
      case "price_desc": {
        const va = num(a.price);
        const vb = num(b.price);
        if (va == null && vb == null) cmp = 0;
        else if (va == null) cmp = 1;
        else if (vb == null) cmp = -1;
        else cmp = va - vb;
        break;
      }
      case "size_asc":
      case "size_desc": {
        const va = num(a.total_sqm);
        const vb = num(b.total_sqm);
        if (va == null && vb == null) cmp = 0;
        else if (va == null) cmp = 1;
        else if (vb == null) cmp = -1;
        else cmp = va - vb;
        break;
      }
      case "ppm_asc":
      case "ppm_desc": {
        const va = num(a.price_per_sqm);
        const vb = num(b.price_per_sqm);
        if (va == null && vb == null) cmp = 0;
        else if (va == null) cmp = 1;
        else if (vb == null) cmp = -1;
        else cmp = va - vb;
        break;
      }
      case "date_asc":
      case "date_desc": {
        const va = parseDate(a.listing_date);
        const vb = parseDate(b.listing_date);
        if (va == null && vb == null) cmp = 0;
        else if (va == null) cmp = 1;
        else if (vb == null) cmp = -1;
        else cmp = va - vb;
        break;
      }
      default:
        cmp = 0;
    }
    if (mode.endsWith("_desc")) cmp = -cmp;
    return cmp;
  });
  return copy;
}

function PropertyThumb({ images, listingUrl }: { images?: string[]; listingUrl?: string | null }) {
  const [imgError, setImgError] = useState(false);
  const [hover, setHover] = useState(false);
  const resolved = useMemo(() => resolvePropertyImages(images, listingUrl), [images, listingUrl]);
  const first = resolved[0];
  const showImg = Boolean(first && !imgError);

  return (
    <div
      style={{ position: "relative", width: 68, flexShrink: 0 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element -- listing URLs are arbitrary external hosts
          <img
            src={first}
            alt=""
            width={60}
            height={60}
            className="rounded-lg object-cover"
            style={{ width: 60, height: 60, objectFit: "cover", display: "block" }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 60,
              height: 60,
              background: "#1a2744",
            }}
          >
            <Building2 className="text-blue-400" size={24} strokeWidth={1.75} />
          </div>
        )}
      </div>
      {resolved.length > 1 && (
        <span className="mt-1 block text-center text-xs text-gray-400">📷 {resolved.length}</span>
      )}
      {hover && showImg && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 72,
            zIndex: 50,
            width: 200,
            height: 150,
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--border)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            pointerEvents: "none",
            background: "#0f1728",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={first} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
    </div>
  );
}

function categoryStyle(cat?: string | null): { bg: string; color: string } {
  const c = (cat || "").toLowerCase();
  if (c.includes("rent")) return { bg: "rgba(59,130,246,0.2)", color: "#93c5fd" };
  if (c.includes("sale") || c.includes("sell")) return { bg: "rgba(34,197,94,0.18)", color: "#86efac" };
  return { bg: "rgba(148,163,184,0.15)", color: "var(--text-secondary)" };
}

export default function PropertyTable({
  data,
  agencyNames,
}: {
  data: Property[];
  agencyNames?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryTitle, setGalleryTitle] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);

  const [globalFilter, setGlobalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [bedroomsFilter, setBedroomsFilter] = useState("");
  const [localityFilter, setLocalityFilter] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minSqm, setMinSqm] = useState("");
  const [maxSqm, setMaxSqm] = useState("");
  const [furnishedFilter, setFurnishedFilter] = useState<"" | "furnished" | "unfurnished">("");
  const [sortMode, setSortMode] = useState<SortMode>("price_asc");

  const filtered = useMemo(() => {
    const minP = minPrice === "" ? null : parseFloat(minPrice);
    const maxP = maxPrice === "" ? null : parseFloat(maxPrice);
    const minS = minSqm === "" ? null : parseFloat(minSqm);
    const maxS = maxSqm === "" ? null : parseFloat(maxSqm);

    return data.filter((p) => {
      if (typeFilter && (p.property_type || "") !== typeFilter) return false;
      if (categoryFilter && (p.category || "") !== categoryFilter) return false;
      if (bedroomsFilter && String(p.bedrooms) !== bedroomsFilter) return false;
      if (localityFilter && !(p.locality ?? "").toLowerCase().includes(localityFilter.toLowerCase())) return false;
      if (minP != null && !Number.isNaN(minP) && (p.price == null || p.price < minP)) return false;
      if (maxP != null && !Number.isNaN(maxP) && (p.price == null || p.price > maxP)) return false;
      if (minS != null && !Number.isNaN(minS) && (p.total_sqm == null || p.total_sqm < minS)) return false;
      if (maxS != null && !Number.isNaN(maxS) && (p.total_sqm == null || p.total_sqm > maxS)) return false;

      if (furnishedFilter) {
        const fs = furnishedState(p);
        if (furnishedFilter === "furnished" && fs !== "furnished") return false;
        if (furnishedFilter === "unfurnished" && fs !== "unfurnished") return false;
      }

      if (globalFilter) {
        const q = globalFilter.toLowerCase();
        const hay = [
          p.title,
          p.property_type,
          p.category,
          p.locality,
          p.district,
          p.city,
          p.country,
          p.description,
          p.reference,
          p.listing_reference,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    data,
    typeFilter,
    categoryFilter,
    bedroomsFilter,
    localityFilter,
    globalFilter,
    minPrice,
    maxPrice,
    minSqm,
    maxSqm,
    furnishedFilter,
  ]);

  const sortedFiltered = useMemo(() => sortRows(filtered, sortMode), [filtered, sortMode]);

  const summaryStats = usePropertyStats(filtered);

  const avgPriceSqmForFiltered = useMemo(() => {
    const vals = filtered.map((p) => p.price_per_sqm).filter((v): v is number => v != null && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [filtered]);

  const columnCurrency =
    filtered.find((p) => p.currency)?.currency ?? data.find((p) => p.currency)?.currency ?? "EUR";

  const COLUMNS = useMemo(
    () => [
      col.display({
        id: "thumb",
        header: "",
        cell: ({ row }) => (
          <PropertyThumb images={row.original.images} listingUrl={row.original.listing_url} />
        ),
      }),
      col.accessor("title", {
        id: "listing",
        header: "Listing",
        cell: (info) => {
          const p = info.row.original;
          const desc = p.description?.replace(/\s+/g, " ").trim();
          const shortDesc = desc && desc.length > 220 ? `${desc.slice(0, 217)}…` : desc;
          const amen = p.amenities ?? [];
          const shown = amen.slice(0, 4);
          const rest = amen.length - shown.length;
          const ref = p.reference || p.listing_reference;
          const fs = furnishedState(p);
          const catStyle = categoryStyle(p.category);

          return (
            <div style={{ minWidth: 220, maxWidth: 380 }}>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fff", lineHeight: 1.35 }}>
                {info.getValue() ?? "Untitled listing"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
                {p.property_type && (
                  <span
                    className={`badge ${TYPE_BADGES[(p.property_type || "").toLowerCase()] ?? "badge-blue"}`}
                    style={{ fontSize: "0.62rem", fontWeight: 700 }}
                  >
                    {p.property_type}
                  </span>
                )}
                {p.category && (
                  <span
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: catStyle.bg,
                      color: catStyle.color,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {p.category}
                  </span>
                )}
              </div>
              {fs !== "unknown" && (
                <div style={{ marginTop: 6 }}>
                  <span
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "rgba(245,158,11,0.18)",
                      color: "#fcd34d",
                    }}
                  >
                    {fs === "furnished" ? "FURNISHED" : "UNFURNISHED"}
                  </span>
                </div>
              )}
              {ref && (
                <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                  Ref: {ref}
                </div>
              )}
              {shortDesc && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: "0.72rem",
                    color: "var(--text-muted)",
                    lineHeight: 1.45,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {shortDesc}
                </p>
              )}
              {shown.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {shown.map((a) => {
                    const ch = amenityChip(a);
                    return (
                      <span
                        key={a}
                        style={{
                          fontSize: "0.62rem",
                          padding: "3px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(148,163,184,0.25)",
                          background: "rgba(15,23,42,0.6)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {ch.emoji} {ch.label}
                      </span>
                    );
                  })}
                  {rest > 0 && (
                    <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", alignSelf: "center" }}>+{rest} more</span>
                  )}
                </div>
              )}
            </div>
          );
        },
      }),
      col.display({
        id: "beds_baths",
        header: "Beds / baths",
        cell: ({ row }) => {
          const p = row.original;
          const beds = p.bedrooms;
          const baths = p.bathroom_count;
          return (
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", minWidth: 100 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)", fontWeight: 600 }}>
                <Bed size={14} className="text-sky-400 shrink-0" />
                <span>{beds != null ? `${beds} beds` : <span style={{ color: "var(--text-muted)" }}>—</span>}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontWeight: 600 }}>
                <Bath size={14} className="text-sky-400 shrink-0" />
                <span style={{ color: "var(--text-primary)" }}>
                  {baths != null ? `${baths} bath${baths === 1 ? "" : "s"}` : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </span>
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 8, lineHeight: 1.45 }}>
                <div>
                  Beds: {p.bedroom_sqm != null ? `${fmtNum(p.bedroom_sqm, 1)} m²` : "—"}
                </div>
                <div>
                  Bath: {p.bathroom_sqm != null ? `${fmtNum(p.bathroom_sqm, 1)} m²` : "—"}
                </div>
              </div>
            </div>
          );
        },
      }),
      col.display({
        id: "areas",
        header: "Areas",
        cell: ({ row }) => {
          const p = row.original;
          const lines: { label: string; val: string; bold?: boolean }[] = [];
          if (p.total_sqm != null) lines.push({ label: "Total", val: `${fmtNum(p.total_sqm, 1)} m²`, bold: true });
          if (p.bedroom_sqm != null) lines.push({ label: "Bedrooms", val: `${fmtNum(p.bedroom_sqm, 1)} m²` });
          if (p.bathroom_sqm != null) lines.push({ label: "Bathrooms", val: `${fmtNum(p.bathroom_sqm, 1)} m²` });
          if (p.plot_sqm != null) lines.push({ label: "Plot", val: `${fmtNum(p.plot_sqm, 1)} m²` });
          if (p.floor_number != null) {
            const tf = p.total_floors != null ? ` of ${p.total_floors}` : "";
            lines.push({ label: "Floor", val: `${p.floor_number}${tf}` });
          }
          if (p.year_built != null) lines.push({ label: "Built", val: String(p.year_built) });
          if (!lines.length) {
            return <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>—</span>;
          }
          return (
            <div style={{ fontSize: "0.74rem", lineHeight: 1.55, minWidth: 108 }}>
              {lines.map((x) => (
                <div key={x.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>{x.label}</span>
                  <span
                    style={{
                      fontWeight: x.bold ? 800 : 600,
                      fontSize: x.bold ? "0.82rem" : "0.74rem",
                      color: "var(--text-primary)",
                    }}
                  >
                    {x.val}
                  </span>
                </div>
              ))}
            </div>
          );
        },
      }),
      col.display({
        id: "location",
        header: "Location",
        cell: ({ row }) => {
          const p = row.original;
          const agencyName = p.agency_id && agencyNames?.[p.agency_id];
          const maps =
            p.latitude != null && p.longitude != null
              ? `https://www.google.com/maps?q=${p.latitude},${p.longitude}`
              : null;
          return (
            <div style={{ minWidth: 150, maxWidth: 240 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <MapPin size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--accent-gold)" }} />
                <div>
                  <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>
                    {p.locality || "—"}
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 2 }}>
                    {[p.district, p.city].filter(Boolean).join(", ") || "—"}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 2 }}>{p.country || ""}</div>
                </div>
              </div>
              {p.agency_id && (
                <div style={{ marginTop: 8, fontSize: "0.72rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Agency: </span>
                  <Link
                    href={`/properties?agency_id=${p.agency_id}`}
                    style={{ color: "var(--accent-blue)", fontWeight: 600, textDecoration: "none" }}
                  >
                    {agencyName || "View listings"}
                  </Link>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: 8, alignItems: "center" }}>
                {maps && (
                  <a
                    href={maps}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.68rem",
                      color: "var(--accent-blue)",
                      textDecoration: "none",
                    }}
                  >
                    Map 🗺️ <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          );
        },
      }),
      col.display({
        id: "price_block",
        header: "Price",
        cell: ({ row }) => {
          const p = row.original;
          const money = fmtMoney(p.price, p.currency);
          if (!money) {
            return (
              <div style={{ fontStyle: "italic", color: "var(--text-muted)", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                Price on Request
              </div>
            );
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 120 }}>
              <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                {money}
              </span>
              <PricePerSqmHint value={p.price_per_sqm} avg={avgPriceSqmForFiltered} currency={p.currency} />
            </div>
          );
        },
      }),
      col.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const p = row.original;
          const title = p.title || "this listing";
          const loc = p.locality || p.city || "the area";
          const ariaMsg = `Tell me more about ${title} in ${loc}`;
          const hrefChat = `/chat?message=${encodeURIComponent(ariaMsg)}`;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
              {p.listing_url ? (
                <a
                  href={p.listing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-gray-300 transition-all hover:border-blue-400/60 hover:bg-blue-500/10 hover:text-white"
                >
                  <ExternalLink size={12} />
                  View Listing
                </a>
              ) : (
                <div className="group relative w-full">
                  <button
                    type="button"
                    disabled
                    className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-600"
                  >
                    <ExternalLink size={12} />
                    No URL
                  </button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-48 -translate-x-1/2 rounded-lg border border-white/10 bg-gray-900 p-2 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    URL not available. Re-scrape this agency to get direct listing links.
                    <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
              )}
              <Link
                href={hrefChat}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "0.4rem 0.65rem",
                  borderRadius: 8,
                  border: "1px solid rgba(212,175,55,0.45)",
                  background: "rgba(212,175,55,0.08)",
                  color: "var(--accent-gold)",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <MessageCircle size={14} />
                Ask ARIA
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  generateReport(p);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.375rem",
                  width: "100%",
                  padding: "0.375rem 0.75rem",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "rgb(209,213,219)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                📄 Report
              </button>
              {p.images && p.images.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGalleryImages(resolvePropertyImages(p.images, p.listing_url));
                    setGalleryTitle(p.title || "Property Photos");
                    setGalleryOpen(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.375rem",
                    width: "100%",
                    padding: "0.375rem 0.75rem",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "rgb(209,213,219)",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  📷 Photos ({p.images.length})
                </button>
              )}
            </div>
          );
        },
      }),
    ],
    [agencyNames, avgPriceSqmForFiltered],
  );

  const table = useReactTable({
    data: sortedFiltered,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  });

  function exportCSV() {
    const headers = [
      "Title",
      "Category",
      "Type",
      "Furnished",
      "Reference",
      "Description",
      "Bedrooms",
      "Bathrooms",
      "Bedroom m²",
      "Bathroom m²",
      "Total m²",
      "Plot m²",
      "Floor",
      "Year built",
      "Price",
      "Currency",
      "Price/m²",
      "Locality",
      "District",
      "City",
      "Country",
      "Latitude",
      "Longitude",
      "Listed",
      "Amenities",
      "Listing URL",
    ];
    const rows = filtered.map((p) => [
      p.title,
      p.category,
      p.property_type,
      furnishedState(p),
      p.reference || p.listing_reference,
      p.description,
      p.bedrooms,
      p.bathroom_count,
      p.bedroom_sqm,
      p.bathroom_sqm,
      p.total_sqm,
      p.plot_sqm,
      p.floor_number != null ? (p.total_floors != null ? `${p.floor_number}/${p.total_floors}` : String(p.floor_number)) : "",
      p.year_built,
      p.price,
      p.currency,
      p.price_per_sqm,
      p.locality,
      p.district,
      p.city,
      p.country,
      p.latitude,
      p.longitude,
      p.listing_date,
      p.amenities?.join("; "),
      p.listing_url,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "properties-export.csv";
    a.click();
  }

  const types = useMemo(() => [...new Set(data.map((p) => p.property_type).filter(Boolean))] as string[], [data]);
  const categories = useMemo(() => [...new Set(data.map((p) => p.category).filter(Boolean))] as string[], [data]);
  const bedOptions = useMemo(
    () => [...new Set(data.map((p) => p.bedrooms).filter((b) => b != null))].sort((a, b) => a! - b!),
    [data],
  );

  const inputStyle: CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-primary)",
    padding: "0.5rem 0.75rem",
    fontSize: "0.78rem",
  };

  const statCard = (label: string, value: string) => (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "#0f1728",
        padding: "0.65rem 0.85rem",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "var(--text-primary)", marginTop: 4 }}>{value}</div>
    </div>
  );

  const ppmDisplay =
    summaryStats.avgPriceSqm > 0
      ? `${currencyPrefix(columnCurrency)}${fmtNum(summaryStats.avgPriceSqm, summaryStats.avgPriceSqm >= 100 ? 0 : 2)} / m²`
      : "—";

  /** Summary avg €/m² vs row-level benchmark (same filtered set mean — shown as neutral gold). */
  const ppmStatColor =
    summaryStats.avgPriceSqm > 0 ? "var(--accent-gold)" : "var(--text-muted)";

  const commonTypeLabel =
    summaryStats.commonType !== "—"
      ? `${summaryStats.commonType} (${summaryStats.commonTypeCount})`
      : "—";

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  async function shareListing(url?: string | null) {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
    }
  }

  const generateReport = (property: Property) => {
    const agencyName = agencyNames?.[property.agency_id as string] || "Unknown Agency";

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Property Report — ${property.title || "Property"}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, sans-serif;
            color: #1a1a2e;
            padding: 40px;
            line-height: 1.6;
          }
          .header {
            background: #0a1628;
            color: white;
            padding: 30px;
            border-radius: 8px;
            margin-bottom: 24px;
          }
          .header h1 { font-size: 24px; margin-bottom: 4px; }
          .header p { color: #7eb8f7; font-size: 14px; }
          .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 12px;
            background: #dbeafe;
            color: #1d4ed8;
            margin-right: 6px;
            margin-bottom: 12px;
          }
          .badge.sale { background: #dcfce7; color: #166534; }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 24px;
          }
          .card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
          }
          .card-label {
            font-size: 11px;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }
          .card-value {
            font-size: 20px;
            font-weight: bold;
            color: #0a1628;
          }
          .price {
            font-size: 36px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 4px;
          }
          .price-sqm { font-size: 16px; color: #64748b; }
          h2 {
            font-size: 18px;
            color: #1B4F8A;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 8px;
            margin-bottom: 16px;
            margin-top: 24px;
          }
          .amenity {
            display: inline-block;
            padding: 4px 10px;
            background: #f1f5f9;
            border-radius: 4px;
            font-size: 13px;
            margin: 3px;
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            color: #94a3b8;
            font-size: 12px;
          }
          table { width: 100%; border-collapse: collapse; }
          th {
            background: #1B4F8A;
            color: white;
            padding: 10px;
            text-align: left;
            font-size: 13px;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 13px;
          }
          tr:nth-child(even) td { background: #f8fafc; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏡 Property Intelligence Report</h1>
          <p>Generated by ARIA — RE Intelligence Platform</p>
          <p style="margin-top:8px;color:#94a3b8;font-size:12px">
            ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <span class="badge">${(property.property_type || "property").toUpperCase()}</span>
        ${property.category ? `<span class="badge sale">${property.category.toUpperCase()}</span>` : ""}
        <h1 style="font-size:28px;margin-bottom:8px">${property.title || "Untitled Property"}</h1>
        <div class="price">${property.currency || "EUR"} ${property.price ? property.price.toLocaleString() : "Price on Request"}</div>
        ${property.price_per_sqm ? `<p class="price-sqm">${property.currency || "EUR"} ${property.price_per_sqm.toLocaleString()} per m²</p>` : ""}
        ${property.description ? `<p style="color:#475569;margin:16px 0">${property.description}</p>` : ""}

        <h2>Property Details</h2>
        <div class="grid">
          <div class="card"><div class="card-label">Bedrooms</div><div class="card-value">${property.bedrooms ?? "—"}${property.bedroom_sqm ? ` <span style="font-size:14px;color:#64748b">(${property.bedroom_sqm} m²)</span>` : ""}</div></div>
          <div class="card"><div class="card-label">Bathrooms</div><div class="card-value">${property.bathroom_count ?? "—"}${property.bathroom_sqm ? ` <span style="font-size:14px;color:#64748b">(${property.bathroom_sqm} m²)</span>` : ""}</div></div>
          <div class="card"><div class="card-label">Total Size</div><div class="card-value">${property.total_sqm ? `${property.total_sqm} m²` : "—"}</div></div>
          <div class="card"><div class="card-label">Plot Size</div><div class="card-value">${property.plot_sqm ? `${property.plot_sqm} m²` : "—"}</div></div>
          <div class="card"><div class="card-label">Floor</div><div class="card-value">${property.floor_number ?? "—"}${property.total_floors ? ` of ${property.total_floors}` : ""}</div></div>
          <div class="card"><div class="card-label">Year Built</div><div class="card-value">${property.year_built ?? "—"}</div></div>
        </div>

        <h2>Location</h2>
        <table>
          <tr><th>Locality</th><th>District</th><th>City</th><th>Country</th></tr>
          <tr><td>${property.locality || "—"}</td><td>${property.district || "—"}</td><td>${property.city || "—"}</td><td>${property.country || "—"}</td></tr>
        </table>
        ${property.full_address ? `<p style="margin-top:8px;color:#475569;font-size:13px">📍 ${property.full_address}</p>` : ""}
        ${property.amenities?.length ? `<h2>Amenities</h2><div>${property.amenities.map((a) => `<span class="amenity">${a}</span>`).join("")}</div>` : ""}

        <h2>Listed By</h2>
        <table>
          <tr><th>Agency</th><th>Listed Date</th><th>Reference</th></tr>
          <tr><td>${agencyName}</td><td>${property.listing_date || "—"}</td><td>${property.listing_reference || property.reference || "—"}</td></tr>
        </table>
        ${property.listing_url ? `<p style="margin-top:16px"><strong>Original Listing:</strong> <a href="${property.listing_url}" style="color:#2563eb">${property.listing_url}</a></p>` : ""}
        <div class="footer"><p>Generated by ARIA — RE Intelligence Platform</p><p style="margin-top:4px">Data sourced directly from agency websites</p></div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        setTimeout(() => printWindow.print(), 500);
      };
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {data.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.65rem",
          }}
        >
          {statCard("Total listings", String(filtered.length))}
          {statCard(
            "Avg price",
            summaryStats.avgPrice != null ? fmtMoney(summaryStats.avgPrice, columnCurrency) ?? "—" : "—",
          )}
          {statCard(
            "Price range",
            summaryStats.minPrice != null && summaryStats.maxPrice != null
              ? `${fmtMoney(summaryStats.minPrice, filtered[0]?.currency ?? data[0]?.currency) ?? "—"} – ${fmtMoney(summaryStats.maxPrice, filtered[0]?.currency ?? data[0]?.currency) ?? "—"}`
              : "—",
          )}
          {statCard("Avg size", summaryStats.avgSqm != null ? `${fmtNum(summaryStats.avgSqm, 1)} m²` : "—")}
          <div
            style={{
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "#0f1728",
              padding: "0.65rem 0.85rem",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Avg price/m²
            </div>
            <div style={{ fontSize: "0.92rem", fontWeight: 800, color: ppmStatColor, marginTop: 4 }}>{ppmDisplay}</div>
          </div>
          {statCard("Most common type", commonTypeLabel)}
        </div>
      )}

      <div
        className="card"
        style={{
          padding: "1rem",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "#0f1728",
          display: "flex",
          flexDirection: "column",
          gap: "0.65rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <LayoutGrid size={14} color="var(--accent-blue)" />
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.04em" }}>
            Filters & search
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            placeholder="Search title, type, category, location, description…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 220px", minWidth: 200 }}
          />
          <ThemeSelect
            value={typeFilter}
            onChange={setTypeFilter}
            minWidth={120}
            options={[
              { value: "", label: "All types" },
              ...types.map((t) => ({ value: t, label: t })),
            ]}
          />
          <ThemeSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            minWidth={130}
            options={[
              { value: "", label: "All categories" },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
          <ThemeSelect
            value={bedroomsFilter}
            onChange={setBedroomsFilter}
            minWidth={110}
            options={[
              { value: "", label: "Any beds" },
              ...bedOptions.map((b) => ({ value: String(b), label: `${b} bed${b !== 1 ? "s" : ""}` })),
            ]}
          />
          <ThemeSelect
            value={furnishedFilter}
            onChange={(v) => setFurnishedFilter(v as "" | "furnished" | "unfurnished")}
            minWidth={130}
            options={[
              { value: "", label: "All furnished" },
              { value: "furnished", label: "Furnished" },
              { value: "unfurnished", label: "Unfurnished" },
            ]}
          />
          <input
            placeholder="Locality"
            value={localityFilter}
            onChange={(e) => setLocalityFilter(e.target.value)}
            style={{ ...inputStyle, width: 130 }}
          />
          <input
            placeholder="Min price"
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            style={{ ...inputStyle, width: 100 }}
          />
          <input
            placeholder="Max price"
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            style={{ ...inputStyle, width: 100 }}
          />
          <input
            placeholder="Min m²"
            type="number"
            value={minSqm}
            onChange={(e) => setMinSqm(e.target.value)}
            style={{ ...inputStyle, width: 88 }}
          />
          <input
            placeholder="Max m²"
            type="number"
            value={maxSqm}
            onChange={(e) => setMaxSqm(e.target.value)}
            style={{ ...inputStyle, width: 88 }}
          />
          <ThemeSelect
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            minWidth={160}
            options={[
              { value: "price_asc", label: "Sort: Price ↑" },
              { value: "price_desc", label: "Sort: Price ↓" },
              { value: "size_asc", label: "Sort: Size ↑" },
              { value: "size_desc", label: "Sort: Size ↓" },
              { value: "ppm_asc", label: "Sort: Price/m² ↑" },
              { value: "ppm_desc", label: "Sort: Price/m² ↓" },
              { value: "date_asc", label: "Sort: Date ↑" },
              { value: "date_desc", label: "Sort: Date ↓" },
            ]}
          />
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setGlobalFilter("");
                setTypeFilter("");
                setCategoryFilter("");
                setBedroomsFilter("");
                setLocalityFilter("");
                setMinPrice("");
                setMaxPrice("");
                setMinSqm("");
                setMaxSqm("");
                setFurnishedFilter("");
                setSortMode("price_asc");
              }}
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Reset All Filters
            </button>
            <button
              type="button"
              onClick={exportCSV}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0.5rem 0.9rem",
                borderRadius: 8,
                background: "rgba(37,99,235,0.15)",
                border: "1px solid rgba(37,99,235,0.35)",
                color: "#dbeafe",
                fontSize: "0.78rem",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {avgPriceSqmForFiltered > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.7rem", alignItems: "center" }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Price / m² vs filtered avg:</span>
          <span style={{ color: "var(--green)" }}>● Below avg</span>
          <span style={{ color: "var(--amber)" }}>● Near avg</span>
          <span style={{ color: "var(--red)" }}>● Above avg</span>
          <span style={{ color: "var(--text-muted)" }}>
            (avg ≈ {currencyPrefix(columnCurrency)}
            {fmtNum(avgPriceSqmForFiltered, avgPriceSqmForFiltered >= 100 ? 0 : 2)} / m²)
          </span>
        </div>
      )}

      <div
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          borderRadius: 12,
          border: "1px solid var(--border)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          background: "#0a0f1a",
        }}
      >
        <table style={{ width: "max(100%, 1280px)", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{
                      background: "linear-gradient(180deg, rgba(26,39,68,0.95), rgba(15,23,42,0.98))",
                      padding: "0.85rem 0.9rem",
                      textAlign: "left",
                      color: "var(--text-secondary)",
                      fontWeight: 700,
                      fontSize: "0.68rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--border)",
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: "3.5rem", textAlign: "center", color: "var(--text-muted)" }}>
                  No properties match your filters
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => {
                const p = row.original;
                const isOpen = expanded[p.id] === true;
                return (
                  <Fragment key={row.id}>
                    <tr
                      style={{
                        background: idx % 2 === 0 ? "var(--bg-card)" : "var(--bg-row-alt)",
                        transition: "background 0.12s",
                        cursor: "pointer",
                      }}
                      onClick={() => toggleExpand(p.id)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(37,99,235,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = idx % 2 === 0 ? "var(--bg-card)" : "var(--bg-row-alt)";
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{
                            padding: "0.85rem 0.9rem",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            verticalAlign: "top",
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr style={{ background: idx % 2 === 0 ? "rgba(15,23,42,0.85)" : "rgba(10,15,26,0.92)" }}>
                        <td colSpan={COLUMNS.length} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                          <div
                            style={{
                              maxHeight: 2000,
                              overflow: "hidden",
                              transition: "opacity 0.25s ease",
                              opacity: 1,
                              padding: "1rem 1.15rem",
                            }}
                          >
                            <RowDetailPanel
                              property={p}
                              onGallery={() => {
                                setGalleryImages(resolvePropertyImages(p.images, p.listing_url));
                                setGalleryTitle(p.title || "Property Photos");
                                setGalleryOpen(true);
                              }}
                              onShare={() => shareListing(p.listing_url)}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
        Showing <strong style={{ color: "var(--text-secondary)" }}>{filtered.length}</strong> of {data.length} listings
      </p>

      {galleryOpen && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            className="flex items-center justify-between border-b border-white/10 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-white">{galleryTitle}</h3>
              <p className="text-sm text-gray-400">{galleryImages.length} photos</p>
            </div>
            <button
              onClick={() => setGalleryOpen(false)}
              className="flex h-10 w-10 items-center justify-center text-3xl leading-none text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {galleryImages.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-gray-500">
                <span className="mb-4 text-6xl">📷</span>
                <p>No photos available for this property</p>
                <p className="mt-2 text-sm">Photos will appear after re-scraping this agency</p>
              </div>
            ) : (
              <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 md:grid-cols-3">
                {galleryImages.map((src, idx) => (
                  <div
                    key={`${src}-${idx}`}
                    className="group relative aspect-video overflow-hidden rounded-lg bg-[#1a2744]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Photo ${idx + 1}`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        e.currentTarget.parentElement!.innerHTML = `
                          <div class="w-full h-full flex items-center justify-center text-gray-600 flex-col gap-2">
                            <span class="text-3xl">🏠</span>
                            <span class="text-xs">Image unavailable</span>
                          </div>`;
                      }}
                    />
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">
                        Open full size ↗
                      </span>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div
            className="border-t border-white/10 p-4 text-center text-sm text-gray-500"
            onClick={(e) => e.stopPropagation()}
          >
            Click outside to close · Click image to open full size
          </div>
        </div>
      )}
    </div>
  );
}

function RowDetailPanel({
  property: p,
  onGallery,
  onShare,
}: {
  property: Property;
  onGallery: () => void;
  onShare: () => void;
}) {
  const amen = p.amenities ?? [];
  const maps =
    p.latitude != null && p.longitude != null ? `https://maps.google.com/?q=${p.latitude},${p.longitude}` : null;
  const title = p.title || "Listing";
  const loc = p.locality || p.city || "the area";
  const ariaHref = `/chat?message=${encodeURIComponent(`Tell me more about ${title} in ${loc}`)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {p.images && p.images.length > 0 && (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
          {p.images.map((src, i) => {
            const abs = propertyImageSrc(src, p.listing_url);
            return (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onGallery();
                }}
                style={{
                  flex: "0 0 auto",
                  border: "none",
                  padding: 0,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer",
                  width: 160,
                  height: 110,
                  background: "#1a2744",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={abs} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            );
          })}
        </div>
      )}
      {p.description && (
        <div>
          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>Description</div>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {p.description}
          </p>
        </div>
      )}
      {amen.length > 0 && (
        <div>
          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>All amenities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {amen.map((a) => {
              const ch = amenityChip(a);
              return (
                <span
                  key={a}
                  style={{
                    fontSize: "0.72rem",
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.25)",
                    background: "rgba(15,23,42,0.6)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {ch.emoji} {a}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div
        style={{
          borderRadius: 10,
          border: "1px solid var(--border)",
          padding: "0.75rem 0.9rem",
          background: "rgba(10,15,26,0.6)",
          fontSize: "0.78rem",
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--accent-gold)", marginBottom: 10, fontSize: "0.72rem" }}>Property details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem 1rem" }}>
          <DetailKV label="Type" value={p.property_type} />
          <DetailKV label="Category" value={p.category} />
          <DetailKV label="Furnished" value={furnishedState(p) === "unknown" ? "—" : furnishedState(p)} />
          <DetailKV label="Condition" value={p.condition} />
          <DetailKV label="Floor" value={p.floor_number != null ? String(p.floor_number) : "—"} />
          <DetailKV label="Total floors" value={p.total_floors != null ? String(p.total_floors) : "—"} />
          <DetailKV label="Year built" value={p.year_built != null ? String(p.year_built) : "—"} />
          <DetailKV label="Energy rating" value={p.energy_rating} />
          <DetailKV label="Virtual tour" value={p.virtual_tour_url} link />
          <DetailKV label="Listed" value={p.listing_date ? String(p.listing_date) : "—"} />
          <DetailKV label="Reference" value={p.reference || p.listing_reference} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }} onClick={(e) => e.stopPropagation()}>
        {p.listing_url ? (
          <a
            href={p.listing_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0.45rem 0.85rem",
              borderRadius: 8,
              border: "1px solid rgba(59,130,246,0.55)",
              background: "rgba(37,99,235,0.12)",
              color: "#93c5fd",
              fontSize: "0.78rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <ExternalLink size={14} /> View full listing
          </a>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0.45rem 0.85rem",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.25)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text-muted)",
              fontSize: "0.78rem",
              fontWeight: 600,
              opacity: 0.65,
              cursor: "not-allowed",
            }}
          >
            <ExternalLink size={14} /> View full listing
          </span>
        )}
        <button
          type="button"
          onClick={onShare}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0.45rem 0.85rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text-secondary)",
            fontSize: "0.78rem",
            cursor: p.listing_url ? "pointer" : "not-allowed",
            opacity: p.listing_url ? 1 : 0.5,
          }}
          disabled={!p.listing_url}
        >
          <Share2 size={14} /> Share
        </button>
        <Link
          href={ariaHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0.45rem 0.85rem",
            borderRadius: 8,
            border: "1px solid rgba(212,175,55,0.45)",
            background: "rgba(212,175,55,0.08)",
            color: "var(--accent-gold)",
            fontSize: "0.78rem",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <MessageCircle size={14} /> Ask ARIA
        </Link>
        {maps && (
          <a
            href={maps}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0.45rem 0.85rem",
              borderRadius: 8,
              border: "1px solid rgba(34,197,94,0.35)",
              color: "#86efac",
              fontSize: "0.78rem",
              textDecoration: "none",
            }}
          >
            <MapPin size={14} /> Google Maps
          </a>
        )}
      </div>
    </div>
  );
}

function DetailKV({
  label,
  value,
  link,
}: {
  label: string;
  value?: string | null;
  link?: boolean;
}) {
  if (!value || value === "—") {
    return (
      <div>
        <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{label}</div>
        <div style={{ color: "var(--text-muted)" }}>—</div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{label}</div>
      {link ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)", wordBreak: "break-all" }}>
          {value}
        </a>
      ) : (
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{value}</div>
      )}
    </div>
  );
}
