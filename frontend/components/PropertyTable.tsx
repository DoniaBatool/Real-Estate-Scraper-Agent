"use client";

import { useState, useMemo, type CSSProperties } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import type { Property } from "@/types";
import { ArrowUp, ArrowDown, ArrowUpDown, Download } from "lucide-react";

const col = createColumnHelper<Property>();

function fmt(n?: number | null, dec = 0) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: dec });
}

const TYPE_COLORS: Record<string, string> = {
  apartment: "badge-blue",
  villa: "badge-gold",
  townhouse: "badge-purple",
  commercial: "badge-teal",
  land: "badge-green",
};

function PricePerSqm({ value, avg }: { value?: number | null; avg: number }) {
  if (value == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const color =
    value < avg * 0.9 ? "var(--green)" : value > avg * 1.1 ? "var(--red)" : "var(--amber)";
  return (
    <span style={{ color, fontWeight: 700, fontSize: "0.8rem" }}>
      €{fmt(value)}
    </span>
  );
}

export default function PropertyTable({ data }: { data: Property[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [bedroomsFilter, setBedroomsFilter] = useState("");
  const [localityFilter, setLocalityFilter] = useState("");

  const avgPriceSqm = useMemo(() => {
    const vals = data.map((p) => p.price_per_sqm).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [data]);

  const filtered = useMemo(() => {
    return data.filter((p) => {
      if (typeFilter && p.property_type !== typeFilter) return false;
      if (bedroomsFilter && String(p.bedrooms) !== bedroomsFilter) return false;
      if (localityFilter && !(p.locality ?? "").toLowerCase().includes(localityFilter.toLowerCase())) return false;
      if (globalFilter) {
        const q = globalFilter.toLowerCase();
        if (!(p.title ?? "").toLowerCase().includes(q) && !(p.locality ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, typeFilter, bedroomsFilter, localityFilter, globalFilter]);

  const COLUMNS = useMemo(() => [
    col.accessor("title", {
      header: "Property",
      cell: (info) => (
        <div style={{ minWidth: 180 }}>
          <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.3 }}>
            {info.getValue() ?? "—"}
          </div>
          {info.row.original.property_type && (
            <span className={`badge ${TYPE_COLORS[info.row.original.property_type] ?? "badge-blue"}`} style={{ marginTop: 3 }}>
              {info.row.original.property_type}
            </span>
          )}
        </div>
      ),
    }),
    col.accessor("bedrooms", {
      header: "Beds / Baths",
      cell: (info) => (
        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
          {info.getValue() != null ? `${info.getValue()} 🛏` : "—"}
          {info.row.original.bathroom_count != null ? ` / ${info.row.original.bathroom_count} 🚿` : ""}
        </span>
      ),
    }),
    col.accessor("total_sqm", {
      header: "Total m²",
      cell: (info) => (
        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{fmt(info.getValue())}</span>
      ),
    }),
    col.accessor("price", {
      header: "Price",
      cell: (info) => (
        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-primary)" }}>
          {info.getValue() != null ? `€${fmt(info.getValue())}` : "—"}
        </span>
      ),
    }),
    col.accessor("price_per_sqm", {
      header: "€ / m²",
      cell: (info) => <PricePerSqm value={info.getValue()} avg={avgPriceSqm} />,
    }),
    col.accessor("locality", {
      header: "Location",
      cell: (info) => (
        <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          {info.getValue() ?? "—"}
          {info.row.original.district ? `, ${info.row.original.district}` : ""}
        </span>
      ),
    }),
    col.accessor("listing_date", {
      header: "Listed",
      cell: (info) => (
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{info.getValue() ?? "—"}</span>
      ),
    }),
  ], [avgPriceSqm]);

  const table = useReactTable({
    data: filtered,
    columns: COLUMNS,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function exportCSV() {
    const headers = ["Title", "Type", "Beds", "Baths", "Total m²", "Price", "€/m²", "Locality", "District", "Listed"];
    const rows = filtered.map((p) => [
      p.title ?? "", p.property_type ?? "", p.bedrooms ?? "", p.bathroom_count ?? "",
      p.total_sqm ?? "", p.price ?? "", p.price_per_sqm ?? "", p.locality ?? "", p.district ?? "", p.listing_date ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(String).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "properties.csv";
    a.click();
  }

  const types = useMemo(() => [...new Set(data.map((p) => p.property_type).filter(Boolean))], [data]);
  const bedOptions = useMemo(() =>
    [...new Set(data.map((p) => p.bedrooms).filter((b) => b != null))].sort((a, b) => a! - b!), [data]);

  const inputStyle: CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-primary)",
    padding: "0.5rem 0.875rem",
    fontSize: "0.8rem",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Filter bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.625rem", alignItems: "center" }}>
        <input
          placeholder="Search title or locality…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 200 }}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}>
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t!}>{t}</option>)}
        </select>
        <select value={bedroomsFilter} onChange={(e) => setBedroomsFilter(e.target.value)} style={inputStyle}>
          <option value="">Any beds</option>
          {bedOptions.map((b) => <option key={b} value={String(b)}>{b} bed{b !== 1 ? "s" : ""}</option>)}
        </select>
        <input
          placeholder="Locality…"
          value={localityFilter}
          onChange={(e) => setLocalityFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 140 }}
        />
        <button
          onClick={exportCSV}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0.5rem 0.875rem",
            borderRadius: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: "0.8rem",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <Download size={13} />
          CSV
        </button>
      </div>

      {/* Legend */}
      {avgPriceSqm > 0 && (
        <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem" }}>
          <span style={{ color: "var(--green)" }}>● Below avg</span>
          <span style={{ color: "var(--amber)" }}>● Near avg</span>
          <span style={{ color: "var(--red)" }}>● Above avg</span>
          <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
            (avg €/m² = {fmt(avgPriceSqm)})
          </span>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        background: "var(--bg-header)",
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        color: sorted ? "var(--accent-blue)" : "var(--text-secondary)",
                        fontWeight: 600,
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        borderBottom: "1px solid var(--border)",
                        userSelect: "none",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? <ArrowUp size={11} /> : sorted === "desc" ? <ArrowDown size={11} /> : <ArrowUpDown size={11} style={{ opacity: 0.3 }} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}
                >
                  No properties found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  style={{
                    background: idx % 2 === 0 ? "var(--bg-card)" : "var(--bg-row-alt)",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-header)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "var(--bg-card)" : "var(--bg-row-alt)")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0.75rem 1rem",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                        verticalAlign: "middle",
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
        {filtered.length} properties
      </p>
    </div>
  );
}
