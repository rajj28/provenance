import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { env } from "@/lib/env";
import { loadPayloadBySlug, stableContent } from "@/lib/portfolio/payload";

/**
 * Public portfolio feed.
 *
 * This is the contract `public/embed.js` and any third-party site reads, so it
 * is deliberately CORS-open: the whole point is that it is fetched from a
 * domain we do not control. It exposes only what `/p/{slug}` already renders
 * publicly — no email, no evidence internals, no connection state.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, if-none-match",
  "Access-Control-Expose-Headers": "etag",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const payload = await loadPayloadBySlug(slug, env.APP_URL);

  if (!payload) {
    // A private portfolio and a missing one answer identically, so the endpoint
    // cannot be used to enumerate which slugs exist.
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  }

  // ETag over the content minus `generatedAt`, so an unchanged portfolio keeps
  // revalidating cheaply instead of re-sending on every poll.
  const etag = `"${createHash("sha256").update(stableContent(payload)).digest("hex").slice(0, 32)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...CORS, etag } });
  }

  return NextResponse.json(payload, {
    headers: {
      ...CORS,
      etag,
      // Short public cache with a long stale window: an embedding site stays
      // fast and keeps rendering the last good copy if we are briefly down.
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
