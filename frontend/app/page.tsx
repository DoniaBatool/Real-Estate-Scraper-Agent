"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Building2, TableProperties, TrendingUp, Globe, Zap, Shield } from "lucide-react";
import ScrapeForm from "@/components/ScrapeForm";
import { getPricingData } from "@/lib/api";

function StatCounter({ value, label }: { value: number; label: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (value === 0) return;
    const step = Math.ceil(value / 40);
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + step, value);
      setCount(current);
      if (current >= value) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [value]);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--accent-gold)", letterSpacing: "-0.02em" }}>
        {count}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: <Building2 size={22} />,
    label: "Agency Cards",
    desc: "Browse agencies with contacts, ratings, social links and specialization.",
    href: "/agencies",
    color: "var(--accent-blue)",
  },
  {
    icon: <TableProperties size={22} />,
    label: "Property Table",
    desc: "Sort and filter every listing by price, sqm, type, locality.",
    href: "/properties",
    color: "var(--purple)",
  },
  {
    icon: <TrendingUp size={22} />,
    label: "Pricing Intelligence",
    desc: "Live charts: avg price/m², type ranges, scatter plots, bedrooms curve.",
    href: "/pricing",
    color: "var(--accent-gold)",
  },
];

const PILLARS = [
  { icon: <Globe size={16} />, text: "Any city · any country" },
  { icon: <Zap size={16} />, text: "AI-extracted structured data" },
  { icon: <Shield size={16} />, text: "Anti-detection scraping" },
];

export default function Home() {
  const [stats, setStats] = useState({ agencies: 0, properties: 0 });

  useEffect(() => {
    getPricingData()
      .then((d) => setStats({
        agencies: d.summary.total_agencies,
        properties: d.summary.total_properties,
      }))
      .catch(() => null);
  }, []);

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)" }}>
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "5rem 1.5rem 4rem",
          textAlign: "center",
        }}
      >
        {/* Background glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "-20%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 800,
            height: 400,
            background: "radial-gradient(ellipse, rgba(37,99,235,0.12) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Eyebrow */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(226,181,90,0.08)",
              border: "1px solid rgba(226,181,90,0.2)",
              borderRadius: 999,
              padding: "0.25rem 0.875rem",
              fontSize: "0.7rem",
              fontWeight: 600,
              color: "var(--accent-gold)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "1.5rem",
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-gold)" }} />
            AI-Powered Real Estate Intelligence
          </div>

          <h1
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              color: "var(--text-primary)",
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              maxWidth: 700,
              margin: "0 auto 1.25rem",
            }}
          >
            Real Estate{" "}
            <span
              style={{
                background: "linear-gradient(90deg, #2563eb, #60a5fa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Intelligence
            </span>
          </h1>

          <p
            style={{
              fontSize: "1.05rem",
              color: "var(--text-secondary)",
              maxWidth: 520,
              margin: "0 auto 1rem",
              lineHeight: 1.7,
            }}
          >
            Enter any city and country. Our AI discovers every agency, scrapes their website,
            and delivers structured data — contacts, listings, and pricing — instantly.
          </p>

          {/* Pillars */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: "1.5rem",
              marginBottom: "2.5rem",
            }}
          >
            {PILLARS.map((p) => (
              <div key={p.text} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--accent-blue)" }}>{p.icon}</span>
                {p.text}
              </div>
            ))}
          </div>

          <ScrapeForm />
        </motion.div>
      </section>

      {/* Stats */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 1.5rem 3rem",
        }}
      >
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "1.5rem 2rem",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
          }}
        >
          <StatCounter value={stats.agencies} label="Agencies Scraped" />
          <div style={{ width: 1, background: "var(--border)", margin: "auto" }} />
          <StatCounter value={stats.properties} label="Properties Indexed" />
        </div>
      </motion.section>

      {/* Feature cards */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.5rem 5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.href}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
            >
              <Link href={f.href} style={{ textDecoration: "none", display: "block" }}>
                <div
                  className="card card-hover gradient-border"
                  style={{ padding: "1.75rem", height: "100%", cursor: "pointer" }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: `${f.color}18`,
                      border: `1px solid ${f.color}30`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: f.color,
                      marginBottom: "1.25rem",
                    }}
                  >
                    {f.icon}
                  </div>
                  <h3
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {f.label}
                  </h3>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {f.desc}
                  </p>
                  <div style={{ marginTop: "1.25rem" }} className="gold-divider" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
