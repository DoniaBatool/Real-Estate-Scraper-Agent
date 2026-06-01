"""
PDF Report Generator — uses fpdf2 (pure Python, no system dependencies).
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any


async def generate_property_pdf(
    property_data: dict[str, Any],
    agency_data: dict[str, Any] | None = None,
    pricing_data: dict[str, Any] | None = None,
) -> bytes:
    from fpdf import FPDF

    p = property_data
    ag = agency_data or {}

    # ── helpers ──────────────────────────────────────────────────────────────
    def safe(val: Any, fallback: str = "-") -> str:
        if val is None:
            return fallback
        s = str(val).strip()
        # Strip non-latin-1 characters to avoid encoding errors
        s = s.encode("latin-1", errors="replace").decode("latin-1")
        return s if s and s.lower() not in ("none", "null", "n/a", "-", "") else fallback

    def money(val: Any) -> str:
        try:
            return f"{float(val):,.0f}"
        except Exception:
            return "-"

    # Palette
    DARK   = (10, 22, 40)        # #0a1628
    BLUE   = (37, 99, 235)       # #2563eb
    GOLD   = (245, 158, 11)      # #f59e0b
    LIGHT  = (241, 245, 249)     # #f1f5f9
    MUTED  = (100, 116, 139)     # #64748b
    WHITE  = (255, 255, 255)
    BLACK  = (15, 23, 42)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(15, 15, 15)

    W = pdf.w - 30  # usable width

    # ── HEADER BAR ───────────────────────────────────────────────────────────
    pdf.set_fill_color(*DARK)
    pdf.rect(0, 0, pdf.w, 28, style="F")
    pdf.set_y(7)
    pdf.set_x(15)
    pdf.set_text_color(*GOLD)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 8, "ARIA  Property Intelligence Report", ln=True)
    pdf.set_x(15)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(126, 184, 247)
    pdf.cell(0, 5, f"Generated  {datetime.now().strftime('%B %d, %Y')}", ln=True)
    pdf.ln(8)

    # ── SECTION HELPER ───────────────────────────────────────────────────────
    def section(title: str) -> None:
        pdf.set_fill_color(*BLUE)
        pdf.set_text_color(*WHITE)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(W, 7, f"  {title}", fill=True, ln=True)
        pdf.ln(2)
        pdf.set_text_color(*BLACK)

    def row(label: str, value: str, even: bool = False) -> None:
        if even:
            pdf.set_fill_color(*LIGHT)
        else:
            pdf.set_fill_color(*WHITE)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(55, 6, label, fill=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(W - 55, 6, value, fill=True, ln=True)

    # ── PROPERTY OVERVIEW ────────────────────────────────────────────────────
    section("Property Overview")

    # Category badges
    cat = safe(p.get("category"), "Listing").upper()
    ptype = safe(p.get("property_type"), "Property").upper()
    pdf.set_font("Helvetica", "B", 8)
    badge_color = (16, 185, 129) if "RENT" in cat else (37, 99, 235)
    pdf.set_fill_color(*badge_color)
    pdf.set_text_color(*WHITE)
    pdf.cell(22, 5, f" {cat} ", fill=True)
    pdf.set_x(pdf.get_x() + 2)
    pdf.set_fill_color(*MUTED)
    pdf.cell(30, 5, f" {ptype} ", fill=True, ln=True)
    pdf.ln(2)

    # Title
    pdf.set_text_color(*BLACK)
    pdf.set_font("Helvetica", "B", 14)
    title_text = safe(p.get("title"), "Untitled Listing")
    pdf.multi_cell(W, 7, title_text)
    pdf.ln(1)

    # Price
    price_val = p.get("price")
    currency = safe(p.get("currency"), "EUR")
    price_str = f"{currency} {money(price_val)}" if price_val else "Price on Request"
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*BLUE)
    pdf.cell(0, 10, price_str, ln=True)
    pdf.set_text_color(*BLACK)
    pdf.ln(2)

    # ── PROPERTY DETAILS GRID ────────────────────────────────────────────────
    section("Property Details")

    details = [
        ("Bedrooms",    safe(p.get("bedrooms"))),
        ("Bathrooms",   safe(p.get("bathrooms"))),
        ("Total Size",  f"{safe(p.get('total_sqm'))} m²" if p.get("total_sqm") else "-"),
        ("Floor",       safe(p.get("floor_number"))),
        ("Furnished",   safe(p.get("furnished"))),
        ("Listing URL", safe(p.get("listing_url"))),
    ]
    for i, (lbl, val) in enumerate(details):
        row(lbl, val, even=i % 2 == 0)
    pdf.ln(4)

    # ── LOCATION ─────────────────────────────────────────────────────────────
    section("Location")
    parts = [p.get("locality"), p.get("city"), p.get("country")]
    location_str = ", ".join(str(x) for x in parts if x and str(x).lower() not in ("none", "null", "-"))
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"  {location_str or '—'}", ln=True)
    if p.get("full_address"):
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 5, f"  {safe(p.get('full_address'))}", ln=True)
        pdf.set_text_color(*BLACK)
    pdf.ln(4)

    # ── DESCRIPTION ──────────────────────────────────────────────────────────
    desc = safe(p.get("description"), "")
    if desc and desc != "-":
        section("Description")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*BLACK)
        pdf.multi_cell(W, 5, desc[:1200])
        pdf.ln(4)

    # ── AMENITIES ────────────────────────────────────────────────────────────
    amenities = p.get("amenities") or p.get("features") or []
    if amenities:
        section("Amenities & Features")
        pdf.set_font("Helvetica", "", 9)
        # Print as comma-separated list wrapped into multi-cell
        amenity_str = "  |  ".join(str(a) for a in amenities[:30])
        pdf.multi_cell(W, 5, amenity_str)
        pdf.ln(4)

    # ── AGENT CONTACT ────────────────────────────────────────────────────────
    agent_name  = safe(p.get("agent_name"), "")
    agent_phone = safe(p.get("agent_phone"), "")
    agent_email = safe(p.get("agent_email"), "")
    agency_name = safe(p.get("agency_name") or ag.get("name"), "")

    if any([agent_name, agent_phone, agent_email, agency_name]):
        section("Agent & Agency Contact")
        contacts = [
            ("Agent",   agent_name),
            ("Phone",   agent_phone or safe(p.get("agent_whatsapp"), "")),
            ("Email",   agent_email),
            ("Agency",  agency_name),
            ("Website", safe(p.get("agency_website") or ag.get("website"), "")),
        ]
        for i, (lbl, val) in enumerate(contacts):
            if val and val != "-":
                row(lbl, val, even=i % 2 == 0)
        pdf.ln(4)

    # ── PRICING DATA ─────────────────────────────────────────────────────────
    if pricing_data:
        section("Market Analysis")
        mkt = [
            ("Avg Price / m²",   money(pricing_data.get("avg_price_per_sqm"))),
            ("Avg Property Size", f"{safe(pricing_data.get('avg_size'))} m²"),
        ]
        for i, (lbl, val) in enumerate(mkt):
            row(lbl, val, even=i % 2 == 0)
        pdf.ln(4)

    # ── FOOTER ───────────────────────────────────────────────────────────────
    pdf.set_y(-20)
    pdf.set_fill_color(*DARK)
    pdf.rect(0, pdf.get_y(), pdf.w, 20, style="F")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(126, 184, 247)
    pdf.set_x(15)
    pdf.cell(0, 6, "ARIA Real Estate Intelligence Platform  |  Data sourced live from agency websites", ln=True)

    # ── OUTPUT ───────────────────────────────────────────────────────────────
    buf = io.BytesIO()
    pdf.output(buf)
    return buf.getvalue()
