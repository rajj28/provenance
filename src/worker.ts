import { Worker } from "bullmq";
import { createRedis, closeQueue, SITE_QUEUE } from "./lib/queue";
import { runConnectionSync } from "./lib/sync/engine";
import { publishToSite } from "./lib/site/publish";
import { logger } from "./lib/logger";
import { prisma } from "./lib/db";
import { env } from "./lib/env";

const connection = createRedis();
const siteConnection = createRedis();

const worker = new Worker(
  "source-sync",
  async (job) => {
    const connectionId = String(job.data.connectionId);
    const reason = String(job.data.reason || "queued");
    logger.info("worker_job_start", { jobId: job.id, connectionId, reason });
    await runConnectionSync(connectionId, reason);
  },
  {
    connection,
    concurrency: env.SYNC_CONCURRENCY,
  }
);

worker.on("failed", (job, error) => {
  logger.error("worker_job_failed", { jobId: job?.id, message: error.message });
});

worker.on("completed", (job) => {
  logger.info("worker_job_done", { jobId: job.id });
});

worker.on("error", (error) => {
  logger.error("worker_error", { message: error.message });
});

/**
 * Separate worker for writes into members' own repositories.
 *
 * Kept off the sync queue on purpose: a repo write is slow and rate-limited by
 * GitHub, and a backlog of them must not starve source discovery. Concurrency
 * is deliberately low for the same reason.
 */
const siteWorker = new Worker(
  SITE_QUEUE,
  async (job) => {
    const userId = String(job.data.userId);
    const reason = String(job.data.reason || "queued");
    logger.info("site_job_start", { jobId: job.id, userId, reason });
    const result = await publishToSite(userId, reason);
    logger.info("site_job_result", { jobId: job.id, userId, status: result.status });
  },
  { connection: siteConnection, concurrency: 2 }
);

siteWorker.on("failed", (job, error) => {
  logger.error("site_job_failed", { jobId: job?.id, message: error.message });
});

siteWorker.on("error", (error) => {
  logger.error("site_worker_error", { message: error.message });
});

/**
 * Graceful shutdown.
 *
 * A container runtime sends SIGTERM and then SIGKILLs after a grace period.
 * `worker.close()` stops accepting new jobs and waits for in-flight ones, so a
 * deploy does not abandon a half-finished sync with its connection stuck in the
 * "syncing" state. The force-exit timer bounds that wait.
 */
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker_shutdown_start", { signal });

  const force = setTimeout(() => {
    logger.error("worker_shutdown_forced", { signal });
    process.exit(1);
  }, 25_000);
  force.unref();

  try {
    await Promise.all([worker.close(), siteWorker.close()]);
    await closeQueue();
    await connection.quit().catch(() => undefined);
    await siteConnection.quit().catch(() => undefined);
    await prisma.$disconnect();
    logger.info("worker_shutdown_complete", { signal });
    process.exit(0);
  } catch (error) {
    logger.error("worker_shutdown_failed", { message: error instanceof Error ? error.message : "unknown" });
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("worker_unhandled_rejection", { message: reason instanceof Error ? reason.message : String(reason) });
});

logger.info("worker_listening", { queue: "source-sync", concurrency: env.SYNC_CONCURRENCY });
logger.info("worker_listening", { queue: SITE_QUEUE, concurrency: 2 });
