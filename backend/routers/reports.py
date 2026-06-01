"""
PDF Report Router — generates branded property PDF reports.

POST /api/reports/pdf
  Body: { "property": {...}, "agency": {...} }
  Returns: application/pdf binary
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


class PropertyReportRequest(BaseModel):
    property: dict[str, Any]
    agency: dict[str, Any] | None = None
    pricing_data: dict[str, Any] | None = None


@router.post("/pdf")
async def generate_pdf_report(payload: PropertyReportRequest):
    """
    Generate a branded PDF property report.

    Body:
    {
      "property": {
        "title": "...",
        "price": 350000,
        "currency": "EUR",
        "bedrooms": 3,
        "bathroom_count": 2,
        "total_sqm": 120,
        "locality": "Sliema",
        "city": "Malta",
        "description": "...",
        "amenities": ["Pool", "Parking"],
        ...
      },
      "agency": {
        "name": "...",
        "phone": ["..."],
        "email": ["..."],
        ...
      }
    }

    Returns application/pdf binary.
    """
    try:
        from backend.reports.generator import generate_property_pdf

        pdf_bytes = await generate_property_pdf(
            property_data=payload.property,
            agency_data=payload.agency,
            pricing_data=payload.pricing_data,
        )

        title = (payload.property.get("title") or "property").replace(" ", "_")[:40]
        filename = f"ARIA_Report_{title}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes)),
            },
        )

    except ImportError as exc:
        logger.error("PDF generation dependency missing: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "PDF generation requires weasyprint. "
                "Install with: pip install weasyprint jinja2"
            ),
        )
    except Exception as exc:
        logger.error("PDF generation failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {exc}",
        )


@router.get("/pdf/health")
async def pdf_health():
    """Check if PDF generation dependencies are available."""
    try:
        from backend.reports.generator import generate_property_pdf  # noqa: F401
        import weasyprint  # noqa: F401
        import jinja2  # noqa: F401
        return {"status": "ok", "engine": "weasyprint + jinja2"}
    except ImportError as exc:
        return {"status": "unavailable", "reason": str(exc)}
