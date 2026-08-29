import { prisma } from "../db";
import { logger } from "../logger";

/**
 * Autopilot — how much the system does without the member present.
 *
 * The product goal is "connect once and forget", but a portfolio is a set of
 * claims about a real person, and this app's core promise is that it never
 * asserts what the evidence does not support. So autopilot is a dial, not a
 * switch: the member chooses how much trust to delegate, and even the most
 * permissive setting only auto-publishes items the curator scored highly and
 * recommended. Everything else still queues for review.
 */

export type AutopilotMode = "auto" | "review" | "draft";

export const AUTOPILOT_MODES: { value: AutopilotMode; label: string; blurb: string }[] = [
  {
    value: "auto",
    label: "Auto-publish",
    blurb:
      "High-confidence discoveries publish themselves and reach your website. Anything the curator is unsure about still waits for you.",
  },
  {
    value: "review",
    label: "Review first",
    blurb: "Everything is prepared and scored, and nothing goes live until you approve it. The default.",
  },
  {
    value: "draft",
    label: "Draft only",
    blurb: "Keep discovering and curating, but never change your live website. Delivery is paused.",
  },
];

export function isAutopilotMode(value: string): value is AutopilotMode {
  return value === "auto" || value === "review" || value === "draft";
}

export type AutopilotSettings = {
  mode: AutopilotMode;
  minSignificance: number;
  minConfidence: number;
};

export function settingsOf(user: {
  autopilotMode: string;
  autopilotMinSignificance: number;
  autopilotMinConfidence: number;
}): AutopilotSettings {
  return {
    mode: isAutopilotMode(user.autopilotMode) ? user.autopilotMode : "review",
    minSignificance: user.autopilotMinSignificance,
    minConfidence: user.autopilotMinConfidence,
  };
}

/** Whether delivery to the member's own website is currently allowed. */
export function deliveryEnabled(mode: AutopilotMode) {
  return mode !== "draft";
}

/**
 * Decide whether a freshly curated item may publish itself.
 *
 * Deliberately conservative: the curator must actively recommend it AND clear
 * both thresholds AND have no uncertain fields. An item flagged uncertain is
 * exactly the kind that should not appear on someone's portfolio unattended.
 */
export function shouldAutoPublish(
  settings: AutopilotSettings,
  curation: {
    recommendation: string;
    significance: number;
    confidence: number;
    uncertainFields: unknown;
  }
): boolean {
  if (settings.mode !== "auto") return false;
  if (curation.recommendation !== "add") return false;
  if (curation.significance < settings.minSignificance) return false;
  if (curation.confidence < settings.minConfidence) return false;
  const uncertain = Array.isArray(curation.uncertainFields) ? curation.uncertainFields : [];
  if (uncertain.length > 0) return false;
  return true;
}

/**
 * Turn approved evidence into a published portfolio item.
 *
 * Shared by the review action and by autopilot so the two paths cannot drift —
 * an auto-published item is identical to a hand-approved one, and both are
 * equally editable and reversible afterwards.
 */
export async function publishEvidence(userId: string, evidenceId: string) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, userId },
    include: { curation: true },
  });
  if (!evidence) return null;

  const title = evidence.curation?.suggestedTitle || evidence.title;
  const summary = evidence.summary || evidence.curation?.whyItMatters || "";
  const description = evidence.curation?.suggestedDescription || summary;
  const skills = (evidence.curation?.skills as string[]) || [];

  await prisma.evidence.update({ where: { id: evidence.id }, data: { status: "approved" } });

  return prisma.portfolioItem.upsert({
    where: { evidenceId: evidence.id },
    create: {
      userId,
      evidenceId: evidence.id,
      title,
      summary,
      description,
      skills,
      impact: evidence.curation?.potentialImpact,
      links: evidence.url ? [{ label: "Source", url: evidence.url }] : [],
      published: true,
    },
    update: { title, summary, description, skills, impact: evidence.curation?.potentialImpact, published: true },
  });
}

/**
 * Apply autopilot to one just-curated item. Returns true if it published.
 * Never throws into the sync path: a failure here must not fail the sync that
 * discovered the item.
 */
export async function applyAutopilot(
  userId: string,
  evidenceId: string,
  settings: AutopilotSettings,
  curation: { recommendation: string; significance: number; confidence: number; uncertainFields: unknown }
): Promise<boolean> {
  if (!shouldAutoPublish(settings, curation)) return false;
  try {
    const item = await publishEvidence(userId, evidenceId);
    if (!item) return false;
    logger.info("autopilot_published", {
      userId,
      evidenceId,
      significance: curation.significance,
      confidence: curation.confidence,
    });
    return true;
  } catch (error) {
    logger.error("autopilot_publish_failed", {
      userId,
      evidenceId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
