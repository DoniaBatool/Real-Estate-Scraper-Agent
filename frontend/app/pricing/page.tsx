"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getPricingData } from "@/lib/api";
import type { PricingData } from "@/types";
import PricingChart from "@/components/PricingChart";
import { Loader2, TrendingUp } from "lucide-react";

export default function PricingPage() {
  const [data, setData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPricingData()
      .then(setData)
      .catch(() => setError("Failed to load pricing data"))
      .finally(() => setLoading(false));
  }, []);

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
