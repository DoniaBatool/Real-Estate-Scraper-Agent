"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { deleteAgency, getAgencies } from "@/lib/api";
import type { Agency, AgencyFilters } from "@/types";
import AgencyCard from "@/components/AgencyCard";
import { Loader2, Building2 } from "lucide-react";

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<AgencyFilters>({ page: 1, limit: 50 });
  const [deleteTarget, setDeleteTarget] = useState<Agency | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getAgencies(filters)
      .then(setAgencies)
      .catch(() => setError("Failed to load agencies"))
      .finally(() => setLoading(false));
  }, [filters]);

  const inputStyle: CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-primary)",
    padding: "0.5rem 0.875rem",
    fontSize: "0.8rem",
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteAgency(deleteTarget.id);
      setAgencies((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setError("Failed to delete agency");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "2.5rem 1.5rem" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "2rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Building2 size={18} color="var(--accent-gold)" />
              <span style={{ fontSize: "0.7rem", color: "var(--accent-gold)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                Directory
              </span>
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Agencies
            </h1>
            {agencies.length > 0 && (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 2 }}>
                {agencies.length} agencies found
              </p>
            )}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <input
              placeholder="Search name…"
              onChange={(e) => {
                setLoading(true);
                setFilters((f) => ({ ...f, search: e.target.value, page: 1 }));
              }}
              style={inputStyle}
            />
            <input
              placeholder="City"
              onChange={(e) => {
                setLoading(true);
                setFilters((f) => ({ ...f, city: e.target.value, page: 1 }));
              }}
              style={{ ...inputStyle, width: 120 }}
            />
            <input
              placeholder="Country"
              onChange={(e) => {
                setLoading(true);
                setFilters((f) => ({ ...f, country: e.target.value, page: 1 }));
              }}
              style={{ ...inputStyle, width: 120 }}
            />
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border)", marginBottom: "2rem" }} />

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "5rem 0" }}>
            <Loader2 size={28} color="var(--accent-blue)" style={{ animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--red)", fontSize: "0.9rem" }}>
            {error}
          </div>
        )}

        {!loading && !error && agencies.length === 0 && (
          <div style={{ padding: "5rem 0", textAlign: "center" }}>
            <Building2 size={40} color="var(--text-muted)" style={{ margin: "0 auto 1rem" }} />
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              No agencies yet — run a scrape job from the home page.
            </p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.25rem" }}>
          {agencies.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              style={{ position: "relative" }}
            >
              <AgencyCard agency={a} onRequestDelete={setDeleteTarget} />
            </motion.div>
          ))}
        </div>
      </div>
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
            background: "rgba(2,6,23,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="card gradient-border"
            style={{
              width: "min(460px, 100%)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: "1rem 1rem 0.9rem",
              background: "var(--bg-card)",
            }}
          >
            <h3 style={{ color: "var(--text-primary)", fontSize: "1rem", fontWeight: 700, marginBottom: 8 }}>
              Delete Agency
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.86rem", lineHeight: 1.55 }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This will remove the agency and all
              related properties from the database.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-secondary)",
                  padding: "0.45rem 0.9rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.15)",
                  color: "#fda4af",
                  padding: "0.45rem 0.9rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {deleting ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
