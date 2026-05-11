"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import * as XLSX from "xlsx";

const PRIORITY_KEYS = [
  "reference_number",
  "reference",
  "title",
  "subtitle",
  "property_type",
  "category",
  "status",
  "badge",
  "furnished",
  "condition",
  "price",
  "price_text",
  "currency",
  "price_per_sqm",
  "bedrooms",
  "bathrooms",
  "internal_sqm",
  "external_sqm",
  "total_sqm",
  "plot_sqm",
  "floor_number",
  "total_floors",
  "year_built",
  "locality",
  "town",
  "region",
  "country",
  "full_address",
  "latitude",
  "longitude",
  "description",
  "features",
  "amenities",
  "energy_rating",
  "permit_number",
  "agent_name",
  "agent_phone",
  "agent_email",
  "agency_name",
  "all_images",
  "floor_plan_url",
  "virtual_tour_url",
  "video_url",
  "listing_date",
  "last_updated",
  "listing_url",
  "_source_url",
  "_scraped_at",
  "company_name",
  "owner_name",
  "founded_year",
  "address",
  "phone",
  "email",
  "whatsapp",
  "facebook_url",
  "instagram_url",
  "linkedin_url",
  "twitter_url",
  "opening_hours",
  "services",
  "team_members",
];

function headerLabel(key: string): string {
  return key
    .replace(/^_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function buildSmartColumns(data: Record<string, unknown>[]) {
  if (!data.length) return [];

  const keySet = new Set<string>();
  data.forEach((row) => {
    Object.keys(row).forEach((k) => keySet.add(k));
  });

  const priorityKeys = PRIORITY_KEYS.filter((k) => keySet.has(k));
  const otherKeys = [...keySet].filter((k) => !PRIORITY_KEYS.includes(k)).sort();
  const allKeys = [...priorityKeys, ...otherKeys];

  const columnHelper = createColumnHelper<Record<string, unknown>>();

  return allKeys.map((key) => {
    const header = headerLabel(key);

    return columnHelper.accessor(
      (row) => row[key],
      {
        id: key,
        header,
        cell: (info) => {
          const val = info.getValue();
          if (val === null || val === undefined) {
            return <span className="text-gray-600">—</span>;
          }

          if (key === "all_images" && Array.isArray(val)) {
            const urls = val.filter((u): u is string => typeof u === "string");
            return (
              <div className="flex items-center gap-1">
                {urls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urls[0]}
                    alt=""
                    className="h-9 w-12 rounded object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <span className="text-xs text-gray-400">📷 {urls.length}</span>
              </div>
            );
          }

          if (Array.isArray(val)) {
            const parts = val.map((x) => String(x));
            return (
              <div className="max-w-[200px]">
                <span className="text-xs text-gray-300">
                  {parts.slice(0, 3).join(", ")}
                  {parts.length > 3 ? ` +${parts.length - 3} more` : ""}
                </span>
              </div>
            );
          }

          if (typeof val === "string" && val.startsWith("http")) {
            if (key === "listing_url" || key === "_source_url" || key === "source_url") {
              return (
                <a
                  href={val}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 underline hover:text-blue-300"
                  onClick={(e) => e.stopPropagation()}
                >
                  View ↗
                </a>
              );
            }
            return (
              <span className="block max-w-[100px] truncate text-xs text-gray-400">
                {val.split("/").pop()}
              </span>
            );
          }

          if (key === "price" && typeof val === "number") {
            return <span className="font-semibold text-blue-400">€{val.toLocaleString()}</span>;
          }

          if (key === "bedrooms") return <span>🛏 {String(val)}</span>;
          if (key === "bathrooms") return <span>🚿 {String(val)}</span>;

          if (key.includes("sqm") && val !== "" && val != null) {
            return <span>{String(val)} m²</span>;
          }

          if (key === "status" && typeof val === "string") {
            const lower = val.toLowerCase();
            const color = lower.includes("market")
              ? "text-green-400 bg-green-400/10"
              : lower.includes("sold")
                ? "text-red-400 bg-red-400/10"
                : "text-gray-400 bg-gray-400/10";
            return (
              <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{val}</span>
            );
          }

          if (typeof val === "boolean") {
            return val ? (
              <span className="text-green-400">✓</span>
            ) : (
              <span className="text-red-400">✗</span>
            );
          }

          if (typeof val === "string" && val.length > 100) {
            return (
              <div className="group relative max-w-[250px]">
                <span className="line-clamp-2 text-xs text-gray-300">{val}</span>
                <div className="absolute left-0 top-0 z-50 hidden max-w-sm rounded border border-gray-600 bg-gray-800 p-2 text-xs text-gray-200 shadow-xl group-hover:block">
                  {val}
                </div>
              </div>
            );
          }

          return <span className="text-xs text-gray-300">{String(val)}</span>;
        },
        size:
          key.includes("description") ? 300 : key.includes("url") ? 80 : key.includes("image") ? 100 : 150,
      },
    );
  });
}

export function ComprehensiveExtractTable({
  data,
  onSelectionChange,
}: {
  data: Record<string, unknown>[];
  onSelectionChange: (selected: Record<string, unknown>[]) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const dataColumns = useMemo(() => buildSmartColumns(data), [data]);

  const columns = useMemo(() => {
    const selectionCol: ColumnDef<Record<string, unknown>> = {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          className="h-4 w-4 accent-blue-500"
          aria-label="Select all rows"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 accent-blue-500"
          aria-label="Select row"
        />
      ),
      size: 40,
      enableSorting: false,
      enableHiding: false,
    };

    return [selectionCol, ...dataColumns];
  }, [dataColumns]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: true,
    getRowId: (_row, index) => String(index),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue ?? "").trim().toLowerCase();
      if (!q) return true;
      return JSON.stringify(row.original).toLowerCase().includes(q);
    },
  });

  useEffect(() => {
    const sel = Object.keys(rowSelection)
      .filter((id) => rowSelection[id])
      .map((id) => data[Number(id)])
      .filter((r): r is Record<string, unknown> => r != null);
    onSelectionChange(sel);
  }, [rowSelection, data, onSelectionChange]);

  const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={globalFilter ?? ""}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search all columns..."
          className="w-64 rounded-lg border border-white/10 bg-[#1a2744] px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-sm text-gray-400">
          {table.getFilteredRowModel().rows.length} rows
          {selectedCount > 0 ? (
            <span className="ml-2 text-blue-400">· {selectedCount} selected</span>
          ) : null}
        </span>

        <div className="group relative">
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-[#1a2744] px-3 py-1.5 text-sm text-gray-300"
          >
            Columns ({table.getAllColumns().filter((c) => c.getIsVisible()).length})
          </button>
          <div className="absolute left-0 top-full z-50 mt-1 hidden max-h-64 w-48 overflow-y-auto rounded-lg border border-white/10 bg-[#0f1728] p-3 group-hover:block">
            {table
              .getAllColumns()
              .filter((c) => c.id !== "select")
              .map((col) => (
                <label
                  key={col.id}
                  className="flex cursor-pointer items-center gap-2 py-1 text-xs text-gray-300 hover:text-white"
                >
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                    className="accent-blue-500"
                  />
                  {col.id.replace(/_/g, " ")}
                </label>
              ))}
          </div>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#1a2744]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="cursor-pointer select-none whitespace-nowrap border-b border-white/10 px-3 py-2 text-left text-xs font-medium text-gray-400 hover:text-white"
                    style={{ minWidth: header.column.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc" ? " ↑" : null}
                    {header.column.getIsSorted() === "desc" ? " ↓" : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={`cursor-pointer border-b border-white/5 transition-colors ${
                  row.getIsSelected()
                    ? "border-blue-500/20 bg-blue-500/10"
                    : i % 2 === 0
                      ? "bg-[#0a0f1a]"
                      : "bg-[#0f1320]"
                } hover:bg-blue-500/5`}
                onClick={() => row.toggleSelected()}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="align-top px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {table.getRowModel().rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">No data extracted yet</div>
        ) : null}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportWorkbenchExtractedData(
  data: Record<string, unknown>[],
  format: "csv" | "json" | "excel",
) {
  if (!data.length) return;

  const allKeys = [...new Set(data.flatMap((r) => Object.keys(r)))];

  if (format === "json") {
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      "extracted_data.json",
    );
    return;
  }

  if (format === "csv") {
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return `"${String(v.join("; ")).replace(/"/g, '""')}"`;
      const str = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(str) ? `"${str}"` : str;
    };
    const header = allKeys.join(",");
    const rows = data.map((row) => allKeys.map((k) => esc(row[k])).join(","));
    downloadBlob(new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" }), "extracted_data.csv");
    return;
  }

  if (format === "excel") {
    const wb = XLSX.utils.book_new();

    const wsData: unknown[][] = [
      allKeys.map((k) => headerLabel(k)),
      ...data.map((row) =>
        allKeys.map((k) => {
          const val = row[k];
          if (val === null || val === undefined) return "";
          if (Array.isArray(val)) return val.join("; ");
          return val as string | number | boolean;
        }),
      ),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = allKeys.map((k) => ({
      wch: Math.min(
        Math.max(
          k.length + 2,
          ...data.map((r) => {
            const v = r[k];
            if (v == null) return 5;
            if (Array.isArray(v)) return 20;
            return Math.min(String(v).length, 50);
          }),
        ),
        60,
      ),
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Extracted Data");

    const imageRows = data
      .filter((r) => Array.isArray(r.all_images) && (r.all_images as unknown[]).length)
      .map((r) => {
        const imgs = r.all_images as string[];
        const row: Record<string, unknown> = {
          reference: r.reference_number ?? r.reference ?? "",
          title: r.title ?? "",
          image_count: imgs.length,
        };
        imgs.forEach((url, i) => {
          row[`image_${i + 1}_url`] = url;
        });
        return row;
      });

    if (imageRows.length) {
      const wsImg = XLSX.utils.json_to_sheet(imageRows);
      XLSX.utils.book_append_sheet(wb, wsImg, "Images");
    }

    XLSX.writeFile(wb, "extracted_data.xlsx");
  }
}

/** Toolbar block: title + export buttons (optional wrapper styles). */
export function ExtractedDataToolbar({
  rowCount,
  children,
}: {
  rowCount: number;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-white">
        Extracted Data{" "}
        <span className="ml-2 text-sm font-normal text-gray-400">({rowCount} pages)</span>
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export const extractToolbarButtonGreen: CSSProperties = {
  padding: "0.35rem 0.75rem",
  borderRadius: 8,
  border: "1px solid rgba(34, 197, 94, 0.4)",
  background: "rgba(34, 197, 94, 0.2)",
  color: "#4ade80",
  fontSize: "0.875rem",
  cursor: "pointer",
};

export const extractToolbarButtonBlue: CSSProperties = {
  padding: "0.35rem 0.75rem",
  borderRadius: 8,
  border: "1px solid rgba(59, 130, 246, 0.4)",
  background: "rgba(59, 130, 246, 0.2)",
  color: "#60a5fa",
  fontSize: "0.875rem",
  cursor: "pointer",
};

export const extractToolbarButtonPurple: CSSProperties = {
  padding: "0.35rem 0.75rem",
  borderRadius: 8,
  border: "1px solid rgba(168, 85, 247, 0.4)",
  background: "rgba(168, 85, 247, 0.2)",
  color: "#c084fc",
  fontSize: "0.875rem",
  cursor: "pointer",
};
