import { env } from "./env";
import { logger } from "./logger";

/**
 * Fixed-window rate limiter.
 *
 * Redis is the shared backend so the limit holds across every app instance.
 * When Redis is unavailable we fall back to a per-process in-memory window
 * rather than failing open entirely: a single instance still throttles, and the
 * degradation is logged. Auth endpoints are the reason this exists — an
 * unthrottled credentials login is a free credential-stuffing oracle.
 */

type Result = { ok: boolean; remaining: number; retryAfterSeconds: number };

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowSeconds: number): Result {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) return { ok: false, remaining: 0, retryAfterSeconds };
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds };
}

// Bound the map so a flood of distinct keys cannot grow it without limit.
function sweepMemory() {
  if (memory.size < 10_000) return;
  const now = Date.now();
  for (const [key, value] of memory) {
    if (value.resetAt <= now) memory.delete(key);
  }
}

let redisClient: import("ioredis").default | null = null;
let redisBroken = false;

async function getRedis() {
  if (redisBroken) return null;
  if (redisClient) return redisClient;
  try {
    const { default: IORedis } = await import("ioredis");
    redisClient = new IORedis(env.REDIS_URL, {
      // Unlike the BullMQ connection, this one must fail fast: a rate-limit
      // check is on the request path and cannot wait on a dead Redis.
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on("error", () => {
      /* handled per-command below; the listener stops an unhandled 'error' event */
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    redisBroken = true;
    return null;
  }
}

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit = env.AUTH_RATE_LIMIT,
  windowSeconds = env.AUTH_RATE_WINDOW_S
): Promise<Result> {
  sweepMemory();
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${bucket}:${identifier}:${window}`;

  const redis = await getRedis();
  if (!redis) return memoryLimit(key, limit, windowSeconds);

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    const ttl = await redis.ttl(key);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
    if (count > limit) return { ok: false, remaining: 0, retryAfterSeconds };
    return { ok: true, remaining: limit - count, retryAfterSeconds };
  } catch (error) {
    logger.warn("ratelimit_redis_unavailable_using_memory", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return memoryLimit(key, limit, windowSeconds);
  }
}

/** Test seam: drop in-process state between cases. */
export function __resetRateLimitMemory() {
  memory.clear();
}
