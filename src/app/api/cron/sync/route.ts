import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueManySourceSyncs } from "@/lib/queue";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!safeEqual(header, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const connections = await prisma.sourceConnection.findMany({
    where: {
      status: { in: ["connected", "error"] },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
    },
    select: { id: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: env.CRON_BATCH_SIZE,
  });

  if (connections.length === 0) return NextResponse.json({ queued: 0, skipped: 0 });

  // Deliberately NOT enqueueSourceSync: that helper falls back to running the
  // sync inline when Redis is down, which is right for a single user action but
  // catastrophic here — a whole batch would run serially inside one HTTP
  // request and blow the gateway timeout. Cron only enqueues; if the queue is
  // unreachable it reports that and the next tick retries.
  try {
    const queued = await enqueueManySourceSyncs(
      connections.map((c) => c.id),
      "cron"
    );
    return NextResponse.json({ queued });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("cron_enqueue_failed", { message, candidates: connections.length });
    return NextResponse.json(
      { error: "Queue unavailable", candidates: connections.length, detail: message },
      { status: 503 }
    );
  }
}
