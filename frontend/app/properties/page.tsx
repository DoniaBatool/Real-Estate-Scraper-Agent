"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { getProperties } from "@/lib/api";
import type { Property } from "@/types";
import PropertyTable from "@/components/PropertyTable";
import { Loader2, TableProperties } from "lucide-react";

function PropertiesInner() {
  const searchParams = useSearchParams();
  const agencyId = searchParams.get("agency_id") ?? undefined;
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getProperties({ agency_id: agencyId, limit: 500 })
      .then(setProperties)
      .catch(() => setError("Failed to load properties"))
      .finally(() => setLoading(false));
  }, [agencyId]);

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "2.5rem 1.5rem" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <TableProperties size={18} color="var(--purple)" />
            <span style={{ fontSize: "0.7rem", color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
              Listings
            </span>
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Properties
          </h1>
          {properties.length > 0 && (
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 2 }}>
              {properties.length} listings indexed
            </p>
          )}
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

        {!loading && !error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <PropertyTable data={properties} />
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense>
      <PropertiesInner />
    </Suspense>
  );
}
