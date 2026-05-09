"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { PricingData } from "@/types";
import type { TooltipProps } from "recharts";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, LineChart, Line, CartesianGrid, Legend,
  Cell,
} from "recharts";

interface Props { data: PricingData }

const COLORS = {
  blue:   "#2563eb",
  gold:   "#e2b55a",
  teal:   "#2dd4bf",
  purple: "#a78bfa",
  green:  "#22c55e",
};

const CHART_BG = "var(--bg-card)";
const GRID_COLOR = "rgba(255,255,255,0.05)";
const AXIS_COLOR = "#cbd5e1";

const tooltipStyle: CSSProperties = {
  background: "#0f1728",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#f8fafc",
  fontSize: 12,
  boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
};

/** Recharts sometimes ignores `color` on wrapper — force label/item text for contrast. */
const tooltipLabelStyle: CSSProperties = {
  color: "#cbd5e1",
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 4,
};

const tooltipItemStyle: CSSProperties = {
  color: "#f8fafc",
  fontSize: 13,
  fontWeight: 600,
};

type ScatterRow = { total_sqm: number; price: number; property_type?: string };

function ScatterSqmPriceTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ScatterRow;
  const sqm = row.total_sqm;
  const price = row.price;
  return (
    <div
      style={{
        ...tooltipStyle,
        padding: "10px 14px",
        minWidth: 160,
      }}
    >
      <p style={{ ...tooltipLabelStyle, marginBottom: 8 }}>Property point</p>
      <p style={{ ...tooltipItemStyle, margin: "4px 0" }}>
        Total m²:{" "}
        <span style={{ color: "#e2e8f0" }}>
          {sqm != null && typeof sqm === "number" ? sqm.toLocaleString() : String(sqm ?? "—")}
        </span>
      </p>
      <p style={{ ...tooltipItemStyle, margin: "4px 0 0" }}>
        Price:{" "}
        <span style={{ color: "#e2e8f0" }}>
          €{price != null && typeof price === "number" ? price.toLocaleString() : String(price ?? "—")}
        </span>
      </p>
      {row.property_type ? (
        <p style={{ color: "#94a3b8", fontSize: 11, marginTop: 8 }}>{row.property_type}</p>
      ) : null}
    </div>
  );
}

function ChartCard({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: CHART_BG,
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${accent}, transparent)`,
        }}
      />
      <div style={{ padding: "1.25rem 1.5rem" }}>
        <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "1.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
      No data yet — run a scrape job first.
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div style={{ height: 3, background: accent }} />
      <div style={{ padding: "1.25rem 1.5rem" }}>
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          {label}
        </p>
        <p style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function PricingChart({ data }: Props) {
  const { avg_price_by_locality, price_range_by_type, sqm_vs_price, bedrooms_vs_avg_price, summary } = data;

  /** Numeric X order so the scatter reads left-to-right by size (not raw row order). */
  const sqmVsPriceSorted = useMemo(
    () => [...sqm_vs_price].sort((a, b) => (Number(a.total_sqm) || 0) - (Number(b.total_sqm) || 0)),
    [sqm_vs_price],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        <SummaryCard label="Total Agencies" value={String(summary.total_agencies)} accent={COLORS.blue} />
        <SummaryCard label="Total Properties" value={String(summary.total_properties)} accent={COLORS.gold} />
        <SummaryCard label="Cheapest Locality" value={summary.cheapest_locality ?? "—"} accent={COLORS.green} />
        <SummaryCard label="Most Expensive" value={summary.most_expensive_locality ?? "—"} accent={COLORS.purple} />
      </div>

      {/* Row 1 — two charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "1.25rem" }}>
        {/* Bar — avg price/sqm by locality */}
        <ChartCard title="Avg Price / m² by Locality" accent={COLORS.blue}>
          {avg_price_by_locality.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={avg_price_by_locality} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="locality" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={8} />
                <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={6} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => [`€${v.toLocaleString()}`, "Avg €/m²"]}
                  cursor={{ fill: "rgba(37,99,235,0.08)" }}
                />
                <Bar dataKey="avg_price_sqm" radius={[6, 6, 0, 0]}>
                  {avg_price_by_locality.map((_, i) => (
                    <Cell key={i} fill={i % 2 === 0 ? COLORS.blue : COLORS.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Grouped bar — price range by type */}
        <ChartCard title="Price Range by Property Type" accent={COLORS.gold}>
          {price_range_by_type.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={price_range_by_type}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="type" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={8} />
                <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={6} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => `€${v.toLocaleString()}`}
                  cursor={{ fill: "rgba(226,181,90,0.06)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />
                <Bar dataKey="min" name="Min" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
                <Bar dataKey="avg" name="Avg" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="max" name="Max" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "1.25rem" }}>
        {/* Scatter — sqm vs price */}
        <ChartCard title="Total m² vs Price" accent={COLORS.purple}>
          {sqm_vs_price.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                <XAxis
                  type="number"
                  dataKey="total_sqm"
                  name="m²"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  label={{ value: "Total m²", position: "insideBottom", offset: -2, fill: AXIS_COLOR, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="price"
                  name="Price"
                  domain={["auto", "auto"]}
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={6}
                  tickFormatter={(v) => (typeof v === "number" ? v.toLocaleString() : String(v))}
                  label={{ value: "Price", angle: -90, position: "insideLeft", fill: AXIS_COLOR, fontSize: 11 }}
                />
                <Tooltip content={<ScatterSqmPriceTooltip />} cursor={{ stroke: "rgba(167,139,250,0.45)", strokeWidth: 1 }} />
                <Scatter data={sqmVsPriceSorted} fill={COLORS.purple} opacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Line — bedrooms vs avg price */}
        <ChartCard title="Bedrooms vs Avg Price" accent={COLORS.teal}>
          {bedrooms_vs_avg_price.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={bedrooms_vs_avg_price}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="bedrooms" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={8} />
                <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={6} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={(v: number) => [`€${v.toLocaleString()}`, "Avg Price"]}
                />
                <Line type="monotone" dataKey="avg_price" stroke={COLORS.teal} strokeWidth={2.5} dot={{ r: 5, fill: COLORS.teal, strokeWidth: 0 }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
