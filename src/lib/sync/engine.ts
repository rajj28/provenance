import { prisma } from "../db";
import { decryptSecret, encryptSecret, sha256 } from "../crypto";
import { logger } from "../logger";
import { fingerprintOf, type ConnectionCredentials, type DiscoveredItem, type SourceType } from "../sources/types";
import { getAdapter } from "../sources/registry";
import { curateItem } from "../curation/ai";
import { shouldReopenRejected } from "./policy";
import { applyAutopilot, settingsOf, deliveryEnabled } from "../portfolio/autopilot";

export async function runConnectionSync(connectionId: string, reason: string) {
  const connection = await prisma.sourceConnection.findUnique({
    where: { id: connectionId },
    include: { user: true },
  });
  // Disconnecting a source is a normal user action, and jobs for it may already
  // be queued. Throwing here would make BullMQ retry a job that can never
  // succeed, so a vanished connection is a quiet no-op instead.
  if (!connection) {
    logger.info("sync_skipped_connection_gone", { connectionId, reason });
    return;
  }

  const log = await prisma.syncLog.create({
    data: {
      userId: connection.userId,
      connectionId,
      sourceType: connection.sourceType,
      status: "running",
      message: reason,
    },
  });

  await prisma.sourceConnection.update({
    where: { id: connectionId },
    data: { status: "syncing", lastError: null },
  });

  try {
    const adapter = getAdapter(connection.sourceType as SourceType);
    const credentials = connection.encryptedCredentials
      ? (JSON.parse(decryptSecret(connection.encryptedCredentials)) as ConnectionCredentials)
      : {};
    const items = await adapter.fetch({ credentials, displayName: connection.displayName });
    let upserts = 0;
    let autoPublished = 0;

    for (const item of items) {
      const result = await ingestItem(connection.userId, connection.id, item, connection.user.targetRole, connection.user);
      if (result.ingested) upserts += 1;
      if (result.autoPublished) autoPublished += 1;
    }

    // One delivery for the whole sync, not one per item.
    if (autoPublished > 0 && deliveryEnabled(settingsOf(connection.user).mode)) {
      const { enqueueSitePublish } = await import("../queue");
      await enqueueSitePublish(connection.userId, `autopilot:${autoPublished}`);
    }

    await prisma.sourceConnection.update({
      where: { id: connectionId },
      data: { status: "connected", lastSyncedAt: new Date(), lastError: null },
    });
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "ok",
        itemsFound: upserts,
        finishedAt: new Date(),
        message: `Ingested ${upserts} of ${items.length} fetched records`,
      },
    });
    logger.info("sync_complete", {
      connectionId,
      sourceType: connection.sourceType,
      fetched: items.length,
      upserts,
      autoPublished,
      reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const reconnect = /401|403|rejected|invalid token|unauthorized/i.test(message);
    await prisma.sourceConnection.update({
      where: { id: connectionId },
      data: {
        status: reconnect ? "reconnect_required" : "error",
        lastError: message.slice(0, 500),
      },
    });
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "error", message, finishedAt: new Date() },
    });
    logger.error("sync_failed", { connectionId, message });
    throw error;
  }
}

export type IngestResult = { ingested: boolean; autoPublished: boolean };

export async function ingestItem(
  userId: string,
  connectionId: string | null,
  item: DiscoveredItem,
  targetRole?: string | null,
  /**
   * Autopilot settings holder. Passed in by the sync engine, which already
   * loaded the user; omitted by callers that only want ingestion.
   */
  autopilotUser?: { autopilotMode: string; autopilotMinSignificance: number; autopilotMinConfidence: number }
): Promise<IngestResult> {
  const fingerprint = fingerprintOf(item);
  const payloadHash = sha256(JSON.stringify(item.payload));
  const existing = await prisma.evidence.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
    include: { curation: true },
  });

  if (!shouldReopenRejected(existing?.status, existing?.curation?.payloadHash, payloadHash)) {
    return { ingested: false, autoPublished: false };
  }

  const evidence = await prisma.evidence.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: {
      userId,
      connectionId,
      sourceType: item.sourceType,
      kind: item.kind,
      externalId: item.externalId,
      fingerprint,
      url: item.url,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      payload: item.payload as object,
      status: "pending",
    },
    update: {
      connectionId,
      url: item.url,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      payload: item.payload as object,
      status: existing?.status === "rejected" ? "pending" : existing?.status || "pending",
    },
  });

  if (evidence.status === "approved") return { ingested: true, autoPublished: false };
  if (existing?.curation?.payloadHash === payloadHash && evidence.status !== "pending") {
    return { ingested: true, autoPublished: false };
  }

  const curation = await curateItem(item, targetRole || undefined);
  await prisma.curation.upsert({
    where: { evidenceId: evidence.id },
    create: {
      evidenceId: evidence.id,
      recommendation: curation.recommendation,
      confidence: curation.confidence,
      significance: curation.significance,
      roleRelevance: curation.roleRelevance,
      whyItMatters: curation.whyItMatters,
      skills: curation.skills,
      potentialImpact: curation.potentialImpact,
      suggestedTitle: curation.suggestedTitle,
      suggestedDescription: curation.suggestedDescription,
      evidenceNotes: curation.evidenceNotes,
      uncertainFields: curation.uncertainFields,
      model: curation.model,
      payloadHash,
    },
    update: {
      recommendation: curation.recommendation,
      confidence: curation.confidence,
      significance: curation.significance,
      roleRelevance: curation.roleRelevance,
      whyItMatters: curation.whyItMatters,
      skills: curation.skills,
      potentialImpact: curation.potentialImpact,
      suggestedTitle: curation.suggestedTitle,
      suggestedDescription: curation.suggestedDescription,
      evidenceNotes: curation.evidenceNotes,
      uncertainFields: curation.uncertainFields,
      model: curation.model,
      payloadHash,
    },
  });

  // Autopilot only ever acts on a fresh, high-confidence recommendation; see
  // shouldAutoPublish for the (deliberately strict) conditions.
  const autoPublished = autopilotUser
    ? await applyAutopilot(userId, evidence.id, settingsOf(autopilotUser), curation)
    : false;

  return { ingested: true, autoPublished };
}

export function sealCredentials(creds: ConnectionCredentials) {
  return encryptSecret(JSON.stringify(creds));
}
