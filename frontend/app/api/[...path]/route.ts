import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Workbench scraping endpoints can legitimately run for several minutes.
export const maxDuration = 900;

function backendOrigin(): string {
  const u =
    process.env.BACKEND_PROXY_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
  if (!u) {
    return "http://127.0.0.1:8000";
  }
  return u.replace(/\/$/, "");
}

type RouteCtx = { params: Promise<{ path?: string[] }> };

async function proxy(req: NextRequest, ctx: RouteCtx) {
  const { path: segments } = await ctx.params;
  const parts = segments ?? [];
  const subpath = parts.join("/");
  const incoming = new URL(req.url);
  const targetUrl = `${backendOrigin()}/api/${subpath}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (["host", "connection", "keep-alive", "transfer-encoding"].includes(k)) return;
    headers.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  try {
    const res = await fetch(targetUrl, init);
    const out = new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
    });
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "transfer-encoding") return;
      out.headers.set(key, value);
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        detail: "Could not reach FastAPI backend. Is uvicorn running on port 8000?",
        target: targetUrl,
        error: msg,
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}

export async function OPTIONS(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, ctx);
}
