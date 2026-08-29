import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createRedis } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for containers and load balancers.
 *
 * Postgres is a hard dependency: without it the app cannot serve anything, so
 * a failure here is a 503. Redis is soft — `enqueueSourceSync` falls back to
 * running syncs inline — so it is reported as degraded but still 200, which
 * stops an orchestrator from cycling healthy web pods over a queue outage.
 */

async function checkDatabase() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: message(error) };
  }
}

async function checkRedis() {
  const started = Date.now();
  const client = createRedis();
  try {
    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("ping timed out")), 1500).unref?.()),
    ]);
    return { ok: pong === "PONG", latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: message(error) };
  } finally {
    client.disconnect();
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "unknown";
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const status = !database.ok ? "unhealthy" : redis.ok ? "healthy" : "degraded";
  return NextResponse.json(
    { status, checks: { database, redis }, uptimeSeconds: Math.round(process.uptime()), ts: new Date().toISOString() },
    { status: database.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
