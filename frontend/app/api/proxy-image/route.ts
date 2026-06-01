export const runtime = "nodejs";

/**
 * GET /api/proxy-image?url=<encoded-url>&ref=<encoded-referer>
 *
 * Server-side image proxy — fetches images that block direct browser
 * access (e.g. S3 buckets with referer/CORS restrictions).
 * Returns the image with proper Content-Type so the browser can display it.
 */

import { NextRequest, NextResponse } from "next/server";

// Allow-list: only proxy images from known real-estate domains
const ALLOWED_ORIGINS = [
  "amazonaws.com",
  "s3.",
  "cloudfront.net",
  "easyrent",
  "maltapark",
  "remax",
  "frank-salt",
  "dhalia",
  "cdnimages",
  "propertycloud",
  "imgix.net",
  "cloudinary.com",
  "res.cloudinary",
];

function isAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_ORIGINS.some((o) => parsed.hostname.includes(o));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imageUrl = searchParams.get("url") || "";
  const referer  = searchParams.get("ref") || "";

  if (!imageUrl || !imageUrl.startsWith("http")) {
    return new NextResponse("Missing url", { status: 400 });
  }

  if (!isAllowed(imageUrl)) {
    return new NextResponse("Domain not allowed", { status: 403 });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/webp,image/avif,image/jpeg,image/png,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (referer) {
      headers["Referer"] = referer;
      headers["Origin"]  = new URL(referer).origin;
    }

    const res = await fetch(imageUrl, { headers, redirect: "follow" });

    if (!res.ok) {
      return new NextResponse(`Upstream ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Proxy": "aria-image-proxy",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Proxy error: ${msg}`, { status: 500 });
  }
}
