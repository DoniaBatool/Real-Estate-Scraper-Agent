"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { getAgencies, getAgency, getProperties } from "@/lib/api";
import type { Property } from "@/types";
import PropertyTable from "@/components/PropertyTable";
import { Loader2, TableProperties } from "lucide-react";

function PropertiesInner() {
  const searchParams = useSearchParams();
  const agencyId = searchParams.get("agency_id") ?? undefined;
  const [properties, setProperties] = useState<Property[]>([]);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!agencyId) {
      setAgencyName(null);
      return;
    }
    void getAgency(agencyId)
      .then((a) => setAgencyName(a.name))
      .catch(() => setAgencyName(null));
  }, [agencyId]);

  useEffect(() => {
    getProperties({ agency_id: agencyId, limit: 200 })
      .then(setProperties)
      .catch(() => setError("Failed to load properties"))
      .finally(() => setLoading(false));
  }, [agencyId]);

  useEffect(() => {
    void getAgencies({ limit: 500 })
      .then((list) => {
        const m: Record<string, string> = {};
        for (const a of list) m[a.id] = a.name;
        setAgencyNames(m);
      })
      .catch(() => setAgencyNames({}));
  }, []);

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
          {agencyId && agencyName && (
            <p style={{ fontSize: "0.85rem", color: "var(--accent-gold)", marginTop: 6, fontWeight: 600 }}>
              {agencyName}
            </p>
          )}
          {properties.length > 0 && (
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: agencyId && agencyName ? 4 : 2 }}>
              {properties.length} listings indexed
              {agencyId ? " for this agency" : " in the database"}
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
            <PropertyTable data={properties} agencyNames={agencyNames} />
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
