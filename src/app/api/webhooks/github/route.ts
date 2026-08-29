import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueSourceSync } from "@/lib/queue";
import { logger } from "@/lib/logger";

function verify(signature: string | null, payload: string) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verify(signature, payload)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") || "";
  let login = "";
  try {
    const json = JSON.parse(payload) as {
      sender?: { login?: string; id?: number };
      repository?: { owner?: { login?: string; id?: number } };
    };
    login = json.sender?.login || json.repository?.owner?.login || "";
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!login || event === "ping") return NextResponse.json({ ok: true });

  const connections = await prisma.sourceConnection.findMany({
    where: { sourceType: "github", displayName: { equals: login, mode: "insensitive" } },
    select: { id: true },
    take: 20,
  });
  await Promise.all(connections.map((c) => enqueueSourceSync(c.id, `github-webhook:${event}`)));
  logger.info("github_webhook_enqueued", { login, event, count: connections.length });
  return NextResponse.json({ ok: true, queued: connections.length });
}
