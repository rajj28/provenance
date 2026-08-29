import { prisma } from "../db";
import { groupIntoSections, KIND_LABELS, sectionForEvidence, sourceLabel } from "./sections";
import type { EvidenceKind } from "../sources/types";

/**
 * The canonical portable representation of a portfolio.
 *
 * Both delivery paths render from this one builder — the public JSON feed that
 * `embed.js` fetches, and the file committed into a user's own site repo — so
 * a site built against the feed and a site built against the committed file can
 * never disagree.
 *
 * `schemaVersion` is part of the contract: consumers live on other people's
 * websites and are not redeployed when we ship. Add fields freely; rename or
 * remove one only by bumping the major version.
 */
export const PORTFOLIO_SCHEMA_VERSION = "1.0";

export type PayloadLink = { label: string; url: string };

export type PayloadItem = {
  id: string;
  title: string;
  summary: string;
  description: string;
  role: string | null;
  impact: string | null;
  skills: string[];
  kind: string;
  kindLabel: string;
  source: string;
  url: string | null;
  occurredAt: string | null;
  year: number | null;
  links: PayloadLink[];
};

export type PayloadSection = {
  id: string;
  title: string;
  blurb: string;
  items: PayloadItem[];
};

export type PortfolioPayload = {
  schemaVersion: string;
  generatedAt: string;
  profile: {
    name: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    targetRole: string | null;
    slug: string;
    url: string;
  };
  skills: string[];
  sections: PayloadSection[];
  /** Flat list in display order, for consumers that do their own grouping. */
  items: PayloadItem[];
  counts: { items: number; sections: number };
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function linkArray(value: unknown): PayloadLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { label, url } = entry as { label?: unknown; url?: unknown };
    if (typeof url !== "string" || !url) return [];
    return [{ label: typeof label === "string" && label ? label : "Link", url }];
  });
}

type ItemRow = {
  id: string;
  title: string;
  summary: string;
  description: string;
  role: string | null;
  impact: string | null;
  skills: unknown;
  links: unknown;
  evidence: { kind: string; sourceType: string; url: string | null; occurredAt: Date | null; payload: unknown };
};

function toPayloadItem(item: ItemRow): PayloadItem {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    description: item.description,
    role: item.role,
    impact: item.impact,
    skills: stringArray(item.skills),
    kind: item.evidence.kind,
    kindLabel: KIND_LABELS[item.evidence.kind as EvidenceKind] || item.evidence.kind,
    source: sourceLabel(item.evidence.sourceType, item.evidence.payload),
    url: item.evidence.url,
    occurredAt: item.evidence.occurredAt ? item.evidence.occurredAt.toISOString() : null,
    year: item.evidence.occurredAt ? item.evidence.occurredAt.getUTCFullYear() : null,
    links: linkArray(item.links),
  };
}

/** Shape a loaded user + items into the portable payload. */
export function buildPayload(
  user: {
    name: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    targetRole: string | null;
    slug: string;
  },
  items: ItemRow[],
  appUrl: string
): PortfolioPayload {
  const sections = groupIntoSections(items).map(({ section, items: sectionItems }) => ({
    id: section.id,
    title: section.title,
    blurb: section.blurb,
    items: sectionItems.map(toPayloadItem),
  }));

  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    profile: {
      name: user.name,
      headline: user.headline,
      bio: user.bio,
      location: user.location,
      targetRole: user.targetRole,
      slug: user.slug,
      url: `${appUrl}/p/${user.slug}`,
    },
    skills: [...new Set(items.flatMap((item) => stringArray(item.skills)))].slice(0, 32),
    sections,
    items: items.map(toPayloadItem),
    counts: { items: items.length, sections: sections.length },
  };
}

/**
 * Load and build for a public slug. Returns null when the portfolio does not
 * exist or the member has made it private — the caller turns that into a 404,
 * so a private portfolio is indistinguishable from a missing one.
 */
export async function loadPayloadBySlug(slug: string, appUrl: string): Promise<PortfolioPayload | null> {
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user || !user.publicPortfolio) return null;
  const items = await prisma.portfolioItem.findMany({
    where: { userId: user.id, published: true },
    include: { evidence: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return buildPayload(user, items, appUrl);
}

/**
 * Same payload for a known user id, bypassing the public/private check.
 * Used by the repo writer, which publishes to the member's own site at their
 * explicit request — `publicPortfolio` governs *our* hosted page, not theirs.
 */
export async function loadPayloadByUserId(userId: string, appUrl: string): Promise<PortfolioPayload | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const items = await prisma.portfolioItem.findMany({
    where: { userId, published: true },
    include: { evidence: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return buildPayload(user, items, appUrl);
}

/**
 * Deterministic JSON for change detection.
 *
 * `generatedAt` moves on every build, so committing the raw payload would
 * produce a commit on every sync even when nothing changed. Hashing the
 * payload minus that field is what lets the repo writer skip no-op commits.
 */
export function stableContent(payload: PortfolioPayload): string {
  const { generatedAt: _ignored, ...rest } = payload;
  void _ignored;
  return JSON.stringify(rest, null, 2);
}

export { sectionForEvidence };
