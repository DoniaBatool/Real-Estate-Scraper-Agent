"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { scrapeCity, getJobStatus } from "@/lib/api";
import type { ScrapeJob } from "@/types";

export default function ScrapeForm() {
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || !country.trim()) return;
    setLoading(true);
    setError("");
    setJob(null);
    try {
      const newJob = await scrapeCity(city.trim(), country.trim());
      setJob(newJob);
      poll(newJob.job_id);
    } catch {
      setError("Failed to connect to backend. Is it running on port 8000?");
      setLoading(false);
    }
  }

  function poll(jobId: string) {
    const interval = setInterval(async () => {
      try {
        const updated = await getJobStatus(jobId);
        setJob(updated);
        if (updated.status === "complete" || updated.status === "failed") {
          clearInterval(interval);
          setLoading(false);
        }
      } catch {
        clearInterval(interval);
        setLoading(false);
      }
    }, 3000);
  }

  const progress =
    job && job.agencies_found > 0
      ? Math.round((job.agencies_scraped / job.agencies_found) * 100)
      : 0;

  return (
    <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.625rem" }}>
        <input
          type="text"
          placeholder="City  (e.g. Dubai)"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="input-dark"
          style={{ flex: 1 }}
        />
        <input
          type="text"
          placeholder="Country  (e.g. UAE)"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="input-dark"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0.625rem 1.25rem",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: loading ? "not-allowed" : "pointer",
            border: "none",
            background: loading
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #1d4ed8, #2563eb)",
            color: "#fff",
            whiteSpace: "nowrap",
            boxShadow: loading ? "none" : "0 0 16px rgba(37,99,235,0.35)",
            transition: "all 0.2s",
          }}
        >
          {loading ? (
            <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Search size={15} />
          )}
          Scrape
        </button>
      </form>

      {error && (
        <p style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--red)", textAlign: "center" }}>
          {error}
        </p>
      )}

      <AnimatePresence>
        {job && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              marginTop: "1rem",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "1rem 1.25rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {job.city}, {job.country}
              </span>
              <StatusPill status={job.status} />
            </div>

            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 10 }}>
              {job.message}
            </p>

            {/* Progress bar */}
            {job.agencies_found > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #1d4ed8, #60a5fa)",
                      borderRadius: 2,
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <span>Found: <strong style={{ color: "var(--accent-gold)" }}>{job.agencies_found}</strong></span>
              <span>Scraped: <strong style={{ color: "var(--accent-blue)" }}>{job.agencies_scraped}</strong></span>
              {job.agencies_found > 0 && (
                <span style={{ marginLeft: "auto", color: "var(--text-secondary)" }}>{progress}%</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
    queued:   { color: "#fbbf24", bg: "rgba(251,191,36,0.1)",   icon: <Loader2 size={10} /> },
    running:  { color: "#60a5fa", bg: "rgba(96,165,250,0.1)",   icon: <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> },
    complete: { color: "#4ade80", bg: "rgba(74,222,128,0.1)",   icon: <CheckCircle2 size={10} /> },
    failed:   { color: "#f87171", bg: "rgba(248,113,113,0.1)",  icon: <XCircle size={10} /> },
  };
  const c = config[status] ?? config.queued;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0.2rem 0.6rem",
        borderRadius: 999,
        fontSize: "0.7rem",
        fontWeight: 600,
        color: c.color,
        background: c.bg,
        textTransform: "capitalize",
      }}
    >
      {c.icon}
      {status}
    </span>
  );
}
