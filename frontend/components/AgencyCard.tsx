"use client";

import { useState } from "react";
import type { Agency } from "@/types";
import { Mail, Phone, MessageCircle, Globe, Star, User, ExternalLink, MoreVertical, Trash2 } from "lucide-react";
import Link from "next/link";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function StarRating({ rating, count }: { rating: number; count?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ display: "flex", gap: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={11}
            style={{
              fill: i < full ? "var(--accent-gold)" : i === full && half ? "var(--accent-gold)" : "transparent",
              color: i < full || (i === full && half) ? "var(--accent-gold)" : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent-gold)" }}>
        {rating.toFixed(1)}
      </span>
      {count != null && (
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>({count})</span>
      )}
    </div>
  );
}

const SPEC_COLORS: Record<string, string> = {
  residential: "badge-green",
  commercial: "badge-blue",
  luxury: "badge-gold",
};

const SOCIAL_LABELS: { key: keyof Agency; label: string; color: string }[] = [
  { key: "facebook_url", label: "FB", color: "#3b82f6" },
  { key: "instagram_url", label: "IG", color: "#ec4899" },
  { key: "linkedin_url", label: "LI", color: "#0ea5e9" },
  { key: "twitter_url", label: "X", color: "#94a3b8" },
];

const interactivePointer = { pointerEvents: "auto" as const };

export default function AgencyCard({
  agency,
  onRequestDelete,
}: {
  agency: Agency;
  onRequestDelete?: (agency: Agency) => void;
}) {
  const currency = agency.currency ?? "EUR";
  const targetHref = `/properties?agency_id=${encodeURIComponent(agency.id)}`;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="card card-hover gradient-border"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {/* Full-card navigation: sits under content; non-interactive areas click through */}
      <Link
        href={targetHref}
        aria-label={`View properties for ${agency.name}`}
        style={{ position: "absolute", inset: 0, zIndex: 1 }}
      />

      {onRequestDelete && (
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 4 }}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            style={{
              ...interactivePointer,
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "rgba(15,23,42,0.88)",
              color: "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              appearance: "none",
              WebkitAppearance: "none",
              outline: "none",
              boxShadow: "none",
            }}
            aria-label={`Open menu for ${agency.name}`}
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-card)",
                minWidth: 122,
                padding: 4,
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                zIndex: 10,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  onRequestDelete(agency);
                }}
                style={{
                  ...interactivePointer,
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: "none",
                  background: "transparent",
                  color: "#fda4af",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  padding: "0.35rem 0.45rem",
                  textAlign: "left",
                }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            height: 2,
            background: "linear-gradient(90deg, var(--accent-blue), var(--accent-gold))",
          }}
        />

        {/* Header */}
        <div style={{ padding: "1.25rem 1.25rem 1rem", display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
          {agency.logo_url ? (
            <img
              src={agency.logo_url}
              alt={agency.name}
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                objectFit: "cover",
                flexShrink: 0,
                border: "1px solid var(--border)",
                pointerEvents: "none",
              }}
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: "linear-gradient(135deg, #1d4ed8, #1e3a8a)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "#93c5fd",
                letterSpacing: "0.05em",
                pointerEvents: "none",
              }}
            >
              {initials(agency.name)}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                fontSize: "0.9rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                lineHeight: 1.3,
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agency.name}
            </h3>
            {(agency.city || agency.country) && (
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {[agency.city, agency.country].filter(Boolean).join(", ")}
              </p>
            )}
            {agency.google_rating != null && (
              <div style={{ marginTop: 4 }}>
                <StarRating rating={agency.google_rating} count={agency.review_count ?? undefined} />
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, padding: "0 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {agency.owner_name && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <User size={12} color="var(--text-muted)" />
              <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{agency.owner_name}</span>
              {agency.founded_year && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: 4 }}>
                  est. {agency.founded_year}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {agency.email?.[0] && (
              <a
                href={`mailto:${agency.email[0]}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  ...interactivePointer,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "0.72rem",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "0.2rem 0.5rem",
                  transition: "border-color 0.15s",
                }}
              >
                <Mail size={10} color="var(--accent-blue)" />
                {agency.email[0].length > 22 ? agency.email[0].slice(0, 20) + "…" : agency.email[0]}
              </a>
            )}
            {agency.phone?.[0] && (
              <a
                href={`tel:${agency.phone[0]}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  ...interactivePointer,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "0.72rem",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "0.2rem 0.5rem",
                }}
              >
                <Phone size={10} color="var(--accent-blue)" />
                {agency.phone[0]}
              </a>
            )}
            {agency.whatsapp && (
              <a
                href={`https://wa.me/${agency.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  ...interactivePointer,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "0.72rem",
                  color: "#4ade80",
                  textDecoration: "none",
                  background: "rgba(74,222,128,0.08)",
                  border: "1px solid rgba(74,222,128,0.2)",
                  borderRadius: 6,
                  padding: "0.2rem 0.5rem",
                }}
              >
                <MessageCircle size={10} />
                WhatsApp
              </a>
            )}
          </div>

          {SOCIAL_LABELS.some((s) => agency[s.key]) && (
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {SOCIAL_LABELS.filter((s) => agency[s.key]).map((s) => (
                <a
                  key={s.key}
                  href={agency[s.key] as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    ...interactivePointer,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: `${s.color}18`,
                    border: `1px solid ${s.color}30`,
                    color: s.color,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    textDecoration: "none",
                    transition: "all 0.15s",
                  }}
                >
                  {s.label}
                </a>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "center" }}>
            {agency.specialization && (
              <span className={`badge ${SPEC_COLORS[agency.specialization.toLowerCase()] ?? "badge-blue"}`}>
                {agency.specialization}
              </span>
            )}
            {agency.total_listings != null && (
              <span className="badge badge-blue">{agency.total_listings} listings</span>
            )}
            {agency.price_range_min != null && agency.price_range_max != null && (
              <span className="badge badge-gold">
                {currency} {(agency.price_range_min / 1000).toFixed(0)}k–{(agency.price_range_max / 1000).toFixed(0)}k
              </span>
            )}
          </div>

          {agency.property_categories && agency.property_categories.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {agency.property_categories.slice(0, 6).map((c) => (
                <span key={c} className="badge badge-blue" style={{ fontSize: "0.62rem", fontWeight: 600 }}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            margin: "1rem 1.25rem 0",
            paddingTop: "0.875rem",
            paddingBottom: "1.25rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}
        >
          <a
            href={agency.website_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              ...interactivePointer,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.72rem",
              color: "var(--text-muted)",
              textDecoration: "none",
              overflow: "hidden",
              maxWidth: 140,
            }}
          >
            <Globe size={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agency.website_url.replace(/^https?:\/\//, "")}
            </span>
            <ExternalLink size={9} style={{ flexShrink: 0 }} />
          </a>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "0.375rem 0.75rem",
              borderRadius: 6,
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent-blue)",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
              boxShadow: "0 0 10px rgba(37,99,235,0.25)",
            }}
          >
            View Properties
          </span>
        </div>
      </div>
    </div>
  );
}
