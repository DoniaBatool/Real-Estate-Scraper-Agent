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
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

function PropertyThumb({ images }: { images?: string[] }) {
  const [imgError, setImgError] = useState(false);
  const [hover, setHover] = useState(false);
  const first = images?.[0];
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
      {images && images.length > 1 && (
        <span className="mt-1 block text-center text-xs text-gray-400">📷 {images.length}</span>
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

function GalleryModal({
  open,
  title,
  images,
  onClose,
}: {
  open: boolean;
  title: string;
  images: string[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Image gallery"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(10,15,26,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        style={{
          maxWidth: 900,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          padding: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.9rem" }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-secondary)",
              padding: "0.35rem 0.65rem",
              cursor: "pointer",
              fontSize: "0.75rem",
            }}
          >
            Close
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.5rem",
          }}
        >
          {images.map((src, i) => (
            <div key={`${src}-${i}`} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", aspectRatio: "4/3", background: "#1a2744" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      </div>
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
  const [gallery, setGallery] = useState<{ title: string; images: string[] } | null>(null);

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
        cell: ({ row }) => <PropertyThumb images={row.original.images} />,
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
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "0.4rem 0.65rem",
                    borderRadius: 8,
                    border: "1px solid rgba(59,130,246,0.55)",
                    background: "rgba(37,99,235,0.12)",
                    color: "#93c5fd",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <ExternalLink size={14} />
                  View Listing
                </a>
              ) : (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "0.4rem 0.65rem",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.25)",
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--text-muted)",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    opacity: 0.65,
                    cursor: "not-allowed",
                  }}
                >
                  <ExternalLink size={14} />
                  View Listing
                </span>
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
              <a
                href={`${API_BASE}/api/properties/${p.id}/report`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "0.4rem 0.65rem",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-secondary)",
                  fontSize: "0.72rem",
                  textDecoration: "none",
                }}
              >
                📄 Report
              </a>
              {p.images && p.images.length > 1 && (
                <button
                  type="button"
                  onClick={() => setGallery({ title: p.title || "Listing", images: p.images || [] })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "0.4rem 0.65rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--text-secondary)",
                    fontSize: "0.72rem",
                    cursor: "pointer",
                  }}
                >
                  Photos ({p.images.length})
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <GalleryModal
        open={gallery != null}
        title={gallery?.title ?? ""}
        images={gallery?.images ?? []}
        onClose={() => setGallery(null)}
      />

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
                              onGallery={() => setGallery({ title: p.title || "Listing", images: p.images || [] })}
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
          {p.images.map((src, i) => (
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
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
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
