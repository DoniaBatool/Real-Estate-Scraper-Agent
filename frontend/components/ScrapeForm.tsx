"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, MapPin, Home } from "lucide-react";

const QUICK_EXAMPLES = [
  { label: "Dubai Villas", city: "Dubai", country: "UAE", type: "villa" },
  { label: "Valletta Apartments", city: "Valletta", country: "Malta", type: "apartment" },
  { label: "London Rentals", city: "London", country: "UK", type: "any" },
];

export default function ScrapeForm() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  function buildQuery(c: string, co: string, type = "any") {
    if (type !== "any") {
      return `Find ${type}s for sale or rent in ${c}, ${co}`;
    }
    return `Show me properties in ${c}, ${co}`;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || !country.trim()) return;
    const q = encodeURIComponent(buildQuery(city.trim(), country.trim()));
    router.push(`/chat?message=${q}`);
  }

  function handleExample(ex: (typeof QUICK_EXAMPLES)[number]) {
    const q = encodeURIComponent(buildQuery(ex.city, ex.country, ex.type));
    router.push(`/chat?message=${q}`);
  }

  return (
    <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.625rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "0 0.75rem",
          }}
        >
          <MapPin size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="City (e.g. Dubai)"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "0.875rem",
              padding: "0.625rem 0",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "0 0.75rem",
          }}
        >
          <Home size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Country (e.g. UAE)"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "0.875rem",
              padding: "0.625rem 0",
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0.625rem 1.25rem",
            borderRadius: 10,
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
            border: "none",
            background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
            color: "#fff",
            whiteSpace: "nowrap",
            boxShadow: "0 0 16px rgba(37,99,235,0.4)",
            transition: "all 0.2s",
          }}
        >
          <Sparkles size={14} />
          Ask ARIA
        </button>
      </form>

      {/* Quick examples */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginTop: "0.75rem",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {QUICK_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => handleExample(ex)}
            style={{
              padding: "0.3rem 0.75rem",
              borderRadius: 999,
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = "rgba(37,99,235,0.5)";
              (e.target as HTMLButtonElement).style.color = "#93c5fd";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
              (e.target as HTMLButtonElement).style.color = "var(--text-secondary)";
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}
