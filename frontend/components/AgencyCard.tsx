import type { Agency } from "@/types";
import { Mail, Phone, MessageCircle, Globe, Star, Building2, User, ExternalLink } from "lucide-react";
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

export default function AgencyCard({ agency }: { agency: Agency }) {
  const currency = agency.currency ?? "EUR";

  return (
    <div
      className="card card-hover gradient-border"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
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
        {/* Avatar */}
        {agency.logo_url ? (
          <img
            src={agency.logo_url}
            alt={agency.name}
            style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
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
        {/* Owner */}
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

        {/* Contact */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {agency.email?.[0] && (
            <a
              href={`mailto:${agency.email[0]}`}
              style={{
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
              style={{
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
              style={{
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

        {/* Socials */}
        {SOCIAL_LABELS.some((s) => agency[s.key]) && (
          <div style={{ display: "flex", gap: "0.375rem" }}>
            {SOCIAL_LABELS.filter((s) => agency[s.key]).map((s) => (
              <a
                key={s.key}
                href={agency[s.key] as string}
                target="_blank"
                rel="noopener noreferrer"
                style={{
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

        {/* Business info */}
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
          style={{
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

        <Link
          href={`/properties?agency_id=${agency.id}`}
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
            textDecoration: "none",
            whiteSpace: "nowrap",
            transition: "all 0.15s",
            boxShadow: "0 0 10px rgba(37,99,235,0.25)",
          }}
        >
          View Properties
        </Link>
      </div>
    </div>
  );
}
