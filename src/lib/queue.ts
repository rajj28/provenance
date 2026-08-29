import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { logger } from "./logger";
import { env } from "./env";

export function createRedis() {
  return new IORedis(env.REDIS_URL, {
    // BullMQ requires this; it also means a command against a down Redis waits
    // forever instead of rejecting, which is why every call below is wrapped in
    // `withTimeout`.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

let queue: Queue | null = null;
let siteQueue: Queue | null = null;
let connection: IORedis | null = null;
let siteConnection: IORedis | null = null;

export function getSyncQueue() {
  if (!queue) {
    connection = createRedis();
    queue = new Queue("source-sync", {
      connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 4000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 2000 },
      },
    });
  }
  return queue;
}

export const SITE_QUEUE = "site-publish";

export function getSiteQueue() {
  if (!siteQueue) {
    siteConnection = createRedis();
    siteQueue = new Queue(SITE_QUEUE, {
      connection: siteConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return siteQueue;
}

/**
 * Bound a Redis call so a hung connection surfaces as a rejection.
 * See the `maxRetriesPerRequest: null` note above.
 */
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${env.QUEUE_ENQUEUE_TIMEOUT_MS}ms`)),
        env.QUEUE_ENQUEUE_TIMEOUT_MS
      ).unref?.()
    ),
  ]);
}

// BullMQ silently drops an `add` whose jobId matches a retained job, so a fixed
// `sync-${connectionId}` id would let a connection sync exactly once. Bucketing by
// minute keeps burst de-duplication (a flurry of webhook pushes) while still
// allowing the next cron tick or manual sync through.
export function jobIdFor(connectionId: string, at = Date.now()) {
  return `sync-${connectionId}-${Math.floor(at / 60_000)}`;
}

/**
 * Enqueue one connection sync, falling back to running it inline when Redis is
 * unreachable. Correct for a single user-initiated action; NOT appropriate for
 * batch callers (see the cron route), which must not run syncs in-request.
 */
export async function enqueueSourceSync(connectionId: string, reason: string) {
  try {
    const syncQueue = getSyncQueue();
    await withTimeout(
      syncQueue.add("sync", { connectionId, reason }, { jobId: jobIdFor(connectionId), delay: 250 }),
      "Redis enqueue"
    );
  } catch (error) {
    logger.warn("queue_unavailable_running_inline", {
      connectionId,
      error: error instanceof Error ? error.message : "unknown",
    });
    const { runConnectionSync } = await import("./sync/engine");
    await runConnectionSync(connectionId, reason);
  }
}

/**
 * Enqueue many syncs at once. Throws if the queue is unreachable — the caller
 * decides what to do, rather than silently running a whole batch inline.
 */
export async function enqueueManySourceSyncs(connectionIds: string[], reason: string) {
  if (connectionIds.length === 0) return 0;
  const syncQueue = getSyncQueue();
  const at = Date.now();
  await withTimeout(
    syncQueue.addBulk(
      connectionIds.map((connectionId) => ({
        name: "sync",
        data: { connectionId, reason },
        opts: { jobId: jobIdFor(connectionId, at), delay: 250 },
      }))
    ),
    "Redis bulk enqueue"
  );
  return connectionIds.length;
}

/**
 * Queue a write of the member's portfolio into their own site repo.
 *
 * Coalesced per user per minute: approving five items in a row should produce
 * one commit, not five. Unlike a source sync there is no inline fallback — a
 * repo write is slow and network-bound, and must never run inside the request
 * that approved an item. If the queue is down the write is skipped; the next
 * approval or a manual "Publish now" picks it up.
 */
export async function enqueueSitePublish(userId: string, reason: string) {
  try {
    const queue = getSiteQueue();
    await withTimeout(
      queue.add(
        "publish",
        { userId, reason },
        { jobId: `site-${userId}-${Math.floor(Date.now() / 60_000)}`, delay: 5_000 }
      ),
      "Redis site enqueue"
    );
    return true;
  } catch (error) {
    logger.warn("site_publish_enqueue_failed", {
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

export function createQueueEvents() {
  return new QueueEvents("source-sync", { connection: createRedis() });
}

/** Close queue connections so a worker or script can exit cleanly. */
export async function closeQueue() {
  await queue?.close().catch(() => undefined);
  await siteQueue?.close().catch(() => undefined);
  await connection?.quit().catch(() => undefined);
  await siteConnection?.quit().catch(() => undefined);
  queue = null;
  siteQueue = null;
  connection = null;
  siteConnection = null;
}
