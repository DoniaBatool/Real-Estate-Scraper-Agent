"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { getPricingData, getProperties } from "@/lib/api";
import type { PricingData, Property } from "@/types";
import PricingChart from "@/components/PricingChart";
import { Loader2, TrendingUp, Filter, ChevronDown } from "lucide-react";

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
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const active = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} style={{ position: "relative", minWidth }}>
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
        <span>{active?.label}</span>
        <ChevronDown size={14} color="var(--text-muted)" />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "100%",
            maxHeight: 250,
            overflowY: "auto",
            zIndex: 40,
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "#0f1728",
            boxShadow: "0 14px 34px rgba(0,0,0,0.42)",
            padding: 4,
          }}
        >
          {options.map((o) => {
            const isActive = o.value === value;
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
                  color: isActive ? "#dbeafe" : "var(--text-secondary)",
                  background: isActive ? "rgba(37,99,235,0.2)" : "transparent",
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

export default function PricingPage() {
  const [data, setData] = useState<PricingData | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");

  const loadPricing = async () => {
    const payload = {
      city: city.trim() || undefined,
      country: country.trim() || undefined,
      category: category || undefined,
    };
    const next = await getPricingData(payload);
    setData(next);
  };

  useEffect(() => {
    Promise.all([
      getPricingData(),
      // Pull enough rows to build filter option lists.
      (async () => {
        const limit = 200;
        let page = 1;
        const all: Property[] = [];
        while (true) {
          const chunk = await getProperties({ page, limit });
          all.push(...chunk);
          if (chunk.length < limit) break;
          page += 1;
        }
        return all;
      })(),
    ])
      .then(([pricing, props]) => {
        setData(pricing);
        setProperties(props);
      })
      .catch(() => setError("Failed to load pricing data"))
      .finally(() => setLoading(false));
  }, []);

  const normalizePlace = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const dedupePlace = (values: string[]) => {
    const m = new Map<string, string>();
    for (const raw of values) {
      const v = raw.trim();
      if (!v) continue;
      const key = normalizePlace(v);
      if (!key) continue;
      if (!m.has(key)) m.set(key, v);
    }
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  };

  const countryOptions = useMemo(
    () => dedupePlace(properties.map((p) => p.country || "")),
    [properties],
  );
  const cityOptions = useMemo(() => {
    const rows = properties.filter((p) =>
      country ? (p.country || "").toLowerCase().includes(country.toLowerCase()) : true,
    );
    return dedupePlace(rows.map((p) => p.city || ""));
  }, [properties, country]);
  const categoryOptions = useMemo(
    () => {
      const fromRows = [
        ...new Set(
          properties
            .flatMap((p) => [p.category?.trim(), p.property_type?.trim()])
            .filter(Boolean) as string[],
        ),
      ];
      const normalized = new Set(fromRows.map((x) => x.toLowerCase()));
      if (!normalized.has("bungalow")) fromRows.push("bungalow");
      return fromRows.sort((a, b) => a.localeCompare(b));
    },
    [properties],
  );

  const inputStyle: CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-primary)",
    padding: "0.5rem 0.75rem",
    fontSize: "0.78rem",
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "2.5rem 1.5rem" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <TrendingUp size={18} color="var(--accent-gold)" />
            <span style={{ fontSize: "0.7rem", color: "var(--accent-gold)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
              Market Analysis
            </span>
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Pricing Intelligence
          </h1>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 2 }}>
            Live market aggregations from scraped data
          </p>
        </div>

        <div style={{ height: 1, background: "var(--border)", marginBottom: "2rem" }} />

        {!loading && (
          <div
            className="card"
            style={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: "0.9rem",
              marginBottom: "1.1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.65rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Filter size={14} color="var(--accent-blue)" />
              <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, letterSpacing: "0.04em" }}>
                Filter analytics scope
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <ThemeSelect
                value={country}
                onChange={setCountry}
                minWidth={145}
                options={[{ value: "", label: "All countries" }, ...countryOptions.map((x) => ({ value: x, label: x }))]}
              />
              <ThemeSelect
                value={city}
                onChange={setCity}
                minWidth={140}
                options={[{ value: "", label: "All cities" }, ...cityOptions.map((x) => ({ value: x, label: x }))]}
              />
              <ThemeSelect
                value={category}
                onChange={setCategory}
                minWidth={120}
                options={[{ value: "", label: "All categories" }, ...categoryOptions.map((x) => ({ value: x, label: x }))]}
              />
              <button
                type="button"
                onClick={() => void loadPricing()}
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(37,99,235,0.45)",
                  background: "rgba(37,99,235,0.2)",
                  color: "#dbeafe",
                  padding: "0.5rem 0.85rem",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Apply Filters
              </button>
              <button
                type="button"
                onClick={() => {
                  setCountry("");
                  setCity("");
                  setCategory("");
                  void getPricingData().then(setData).catch(() => setError("Failed to load pricing data"));
                }}
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.76rem",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "5rem 0" }}>
            <Loader2 size={28} color="var(--accent-blue)" style={{ animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--red)", fontSize: "0.9rem" }}>{error}</div>
        )}

        {!loading && !error && data && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <PricingChart data={data} />
          </motion.div>
        )}
      </div>
    </div>
  );
}
