"use client";

import {
  FormEvent, Suspense, useCallback, useEffect, useMemo,
  useRef, useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot, ExternalLink, Globe, Loader2, Mic, MicOff,
  MoreVertical, Pencil, Plus, Send, Trash2, User, X,
} from "lucide-react";
import {
  clearAllChatThreads, createChatThread, deleteChatThread,
  listChatMessages, listChatThreads, sendThreadMessage, updateChatThread,
  deleteChatMessage,
  API_BASE_URL,
} from "@/lib/api";
import type { ChatMessage, ChatThread } from "@/types";

// ── Photo Lightbox ─────────────────────────────────────────────────────────

function PhotoLightbox({ images, startIndex, onClose }: {
  images: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx(i => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft")  setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [images.length, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(0,0,0,0.92)", backdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}
    >
      {/* Close button */}
      <button onClick={onClose} style={{
        position: "absolute", top: 16, right: 20, background: "none", border: "none",
        color: "#fff", fontSize: 28, cursor: "pointer", lineHeight: 1, zIndex: 2,
      }}>✕</button>

      {/* Counter */}
      <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)",
        color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>
        {idx + 1} / {images.length}
      </div>

      {/* Main image */}
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "80vh", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[idx]}
          alt={`Photo ${idx + 1}`}
          style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 8, display: "block" }}
        />
      </div>

      {/* Prev / Next arrows */}
      {idx > 0 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => i - 1); }} style={{
          position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
          background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
          fontSize: 24, width: 44, height: 44, borderRadius: "50%", cursor: "pointer",
        }}>‹</button>
      )}
      {idx < images.length - 1 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => i + 1); }} style={{
          position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
          background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
          fontSize: 24, width: 44, height: 44, borderRadius: "50%", cursor: "pointer",
        }}>›</button>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div onClick={e => e.stopPropagation()} style={{
          position: "absolute", bottom: 16, display: "flex", gap: 6,
          overflowX: "auto", maxWidth: "90vw", padding: "4px 8px",
        }}>
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`thumb ${i+1}`}
              onClick={() => setIdx(i)}
              style={{
                width: 60, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0,
                cursor: "pointer", opacity: i === idx ? 1 : 0.5,
                border: i === idx ? "2px solid #f59e0b" : "2px solid transparent",
                transition: "opacity 0.15s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Toast notification ─────────────────────────────────────────────────────

type ToastType = "error" | "success" | "info";

interface Toast { id: number; msg: string; type: ToastType; }

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 80, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "0.75rem 1rem",
          borderRadius: 10,
          background: t.type === "error" ? "rgba(220,38,38,0.15)" : t.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(37,99,235,0.15)",
          border: `1px solid ${t.type === "error" ? "rgba(220,38,38,0.4)" : t.type === "success" ? "rgba(16,185,129,0.4)" : "rgba(37,99,235,0.4)"}`,
          color: "var(--text-primary)",
          fontSize: "0.82rem",
          maxWidth: 340,
          backdropFilter: "blur(8px)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}>
          <span>{t.type === "error" ? "⚠️" : t.type === "success" ? "✅" : "ℹ️"}</span>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <button onClick={() => onRemove(t.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

interface LiveProperty {
  title?: string;
  property_type?: string;
  category?: string;
  price?: number;
  currency?: string;
  bedrooms?: number;
  bathrooms?: number;
  total_sqm?: number;
  locality?: string;
  city?: string;
  country?: string;
  full_address?: string;
  description?: string;
  listing_url?: string;
  images?: string[];
  amenities?: string[];
  furnished?: string;
  floor_number?: number;
  features?: string[];      // detail page: "AC: Yes", "Lift: Yes", etc.
  agency_name?: string;
  agency_website?: string;
  agent_name?: string;
  agent_title?: string;
  agent_phone?: string;
  agent_whatsapp?: string;
  agent_email?: string;
  page_screenshot?: string;
  carousel_screenshots?: string[];
}

// ── Image proxy helper ─────────────────────────────────────────────────────
// Routes S3 / protected images through our server-side proxy so the browser
// never hits the protected bucket directly.
function proxyImg(src: string, referer?: string): string {
  if (!src) return "";
  // data URLs (base64 screenshots) pass through directly
  if (src.startsWith("data:")) return src;
  // Already proxied
  if (src.startsWith("/api/proxy-image")) return src;
  const encoded = encodeURIComponent(src);
  const refParam = referer ? `&ref=${encodeURIComponent(referer)}` : "";
  return `/api/proxy-image?url=${encoded}${refParam}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatThreadTime(iso: string): string {
  try {
    // Ensure the string is treated as UTC — append Z if no timezone info present
    const normalized = /[Zz]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "Z";
    const d   = new Date(normalized);
    const now = new Date();

    // Use browser locale for time (respects user's system clock & timezone)
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Compare local calendar date strings (locale-aware, handles DST correctly)
    const sameDay  =
      d.toLocaleDateString() === now.toLocaleDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.toLocaleDateString() === yesterday.toLocaleDateString();

    if (sameDay) {
      // Today → "28 May · 15:44"  (date + time so user always sees both)
      const dateStr = d.toLocaleDateString([], { day: "numeric", month: "short" });
      return `${dateStr} · ${timeStr}`;
    }
    if (isYesterday) {
      return `Yesterday · ${timeStr}`;
    }
    if (d.getFullYear() === now.getFullYear()) {
      // Same year → "28 May · 15:44"
      const dateStr = d.toLocaleDateString([], { day: "numeric", month: "short" });
      return `${dateStr} · ${timeStr}`;
    }
    // Older → "28 May 2024"
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// ── Suggestion chips ───────────────────────────────────────────────────────

const ARIA_SUGGESTIONS = [
  "Find 2-bedroom apartments for rent in Valletta, Malta 🏡",
  "Show me villas for sale in Dubai under €800k 🌴",
  "Scrape this website: https://maltapark.com",
  "Is Lisbon, Portugal a good investment right now? 📊",
  "Find studios for rent in Barcelona, Spain 🇪🇸",
  "Compare 3-bed apartments vs villas in Malta 🤝",
];

// ── Typing status labels ───────────────────────────────────────────────────

const TYPING_BY_ACTION: Record<string, string> = {
  conversation:              "ARIA is responding...",
  live_search_properties:    "🌐 ARIA is browsing agency websites live...",
  scrape_website:            "🔗 ARIA is visiting that website...",
  find_agencies:             "🏢 ARIA is discovering agencies...",
  web_search:                "🔎 ARIA is searching the web...",
  compare_properties:        "📊 ARIA is comparing properties...",
  market_insights:           "💡 ARIA is analyzing the market...",
  investment_calculator:     "📈 ARIA is calculating investment returns...",
  currency_converter:        "💱 ARIA is converting currency...",
  get_property_details:      "🏠 ARIA is fetching full property details...",
};

const CYCLING_STATUS = [
  "🌐 Browsing agency websites...",
  "🔍 Extracting property listings...",
  "🧠 Processing with AI...",
  "📋 Organizing results...",
];

function inferTypingAction(text: string): string {
  const msg = text.toLowerCase();
  if (["thanks", "hi", "hello", "hey", "how are", "great"].some(w => msg.includes(w)) && msg.length < 80)
    return "conversation";
  if (msg.includes("http") || msg.includes("www.") || msg.includes("scrape this"))
    return "scrape_website";
  if (["market", "invest", "trend", "news", "expensive", "cheap"].some(w => msg.includes(w)))
    return "market_insights";
  if (["compare", "vs ", "versus", "better", "difference"].some(w => msg.includes(w)))
    return "compare_properties";
  return "live_search_properties";
}

// ── Property card component ────────────────────────────────────────────────

function PropertyCard({ p, onMoreDetails, onToast }: {
  p: LiveProperty;
  onMoreDetails?: (p: LiveProperty) => void;
  onToast?: (msg: string, type?: ToastType) => void;
}) {
  const [lightbox, setLightbox] = useState<{ images: string[]; start: number } | null>(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const agencyWebsite = p.agency_website || "";

  // Base64 screenshots — always reliable, no CORS/403 issues
  const carouselShots = (p.carousel_screenshots || [])
    .filter(s => s && s.startsWith("data:image/"));
  const pageShot = (p.page_screenshot || "").startsWith("data:image/") ? p.page_screenshot! : "";

  // URL-based images — proxy through server to bypass CORS/referer restrictions
  const validImages = (p.images || [])
    .filter(u => u && (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")))
    .map(u => proxyImg(u, agencyWebsite));

  // Gallery: screenshots first (guaranteed), then any data: URL images
  const allGalleryImages = [
    ...carouselShots,
    ...(pageShot && !carouselShots.includes(pageShot) ? [pageShot] : []),
    ...validImages.filter(u => !carouselShots.includes(u)),
  ].filter(Boolean);

  const heroImage = allGalleryImages[Math.min(heroIdx, allGalleryImages.length - 1)] || "";

  function handleExportPdf() {
    // Pure frontend PDF — opens a styled print page, no backend dependency.
    // User clicks "Save as PDF" in the browser's print dialog.
    const currency = p.currency || "EUR";
    const priceStr = p.price ? `${currency} ${Number(p.price).toLocaleString()}` : "Price on Request";
    const cat = (p.category || "").toUpperCase();
    const ptype = (p.property_type || "Property");

    // Make image URL absolute so it works inside a blob:// page
    // Proxy paths like /api/proxy-image?... need the full origin prefix.
    // data: URLs (base64 screenshots) work as-is.
    const absoluteImg = (src: string) => {
      if (!src) return "";
      if (src.startsWith("data:")) return src;
      if (src.startsWith("/")) return `${window.location.origin}${src}`;
      return src;
    };
    const imgSrcAbs = absoluteImg(heroImage);
    const imgHtml = imgSrcAbs ? `<img src="${imgSrcAbs}" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px;margin-bottom:20px" crossorigin="anonymous" />` : "";
    const amenitiesHtml = (p.amenities || []).length
      ? `<div class="section"><h2>Amenities</h2><div class="tags">${(p.amenities || []).map(a => `<span class="tag">${a}</span>`).join("")}</div></div>` : "";
    const agentHtml = (p.agent_name || p.agent_phone || p.agent_email)
      ? `<div class="section"><h2>Agent Contact</h2>
          ${p.agent_name ? `<p><strong>Name:</strong> ${p.agent_name}</p>` : ""}
          ${p.agent_title ? `<p><strong>Title:</strong> ${p.agent_title}</p>` : ""}
          ${p.agent_phone ? `<p><strong>Phone:</strong> ${p.agent_phone}</p>` : ""}
          ${p.agent_email ? `<p><strong>Email:</strong> ${p.agent_email}</p>` : ""}
         </div>` : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ARIA Report — ${p.title || "Property"}</title>
<style>
  @media print { body { margin: 0; } }
  body { font-family: Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 32px; max-width: 800px; margin: 0 auto; }
  .header { background: #0a1628; color: white; padding: 24px 28px; border-radius: 8px; margin-bottom: 24px; }
  .header h1 { margin: 0 0 4px; font-size: 22px; color: #f59e0b; }
  .header p { margin: 0; color: #7eb8f7; font-size: 13px; }
  .badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700; margin-right:6px; }
  .badge-sale { background:#dbeafe; color:#1d4ed8; }
  .badge-rent { background:#dcfce7; color:#166534; }
  .title { font-size:26px; font-weight:bold; margin:12px 0 4px; }
  .price { font-size:30px; font-weight:bold; color:#2563eb; margin:0 0 16px; }
  .section { margin-bottom:20px; }
  .section h2 { font-size:14px; font-weight:700; color:#1B4F8A; border-bottom:2px solid #2563eb; padding-bottom:6px; margin-bottom:10px; text-transform:uppercase; letter-spacing:.05em; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .cell { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; }
  .cell label { font-size:11px; color:#64748b; display:block; margin-bottom:2px; }
  .cell span { font-size:14px; font-weight:600; }
  .desc { font-size:13px; line-height:1.6; color:#374151; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; }
  .tag { background:#f1f5f9; border-radius:4px; padding:3px 8px; font-size:12px; }
  .footer { margin-top:32px; padding-top:16px; border-top:1px solid #e2e8f0; text-align:center; font-size:11px; color:#94a3b8; }
  a { color:#2563eb; }
</style></head><body>
<div class="header">
  <h1>🏡 Property Intelligence Report</h1>
  <p>Generated by ARIA — ${new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })}</p>
</div>
${imgHtml}
<span class="badge badge-${cat.toLowerCase() === "RENT" ? "rent" : "sale"}">${cat || "LISTING"}</span>
<span class="badge" style="background:#f1f5f9;color:#475569">${ptype.toUpperCase()}</span>
<div class="title">${p.title || "Untitled Property"}</div>
<div class="price">${priceStr}${cat === "RENT" ? " /month" : ""}</div>
<div class="section"><h2>Property Details</h2>
<div class="grid">
  <div class="cell"><label>Bedrooms</label><span>${p.bedrooms ?? "—"}</span></div>
  <div class="cell"><label>Bathrooms</label><span>${p.bathrooms ?? "—"}</span></div>
  <div class="cell"><label>Size</label><span>${p.total_sqm ? p.total_sqm + " m²" : "—"}</span></div>
  <div class="cell"><label>Furnished</label><span>${p.furnished || "—"}</span></div>
  <div class="cell"><label>Location</label><span>${[p.locality, p.city, p.country].filter(Boolean).join(", ") || "—"}</span></div>
  <div class="cell"><label>Agency</label><span>${p.agency_name || "—"}</span></div>
</div></div>
${p.description ? `<div class="section"><h2>Description</h2><p class="desc">${p.description}</p></div>` : ""}
${amenitiesHtml}
${agentHtml}
${isRealUrl(p.listing_url) ? `<div class="section"><h2>Listing</h2><a href="${p.listing_url}">${p.listing_url}</a></div>` : ""}
<div class="footer"><p>ARIA Real Estate Intelligence Platform — Data sourced live from agency websites</p></div>
<script>window.onload = function(){ window.print(); }</script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
    // Revoke after short delay to allow window to load
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    onToast?.("Report opened — use 'Save as PDF' in the print dialog 📄", "success");
  }
  const price = p.price
    ? `${p.currency || "€"}${Number(p.price).toLocaleString()}`
    : null;
  const isRealUrl = (url?: string) =>
    url &&
    url.startsWith("http") &&
    !url.includes("example.com") &&
    !url.includes("placeholder.com") &&
    !url.includes("/link1") &&
    !url.includes("/link2");

  return (
    <div style={{
      borderRadius: 10,
      border: "1px solid rgba(148,163,184,0.2)",
      background: "rgba(15,23,42,0.5)",
      overflow: "hidden",
      transition: "border-color 0.2s",
    }}>
      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox
          images={lightbox.images}
          startIndex={lightbox.start}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Hero image gallery — click opens lightbox, arrows cycle through photos */}
      <div style={{ height: 170, background: "rgba(15,23,42,0.8)", position: "relative", overflow: "hidden" }}>
        {heroImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={heroImage}
              src={heroImage}
              alt={p.title || "property"}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", cursor: "pointer" }}
              onClick={() => setLightbox({ images: allGalleryImages, start: heroIdx })}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            {/* Photo counter badge */}
            {allGalleryImages.length > 1 && (
              <div style={{
                position: "absolute", top: 8, right: 8,
                background: "rgba(0,0,0,0.6)", color: "#fff",
                fontSize: "0.62rem", padding: "2px 7px", borderRadius: 10,
                backdropFilter: "blur(4px)",
              }}>
                {heroIdx + 1}/{allGalleryImages.length}
              </div>
            )}
            {/* Prev arrow */}
            {heroIdx > 0 && (
              <button onClick={e => { e.stopPropagation(); setHeroIdx(i => i - 1); }} style={{
                position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)",
                background: "rgba(0,0,0,0.5)", border: "none", color: "#fff",
                fontSize: 18, width: 28, height: 28, borderRadius: "50%", cursor: "pointer", lineHeight: 1,
              }}>‹</button>
            )}
            {/* Next arrow */}
            {heroIdx < allGalleryImages.length - 1 && (
              <button onClick={e => { e.stopPropagation(); setHeroIdx(i => i + 1); }} style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "rgba(0,0,0,0.5)", border: "none", color: "#fff",
                fontSize: 18, width: 28, height: 28, borderRadius: "50%", cursor: "pointer", lineHeight: 1,
              }}>›</button>
            )}
            {/* Expand hint */}
            <div
              onClick={() => setLightbox({ images: allGalleryImages, start: heroIdx })}
              style={{ position: "absolute", inset: 0, cursor: "pointer",
                background: "rgba(0,0,0,0)", transition: "background 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0)")}
            />
          </>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: "2.5rem" }}>🏠</div>
        )}
      </div>

      <div style={{ padding: "0.65rem" }}>
        {/* Category badge */}
        {p.category && (
          <span style={{
            display: "inline-block", fontSize: "0.62rem", fontWeight: 700,
            padding: "2px 6px", borderRadius: 4, marginBottom: "0.4rem",
            background: p.category.toLowerCase() === "rent" ? "rgba(16,185,129,0.2)" : "rgba(37,99,235,0.2)",
            color: p.category.toLowerCase() === "rent" ? "#34d399" : "#93c5fd",
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {p.category}
          </span>
        )}

        {/* Title */}
        <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem", lineHeight: 1.3 }}>
          {p.title || p.property_type || "Property"}
        </div>

        {/* Location */}
        {(p.locality || p.city) && (
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
            📍 {[p.locality, p.city, p.country].filter(Boolean).join(", ")}
          </div>
        )}

        {/* Price */}
        {price && (
          <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--accent-gold)", marginBottom: "0.35rem" }}>
            {price}
            {p.category?.toLowerCase() === "rent" && (
              <span style={{ fontSize: "0.7rem", fontWeight: 400, color: "var(--text-muted)" }}>/mo</span>
            )}
          </div>
        )}

        {/* Specs row */}
        <div style={{ display: "flex", gap: "0.6rem", fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.35rem", flexWrap: "wrap" }}>
          {p.bedrooms != null && <span>🛏 {p.bedrooms} bed</span>}
          {p.bathrooms != null && <span>🚿 {p.bathrooms} bath</span>}
          {p.total_sqm != null && <span>📐 {p.total_sqm}m²</span>}
          {p.furnished && p.furnished !== "" && <span>🛋️ {p.furnished}</span>}
        </div>

        {/* Agent contact (individual agent, if available) */}
        {p.agent_name && (
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "0.3rem", borderTop: "1px solid rgba(148,163,184,0.1)", paddingTop: "0.3rem" }}>
            <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 2 }}>👤 {p.agent_name}{p.agent_title ? ` · ${p.agent_title}` : ""}</div>
            {p.agent_phone && <div>📞 <a href={`tel:${p.agent_phone}`} style={{ color: "#93c5fd" }}>{p.agent_phone}</a></div>}
            {p.agent_whatsapp && <div>💬 <a href={`https://wa.me/${p.agent_whatsapp.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#34d399" }}>{p.agent_whatsapp}</a></div>}
            {p.agent_email && <div>✉️ <a href={`mailto:${p.agent_email}`} style={{ color: "#93c5fd" }}>{p.agent_email}</a></div>}
          </div>
        )}

        {/* Agency fallback */}
        {!p.agent_name && p.agency_name && (
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
            🏢 {p.agency_name}
          </div>
        )}

        {/* Thumbnail strip — shown only when 2+ photos available, below hero */}
        {allGalleryImages.length > 1 && (
          <div style={{ display: "flex", gap: "0.25rem", overflowX: "auto", padding: "0.3rem 0", marginBottom: "0.3rem" }}>
            {allGalleryImages.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`Photo ${i + 1}`}
                style={{
                  width: 60, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0,
                  border: i === heroIdx ? "2px solid #f59e0b" : "2px solid rgba(148,163,184,0.2)",
                  cursor: "pointer", transition: "opacity 0.15s",
                }}
                onClick={() => setHeroIdx(i)}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ))}
          </div>
        )}

        {/* Full address — shown after More Details */}
        {p.full_address && (
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
            🗺️ {p.full_address}
          </div>
        )}

        {/* Description — shown after More Details */}
        {p.description && (
          <div style={{
            marginBottom: "0.5rem",
            borderTop: "1px solid rgba(148,163,184,0.1)",
            paddingTop: "0.4rem",
          }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📝 Description
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {p.description}
            </div>
          </div>
        )}

        {/* Features / Home Details — shown after More Details */}
        {p.features && p.features.length > 0 && (
          <div style={{
            marginBottom: "0.5rem",
            borderTop: "1px solid rgba(148,163,184,0.1)",
            paddingTop: "0.4rem",
          }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🏠 Home Details
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {p.features.map((f, i) => (
                <span key={i} style={{
                  fontSize: "0.65rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(148,163,184,0.15)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  color: "var(--text-secondary)",
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Amenities — from listing page */}
        {p.amenities && p.amenities.length > 0 && !p.features?.length && (
          <div style={{ marginBottom: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {p.amenities.map((a, i) => (
              <span key={i} style={{
                fontSize: "0.63rem",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(148,163,184,0.12)",
                borderRadius: 4,
                padding: "2px 6px",
                color: "var(--text-muted)",
              }}>
                {a}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
          {/* View listing — only show if a real URL exists */}
          {(isRealUrl(p.listing_url) || isRealUrl(p.agency_website)) ? (
            <a
              href={isRealUrl(p.listing_url) ? p.listing_url : p.agency_website}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.68rem", color: "#93c5fd" }}
            >
              <ExternalLink size={10} /> View listing
            </a>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.68rem", color: "var(--text-muted)", opacity: 0.45, cursor: "not-allowed" }}>
              <ExternalLink size={10} /> No link
            </span>
          )}
          {onMoreDetails && (
            <button
              type="button"
              onClick={() => onMoreDetails(p)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: "0.68rem", fontWeight: 600,
                padding: "3px 8px", borderRadius: 6,
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.35)",
                color: "#f59e0b", cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              🏠 More details
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPdf}
            title="Save property report as PDF"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.68rem", fontWeight: 600,
              padding: "3px 8px", borderRadius: 6,
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "#818cf8", cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            📄 Save report
          </button>
          {/* JSON Download button */}
          <button
            type="button"
            onClick={() => {
              // Strip base64 images to keep JSON small
              const exportData = { ...p };
              if (exportData.page_screenshot) exportData.page_screenshot = "[screenshot omitted]";
              if (exportData.carousel_screenshots) exportData.carousel_screenshots = exportData.carousel_screenshots.map((s: string) => s.startsWith("data:") ? "[screenshot omitted]" : s);
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              const slug = (p.title || "property").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
              a.download = `${slug}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title="Download property data as JSON"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.68rem", fontWeight: 600,
              padding: "3px 8px", borderRadius: 6,
              background: "rgba(16,185,129,0.15)",
              border: "1px solid rgba(16,185,129,0.35)",
              color: "#10b981", cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            ⬇ JSON
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Property results grid ──────────────────────────────────────────────────

function PropertyResultsGrid({ properties, onMoreDetails, onToast }: { properties: LiveProperty[]; onMoreDetails?: (p: LiveProperty) => void; onToast?: (msg: string, type?: ToastType) => void }) {

  if (!properties.length) return null;
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          🏡 {properties.length} properties found — live from agency websites
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "0.6rem",
      }}>
        {properties.slice(0, 12).map((p, i) => (
          <PropertyCard key={i} p={p} onMoreDetails={onMoreDetails} onToast={onToast} />
        ))}
      </div>
      {properties.length > 12 && (
        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
          + {properties.length - 12} more — refine your search for specific results
        </div>
      )}
    </div>
  );
}

// ── Tool trace badge ───────────────────────────────────────────────────────

function ToolTraceBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: "0.65rem",
      padding: "2px 7px",
      borderRadius: 999,
      border: "1px solid rgba(148,163,184,0.2)",
      background: "rgba(15,23,42,0.5)",
      color: "var(--text-muted)",
      whiteSpace: "nowrap",
    }}>
      <Globe size={9} /> {label}
    </span>
  );
}

// ── Compare result block ───────────────────────────────────────────────────

function CompareBlock({ payload }: { payload: Record<string, unknown> }) {
  const rows = Array.isArray(payload.comparison_table)
    ? (payload.comparison_table as Array<{ criteria: string; values: string[] }>) : [];
  const prosCons = Array.isArray(payload.pros_cons)
    ? (payload.pros_cons as Array<{ property: string; pros: string[]; cons: string[] }>) : [];
  const rec         = typeof payload.recommendation    === "string" ? payload.recommendation    : "";
  const bestInvest  = typeof payload.best_for_investment === "string" ? payload.best_for_investment : "";
  const bestLiving  = typeof payload.best_for_living    === "string" ? payload.best_for_living    : "";
  const bestValue   = typeof payload.best_value         === "string" ? payload.best_value         : "";

  if (!rows.length && !rec) return null;

  // Derive column headers from the first row's values length
  const colCount = rows[0]?.values?.length ?? 2;
  // Try to get property titles from pros_cons or just use "Property 1 / 2"
  const colHeaders: string[] = prosCons.length >= colCount
    ? prosCons.slice(0, colCount).map(pc => pc.property || "—")
    : Array.from({ length: colCount }, (_, i) => `Property ${i + 1}`);

  // Accent colours per column — teal for first, violet for second
  const colAccents = ["rgba(20,184,166,0.15)", "rgba(139,92,246,0.15)"];
  const colBorders = ["rgba(20,184,166,0.35)", "rgba(139,92,246,0.35)"];
  const colText    = ["#5eead4", "#c4b5fd"];

  return (
    <div style={{
      marginTop: "0.75rem",
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid rgba(148,163,184,0.15)",
      background: "rgba(15,23,42,0.5)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    }}>

      {/* ── Header row ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `140px repeat(${colCount}, 1fr)`,
        borderBottom: "1px solid rgba(148,163,184,0.12)",
      }}>
        <div style={{ padding: "0.55rem 0.75rem", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Feature
        </div>
        {colHeaders.map((h, ci) => (
          <div key={ci} style={{
            padding: "0.55rem 0.75rem",
            background: colAccents[ci % colAccents.length],
            borderLeft: `2px solid ${colBorders[ci % colBorders.length]}`,
            fontSize: "0.72rem",
            fontWeight: 700,
            color: colText[ci % colText.length],
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {h}
          </div>
        ))}
      </div>

      {/* ── Data rows ── */}
      {rows.map((r, ri) => (
        <div key={ri} style={{
          display: "grid",
          gridTemplateColumns: `140px repeat(${colCount}, 1fr)`,
          borderTop: "1px solid rgba(148,163,184,0.07)",
          background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
        }}>
          {/* Criteria label */}
          <div style={{
            padding: "0.45rem 0.75rem",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "rgba(148,163,184,0.8)",
            display: "flex",
            alignItems: "center",
          }}>
            {r.criteria}
          </div>
          {/* Values — one per property column */}
          {Array.from({ length: colCount }).map((_, ci) => {
            const val = r.values?.[ci] ?? "—";
            return (
              <div key={ci} style={{
                padding: "0.45rem 0.75rem",
                fontSize: "0.72rem",
                color: "var(--text-primary)",
                borderLeft: `1px solid ${colBorders[ci % colBorders.length]}20`,
                display: "flex",
                alignItems: "center",
              }}>
                {val}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Pros / Cons ── */}
      {prosCons.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${colCount}, 1fr)`,
          borderTop: "1px solid rgba(148,163,184,0.12)",
          gap: 0,
        }}>
          {prosCons.slice(0, colCount).map((pc, ci) => (
            <div key={ci} style={{
              padding: "0.6rem 0.75rem",
              borderLeft: ci > 0 ? `1px solid rgba(148,163,184,0.1)` : "none",
              background: colAccents[ci % colAccents.length],
            }}>
              <div style={{ fontSize: "0.62rem", fontWeight: 700, color: colText[ci % colText.length], marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {pc.property}
              </div>
              {(pc.pros || []).map((p, i) => (
                <div key={i} style={{ fontSize: "0.68rem", color: "#86efac", marginBottom: "0.15rem" }}>✓ {p}</div>
              ))}
              {(pc.cons || []).map((c, i) => (
                <div key={i} style={{ fontSize: "0.68rem", color: "#fca5a5", marginBottom: "0.15rem" }}>✗ {c}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Verdict badges ── */}
      {(bestInvest || bestLiving || bestValue) && (
        <div style={{
          display: "flex",
          gap: "0.4rem",
          flexWrap: "wrap",
          padding: "0.5rem 0.75rem",
          borderTop: "1px solid rgba(148,163,184,0.1)",
          background: "rgba(0,0,0,0.2)",
        }}>
          {bestInvest && (
            <span style={{ padding: "0.2rem 0.55rem", borderRadius: 999, background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24", fontSize: "0.62rem", fontWeight: 600 }}>
              📈 Best Investment: {bestInvest}
            </span>
          )}
          {bestLiving && (
            <span style={{ padding: "0.2rem 0.55rem", borderRadius: 999, background: "rgba(20,184,166,0.15)", border: "1px solid rgba(20,184,166,0.3)", color: "#5eead4", fontSize: "0.62rem", fontWeight: 600 }}>
              🏡 Best to Live In: {bestLiving}
            </span>
          )}
          {bestValue && (
            <span style={{ padding: "0.2rem 0.55rem", borderRadius: 999, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#c4b5fd", fontSize: "0.62rem", fontWeight: 600 }}>
              💎 Best Value: {bestValue}
            </span>
          )}
        </div>
      )}

      {/* ── Recommendation ── */}
      {rec && (
        <div style={{
          borderTop: "1px solid rgba(226,181,90,0.2)",
          padding: "0.55rem 0.75rem",
          color: "#fde68a",
          fontSize: "0.72rem",
          lineHeight: 1.5,
          background: "rgba(245,158,11,0.05)",
          display: "flex",
          gap: "0.4rem",
          alignItems: "flex-start",
        }}>
          <span style={{ flexShrink: 0 }}>💡</span>
          <span>{rec}</span>
        </div>
      )}
    </div>
  );
}

// ── Main chat content ──────────────────────────────────────────────────────

function ChatPageContent() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [typingStatusIdx, setTypingStatusIdx] = useState(0);
  const [pendingActionHint, setPendingActionHint] = useState<string>("live_search_properties");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [menuThreadId, setMenuThreadId] = useState<string>("");
  const [pageError, setPageError] = useState("");
  const [renameTarget, setRenameTarget] = useState<ChatThread | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hoveredMessageId, setHoveredMessageId] = useState<string>("");
  const [renameValue, setRenameValue] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);
  const removeToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<(text: string) => Promise<void>>(async () => {});
  const sendingRef = useRef(sending);
  const activeThreadIdRef = useRef(activeThreadId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceRecognitionRef = useRef<any>(null);
  const voiceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTranscriptRef = useRef("");

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const refreshThreads = useCallback(async () => {
    const items = await listChatThreads();
    setThreads(items);
    setActiveThreadId(prev => items.some(i => i.id === prev) ? prev : items[0]?.id ?? "");
    return items;
  }, []);

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      setLoadingThreads(true);
      try {
        const current = await refreshThreads();
        if (!current.length) {
          const created = await createChatThread("New Chat");
          setThreads([created]);
          setActiveThreadId(created.id);
        }
      } finally {
        setLoadingThreads(false);
      }
    };
    void bootstrap();
  }, [refreshThreads]);

  // Load messages when thread changes
  useEffect(() => {
    if (!activeThreadId) return;
    const load = async () => {
      setLoadingMessages(true);
      setPageError("");
      try {
        const data = await listChatMessages(activeThreadId);
        setMessages(data);
      } catch {
        setPageError("Could not load messages — try refreshing.");
      } finally {
        setLoadingMessages(false);
      }
    };
    void load();
  }, [activeThreadId]);

  // Cycle typing status
  useEffect(() => {
    if (!sending) { setTypingStatusIdx(0); return; }
    const id = setInterval(() => setTypingStatusIdx(i => (i + 1) % CYCLING_STATUS.length), 2800);
    return () => clearInterval(id);
  }, [sending]);

  // Pre-fill from URL param
  useEffect(() => {
    const raw = searchParams.get("message");
    if (!raw?.trim()) return;
    try { setInput(decodeURIComponent(raw.replace(/\+/g, " "))); }
    catch { setInput(raw.replace(/\+/g, " ")); }
  }, [searchParams]);

  const createThread = async () => {
    const item = await createChatThread("New Chat");
    setThreads(prev => [item, ...prev]);
    setActiveThreadId(item.id);
    setMessages([]);
  };

  const renameThread = async (thread: ChatThread) => {
    const next = renameValue.trim();
    if (!next) return;
    const updated = await updateChatThread(thread.id, { title: next });
    setThreads(prev => prev.map(t => t.id === thread.id ? updated : t));
    setRenameTarget(null);
    setRenameValue("");
    setMenuThreadId("");
  };

  const removeThread = async (thread: ChatThread) => {
    try {
      await deleteChatThread(thread.id);
      const remaining = threads.filter(t => t.id !== thread.id);
      setThreads(remaining);
      setMenuThreadId("");
      if (activeThreadId === thread.id) {
        if (remaining[0]) setActiveThreadId(remaining[0].id);
        else await createThread();
      }
    } catch { setPageError("Delete failed. Please try again."); }
  };

  const removeMessage = async (messageId: string) => {
    try {
      await deleteChatMessage(messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch { setPageError("Message delete failed."); }
    setHoveredMessageId("");
  };

  const clearAll = async () => {
    try {
      await clearAllChatThreads();
      setThreads([]);
      setMessages([]);
      setActiveThreadId("");
      setMenuThreadId("");
      await createThread();
    } catch { setPageError("Clear all failed."); }
  };

  const submitUserMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !activeThreadId) return;

    setInput("");

    // Optimistic user message
    setMessages(prev => [...prev, {
      id: `u-${Date.now()}`,
      thread_id: activeThreadId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    }]);
    setPendingActionHint(inferTypingAction(trimmed));
    setSending(true);

    try {
      const res = await sendThreadMessage(activeThreadId, trimmed, undefined, undefined);
      if (res.action) setPendingActionHint(res.action);
      const meta = res.message_meta && typeof res.message_meta === "object"
        ? res.message_meta as Record<string, unknown> : {};

      // Replace the optimistic user message with real messages from server.
      // This gives real UUIDs (so delete works) without causing a flash/reset.
      const threadAtSend = activeThreadId;
      listChatMessages(threadAtSend)
        .then(fresh => {
          // Only update if user hasn't switched to a different thread
          setMessages(prev => {
            const currentThreadMsg = prev.find(m => m.thread_id === threadAtSend);
            if (!currentThreadMsg && prev.length > 0) return prev; // switched thread
            return fresh;
          });
        })
        .catch(() => {
          // Reload failed — keep optimistic + add assistant reply
          setMessages(prev => [...prev, {
            id: `a-${Date.now()}`,
            thread_id: threadAtSend,
            role: "assistant",
            content: res.reply,
            created_at: new Date().toISOString(),
            meta: { action: res.action, ...meta },
          }]);
        });

      // Show assistant reply immediately (don't wait for reload)
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        thread_id: activeThreadId,
        role: "assistant",
        content: res.reply,
        created_at: new Date().toISOString(),
        meta: { action: res.action, ...meta },
      }]);

      // If this was a "More Details" call, merge accurate data back into the original card.
      // Detail-page data is always more accurate than listing-page data (bed/bath/images etc).
      const detailProps = Array.isArray(meta?.properties) ? meta.properties as LiveProperty[] : [];
      if (trimmed.startsWith("More details about:") && detailProps.length > 0) {
        const detailProp = detailProps[0];
        if (detailProp.listing_url) {
          setMessages(prev => prev.map(msg => {
            if (msg.role !== "assistant") return msg;
            const msgMeta = msg.meta as Record<string, unknown> | undefined;
            if (!Array.isArray(msgMeta?.properties)) return msg;
            const props = msgMeta.properties as LiveProperty[];
            let changed = false;
            const updatedProps = props.map((p: LiveProperty) => {
              if (p.listing_url && p.listing_url === detailProp.listing_url) {
                changed = true;
                // Merge: detail data wins (accurate), keep original fields as fallback
                return { ...p, ...detailProp };
              }
              return p;
            });
            if (!changed) return msg;
            return { ...msg, meta: { ...msgMeta, properties: updatedProps } };
          }));
        }
      }

      await refreshThreads();
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && (
        err.message.includes("timeout") || err.message.includes("ECONNABORTED")
      );
      const isOffline = err instanceof Error && (
        err.message.includes("Network Error") || err.message.includes("ECONNREFUSED")
      );
      const errMsg = isTimeout
        ? "⏱️ The request timed out — the website being scraped took too long. Try a simpler search or paste a direct listing URL."
        : isOffline
        ? "⚠️ Could not reach the backend. Make sure it's running on port 8000."
        : "⚠️ Something went wrong. Please try again.";
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        thread_id: activeThreadId,
        role: "assistant",
        content: errMsg,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [activeThreadId, sending, refreshThreads]);

  useEffect(() => { submitRef.current = submitUserMessage; }, [submitUserMessage]);

  // Voice input
  const stopVoiceDebounce = useCallback(() => {
    if (voiceDebounceRef.current) {
      clearTimeout(voiceDebounceRef.current);
      voiceDebounceRef.current = null;
    }
  }, []);

  const toggleVoice = useCallback(() => {
    // Stop if already listening
    if (voiceListening) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (voiceRecognitionRef.current as any)?.stop();
      stopVoiceDebounce();
      setVoiceListening(false);
      return;
    }

    if (!activeThreadId || sending) return;

    // Safely access SpeechRecognition (vendor-prefixed in some browsers)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SpeechAPI = win.SpeechRecognition ?? win.webkitSpeechRecognition;

    if (!SpeechAPI) {
      showToast("Voice input requires Chrome or Edge. Please switch browsers.", "error");
      return;
    }

    // Request mic permission first (shows browser prompt if not yet granted)
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(() => {
        voiceTranscriptRef.current = "";
        setInput("");
        setVoiceListening(true);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recognition = new SpeechAPI() as any;
        voiceRecognitionRef.current = recognition;

        recognition.continuous     = true;   // keep listening until manually stopped
        recognition.interimResults = true;   // show partial transcription live
        recognition.lang           = "en-US";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (e: any) => {
          let finalText   = "";
          let interimText = "";

          for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText   += t;
            else                       interimText += t;
          }

          const combined = (finalText + interimText).trim();
          if (combined) {
            voiceTranscriptRef.current = combined;
            setInput(combined);
          }

          // Auto-send 2 s after last final result
          if (finalText.trim()) {
            stopVoiceDebounce();
            voiceDebounceRef.current = setTimeout(() => {
              const t = voiceTranscriptRef.current.trim();
              if (t && !sendingRef.current && activeThreadIdRef.current) {
                recognition.stop();
                void submitRef.current(t);
              }
            }, 2000);
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onerror = (e: any) => {
          console.warn("SpeechRecognition error:", e.error);
          setVoiceListening(false);
          stopVoiceDebounce();
          if (e.error === "not-allowed") {
            showToast("Microphone permission denied. Please allow mic access in your browser settings.", "error");
          }
        };

        recognition.onend = () => {
          // Just mark as stopped — continuous:true rarely fires onend mid-session
          setVoiceListening(false);
        };

        recognition.start();
      })
      .catch(() => {
        showToast("Could not access microphone. Please allow mic access and try again.", "error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceListening, activeThreadId, sending, stopVoiceDebounce]);

  useEffect(() => () => {
    stopVoiceDebounce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voiceRecognitionRef.current as any)?.stop();
  }, [stopVoiceDebounce]);

  const onSubmit = async (e: FormEvent) => { e.preventDefault(); await submitUserMessage(input); };

  return (
    <div style={{ height: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "0.9rem", minHeight: 0 }}>
      <div style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: sidebarOpen ? "280px 1fr" : "0px 1fr",
        gap: sidebarOpen ? "0.9rem" : 0,
        minHeight: 0,
        transition: "grid-template-columns 0.25s ease",
      }}>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="card" style={{
          borderRadius: 12,
          border: "1px solid var(--border)",
          padding: sidebarOpen ? "0.75rem" : 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          height: "100%",
          minWidth: 0,
          opacity: sidebarOpen ? 1 : 0,
          transition: "opacity 0.2s ease, padding 0.25s ease",
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}>
          {/* ARIA badge */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: "0.75rem",
            padding: "0.5rem 0.6rem",
            borderRadius: 8,
            background: "rgba(226,181,90,0.08)",
            border: "1px solid rgba(226,181,90,0.2)",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 999,
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Bot size={14} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--accent-gold)" }}>ARIA</div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Real Estate Agent</div>
            </div>
            <div style={{
              marginLeft: "auto",
              width: 7, height: 7, borderRadius: 999,
              background: "#34d399",
              boxShadow: "0 0 6px #34d399",
              flexShrink: 0,
            }} />
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              title="Collapse sidebar"
              style={{
                marginLeft: 6,
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 4px",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                fontSize: 14,
                lineHeight: 1,
              }}
            >‹</button>
          </div>

          {/* New chat */}
          <button type="button" onClick={createThread} style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            marginBottom: "0.5rem",
            padding: "0.55rem",
            background: "rgba(37,99,235,0.18)",
            border: "1px solid rgba(37,99,235,0.4)",
            color: "#fff",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}>
            <Plus size={14} /> New Chat
          </button>

          {/* Clear all */}
          <button type="button" onClick={clearAll} style={{
            width: "100%",
            marginBottom: "0.65rem",
            padding: "0.4rem",
            borderRadius: 8,
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#fca5a5",
            background: "rgba(239,68,68,0.07)",
            cursor: "pointer",
            fontSize: "0.72rem",
          }}>
            Clear All
          </button>

          {/* Thread list */}
          <div className="chat-scroll" style={{
            flex: "1 1 0", minHeight: 0,
            overflowY: "auto", overflowX: "hidden",
            display: "flex", flexDirection: "column", gap: "0.4rem",
            paddingRight: 4,
          }}>
            {loadingThreads && (
              <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", padding: "0.5rem" }}>Loading...</div>
            )}
            {!loadingThreads && threads.map(thread => (
              <div key={thread.id} style={{
                padding: "0.5rem",
                borderRadius: 8,
                border: `1px solid ${activeThreadId === thread.id ? "rgba(226,181,90,0.4)" : "var(--border)"}`,
                background: activeThreadId === thread.id ? "rgba(226,181,90,0.08)" : "transparent",
              }}>
                <button type="button" onClick={() => setActiveThreadId(thread.id)} style={{
                  width: "100%", textAlign: "left",
                  background: "transparent", border: "none",
                  color: "var(--text-primary)", cursor: "pointer", padding: 0,
                }}>
                  {/* Title + time row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 2 }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                      {thread.title === "New Chat" ? "💬 New Chat" : thread.title}
                    </div>
                    <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {formatThreadTime(thread.updated_at)}
                    </div>
                  </div>
                  {/* Preview */}
                  <div style={{ fontSize: "0.67rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {thread.last_message_preview || "No messages yet"}
                  </div>
                </button>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4, position: "relative" }}>
                  <button type="button" onClick={() => setMenuThreadId(p => p === thread.id ? "" : thread.id)}
                    style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                    <MoreVertical size={13} />
                  </button>
                  {menuThreadId === thread.id && (
                    <div style={{
                      position: "absolute", top: 20, right: 0,
                      minWidth: 110, border: "1px solid var(--border)",
                      borderRadius: 8, background: "var(--bg-card)", zIndex: 40, padding: 4,
                    }}>
                      <button type="button" onClick={() => { setRenameTarget(thread); setRenameValue(thread.title); setMenuThreadId(""); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.72rem", padding: "0.3rem 0.4rem", textAlign: "left" }}>
                        <Pencil size={11} /> Rename
                      </button>
                      <button type="button" onClick={() => removeThread(thread)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: "0.72rem", padding: "0.3rem 0.4rem", textAlign: "left" }}>
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Capabilities hint */}
          <div style={{
            marginTop: "0.65rem",
            padding: "0.55rem",
            borderRadius: 8,
            background: "rgba(15,23,42,0.6)",
            border: "1px solid rgba(148,163,184,0.12)",
            fontSize: "0.65rem",
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-secondary)" }}>ARIA can:</div>
            🌐 Browse any real estate site live<br />
            🏡 Find properties in any city worldwide<br />
            📈 Calculate ROI, yield & investment returns<br />
            💱 Convert prices to PKR, AED, USD & more<br />
            📊 Market analysis & investment insights<br />
            🤝 Compare properties side-by-side<br />
            🧠 Remembers your preferences<br />
            📄 Export a PDF property report<br />
            🔗 Scrape any URL you share
          </div>
        </aside>

        {/* ── Chat area ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, height: "100%" }}>

          {/* Header */}
          <div style={{
            marginBottom: "0.7rem",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 999,
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Bot size={17} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
                ARIA
              </h1>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                Real Estate Agent · Live web browsing
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: "0.7rem", color: "#34d399" }}>
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  title="Open sidebar"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "3px 8px",
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >‹ Chats</button>
              )}
              <div style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399", boxShadow: "0 0 6px #34d399" }} />
              Online
            </div>
          </div>

          {pageError && (
            <div style={{ marginBottom: "0.5rem", color: "#fca5a5", fontSize: "0.76rem", padding: "0.4rem 0.6rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.07)" }}>
              {pageError}
            </div>
          )}

          {/* Messages */}
          <div className="card chat-scroll" style={{
            flex: "1 1 0", minHeight: 0,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "1rem",
            overflowY: "auto",
            overflowX: "hidden",
            display: "flex", flexDirection: "column",
            gap: "0.8rem",
            marginBottom: "0.75rem",
            minWidth: 0,
          }}>
            {loadingMessages && (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading messages...</div>
            )}

            {/* Empty state with suggestions */}
            {!loadingMessages && messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "1.2rem", padding: "2rem 1rem" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 999, margin: "0 auto 1rem",
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 0 24px rgba(245,158,11,0.3)",
                  }}>
                    <Bot size={26} color="#fff" />
                  </div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
                    Hi! I&apos;m ARIA 👋
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.6 }}>
                    I browse real estate websites <strong style={{ color: "var(--text-secondary)" }}>live</strong> to find you the latest properties in any city or country. Try one of these:
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", maxWidth: 480 }}>
                  {ARIA_SUGGESTIONS.map(s => (
                    <button key={s} type="button" onClick={() => setInput(s)} style={{
                      fontSize: "0.72rem",
                      padding: "0.4rem 0.65rem",
                      borderRadius: 20,
                      border: "1px solid rgba(226,181,90,0.25)",
                      background: "rgba(226,181,90,0.07)",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map(m => {
              const meta = m.meta as Record<string, unknown> | undefined;
              const properties = Array.isArray(meta?.properties) ? meta!.properties as LiveProperty[] : [];
              const toolTrace = Array.isArray(meta?.aria_tool_trace) ? meta!.aria_tool_trace as Array<{tool:string;label:string}> : [];
              const compareResult = meta?.compare_result as Record<string, unknown> | undefined;
              const isUser = m.role === "user";
              // DEBUG — remove after fixing
              // debug: if (!isUser && meta) console.log("[ARIA meta]", { props: Array.isArray(meta.properties) ? (meta.properties as unknown[]).length : 0, trace: meta.aria_tool_trace });

              return (
                <div
                  key={m.id}
                  onMouseEnter={() => setHoveredMessageId(m.id)}
                  onMouseLeave={() => setHoveredMessageId("")}
                  style={{
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    maxWidth: isUser ? "70%" : "92%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {/* Avatar + bubble row */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{
                      marginTop: 4,
                      width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isUser
                        ? "rgba(37,99,235,0.25)"
                        : "linear-gradient(135deg, #f59e0b, #d97706)",
                    }}>
                      {isUser
                        ? <User size={12} color="#93c5fd" />
                        : <Bot size={12} color="#fff" />}
                    </div>

                    <div style={{
                      padding: "0.65rem 0.85rem",
                      borderRadius: isUser ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                      background: isUser
                        ? "rgba(37,99,235,0.18)"
                        : "rgba(255,255,255,0.05)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontSize: "0.85rem",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}>
                      {/* Strip markdown tables when compareResult is present */}
                      {isUser
                        ? m.content
                        : (() => {
                            let txt = m.content;
                            if (compareResult) {
                              // Strip markdown table lines (lines starting with |)
                              txt = txt.split("\n").filter(line => !line.trimStart().startsWith("|")).join("\n");
                              // Strip --- section separator blocks (ARIA manual compare format):
                              // Remove everything between the first ### heading and the Summary/recommendation line
                              txt = txt.replace(/###\s+Apartment[\s\S]*?(?=(?:###\s+Summary|Would you like|$))/gi, "").trim();
                              // Clean up leftover --- separators
                              txt = txt.replace(/\n---\n/g, "\n").replace(/^---$/gm, "").trim();
                            }
                            return txt;
                          })()}

                      {/* Live property cards — hidden on compare turns */}
                      {!isUser && properties.length > 0 && !compareResult && (
                        <PropertyResultsGrid
                          properties={properties}
                          onMoreDetails={(prop) => {
                            const title = prop.title || prop.property_type || "this property";
                            const priceStr = prop.price ? ` (${prop.currency || ""}${Number(prop.price).toLocaleString()})` : "";
                            const isFake = (u: string) =>
                              !u || u.includes("example.com") || u.includes("/link1") || u.includes("/link2") || u === "#";
                            const directUrl = !isFake(prop.listing_url || "") ? prop.listing_url : null;
                            const agencyUrl = !isFake(prop.agency_website || "") ? prop.agency_website : null;
                            // Build the best possible site hint for ARIA
                            const siteNote = directUrl
                              ? ` — listing url: ${directUrl}`
                              : agencyUrl
                              ? ` — agency site: ${agencyUrl}, property title: "${title}"${priceStr ? `, price: ${priceStr}` : ""}`
                              : "";
                            submitUserMessage(`More details about: ${title}${priceStr}${siteNote}`);
                          }}
                          onToast={showToast}
                        />
                      )}

                      {/* Comparison table */}
                      {!isUser && compareResult && (
                        <CompareBlock payload={compareResult} />
                      )}
                    </div>
                  </div>

                  {/* Tool trace */}
                  {!isUser && toolTrace.length > 0 && (
                    <div style={{
                      marginLeft: 32,
                      display: "flex", flexWrap: "wrap", gap: "0.3rem",
                    }}>
                      {toolTrace.map((t, i) => (
                        <ToolTraceBadge key={i} label={t.label} />
                      ))}
                    </div>
                  )}

                  {/* Delete button — shows on hover */}
                  {hoveredMessageId === m.id && (
                    <button
                      type="button"
                      onClick={() => removeMessage(m.id)}
                      title="Delete message"
                      style={{
                        flexShrink: 0,
                        alignSelf: "flex-start",
                        marginTop: 6,
                        background: "rgba(239,68,68,0.12)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: 6,
                        color: "#fca5a5",
                        cursor: "pointer",
                        padding: "3px 7px",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: "0.72rem",
                      }}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                </div>
              );
            })}

            {/* Typing indicator */}
            {sending && (
              <div style={{ alignSelf: "flex-start", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{
                  marginTop: 4, width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                }}>
                  <Bot size={12} color="#fff" />
                </div>
                <div style={{
                  padding: "0.55rem 0.8rem",
                  borderRadius: "10px 10px 10px 2px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--border)",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}>
                  <span className="typing-dot" />
                  <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                  <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
                  <span style={{ fontSize: "0.76rem", color: "var(--text-muted)", maxWidth: 260, lineHeight: 1.3 }}>
                    {TYPING_BY_ACTION[pendingActionHint] ?? CYCLING_STATUS[typingStatusIdx]}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>


            <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
              {voiceListening && (
                <span style={{
                  position: "absolute", left: 12,
                  width: 7, height: 7, borderRadius: 999,
                  background: "#ef4444",
                  animation: "voicePulse 1.2s ease-in-out infinite",
                  pointerEvents: "none",
                }} />
              )}
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask ARIA — find properties, scrape websites, market analysis..."
                disabled={sending}
                style={{
                  flex: 1, width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${voiceListening ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 10,
                  outline: "none",
                  color: "var(--text-primary)",
                  padding: voiceListening ? "0.75rem 0.9rem 0.75rem 1.85rem" : "0.75rem 0.9rem",
                  fontSize: "0.88rem",
                }}
              />
            </div>

            {/* Voice button */}
            <button type="button" onClick={toggleVoice} disabled={sending || !activeThreadId}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                borderRadius: 10,
                border: `1px solid ${voiceListening ? "rgba(239,68,68,0.5)" : "rgba(148,163,184,0.3)"}`,
                padding: "0 0.85rem",
                background: voiceListening ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)",
                color: "#fff",
                cursor: sending || !activeThreadId ? "not-allowed" : "pointer",
                opacity: sending || !activeThreadId ? 0.5 : 1,
              }}>
              {voiceListening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>

            {/* Send button */}
            <button type="submit" disabled={!canSend} style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              borderRadius: 10,
              border: "1px solid rgba(37,99,235,0.45)",
              padding: "0 1.1rem",
              background: canSend ? "rgba(37,99,235,0.25)" : "rgba(255,255,255,0.04)",
              color: "#fff",
              minWidth: 90,
              cursor: canSend ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}>
              {sending
                ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                : <Send size={14} />}
              Send
            </button>
            </div>
          </form>
        </div>
      </div>

      <style>{`
        .chat-scroll::-webkit-scrollbar { width: 5px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(96,165,250,0.3); border-radius: 999px; }
        .typing-dot {
          width: 5px; height: 5px; border-radius: 999px;
          background: rgba(255,255,255,0.8); display: inline-block;
          animation: typingBounce 0.9s infinite ease-in-out;
        }
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes voicePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.6; }
        }
      `}</style>

      {/* Rename modal */}
      {renameTarget && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(2,6,23,0.75)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
        }}>
          <div className="card" style={{
            width: "min(400px, 100%)", borderRadius: 12,
            border: "1px solid var(--border)", background: "var(--bg-card)", padding: "1rem",
          }}>
            <h3 style={{ color: "var(--text-primary)", fontSize: "0.95rem", fontWeight: 700, marginBottom: 6 }}>
              Rename Chat
            </h3>
            <input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") void renameThread(renameTarget); }}
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)", borderRadius: 8,
                color: "var(--text-primary)", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => { setRenameTarget(null); setRenameValue(""); }}
                style={{ borderRadius: 8, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)", padding: "0.4rem 0.8rem", fontSize: "0.8rem", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => void renameThread(renameTarget)}
                style={{ borderRadius: 8, border: "1px solid rgba(37,99,235,0.45)", background: "rgba(37,99,235,0.2)", color: "#dbeafe", padding: "0.4rem 0.8rem", fontSize: "0.8rem", cursor: "pointer" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Themed toast notifications — replaces native alert() */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: "3rem", color: "var(--text-muted)", textAlign: "center", background: "var(--bg-base)" }}>
        Loading ARIA...
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
