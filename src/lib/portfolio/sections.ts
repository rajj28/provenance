import type { EvidenceKind, SourceType } from "../sources/types";

/**
 * A portfolio is not a flat list — a hiring manager reads it by section.
 * Every piece of evidence therefore resolves to exactly one section, derived
 * from its kind (and, where a kind is ambiguous, from the source it came from).
 *
 * The mapping is total: `sectionForKind` returns a section for every
 * EvidenceKind, so nothing an adapter or import produces can fall off the page.
 */

export type PortfolioSectionId =
  | "experience"
  | "projects"
  | "open-source"
  | "writing"
  | "publications"
  | "credentials"
  | "achievements";

export type PortfolioSection = {
  id: PortfolioSectionId;
  title: string;
  blurb: string;
};

// Display order on the public page. Experience first because that is what a
// reader looks for; achievements last because they are the least self-evident.
export const PORTFOLIO_SECTIONS: PortfolioSection[] = [
  { id: "experience", title: "Experience", blurb: "Roles and positions." },
  { id: "projects", title: "Projects", blurb: "Things built end to end." },
  { id: "open-source", title: "Open source", blurb: "Published packages and contributions to other people's code." },
  { id: "writing", title: "Writing & talks", blurb: "Articles, posts, and presentations." },
  { id: "publications", title: "Publications", blurb: "Papers and scholarly work." },
  { id: "credentials", title: "Credentials", blurb: "Certifications and formal qualifications." },
  { id: "achievements", title: "Achievements", blurb: "Awards, wins, and recognition." },
];

const BY_KIND: Record<EvidenceKind, PortfolioSectionId> = {
  role: "experience",
  project: "projects",
  package: "open-source",
  contribution: "open-source",
  article: "writing",
  publication: "publications",
  certification: "credentials",
  achievement: "achievements",
};

export function sectionForKind(kind: EvidenceKind): PortfolioSectionId {
  // Object.hasOwn, not `in` or a bare lookup: `in` walks the prototype chain,
  // so "__proto__" / "toString" / "constructor" would all resolve truthy and
  // yield a non-section value from Object.prototype.
  return Object.hasOwn(BY_KIND, kind) ? BY_KIND[kind] : "achievements";
}

/**
 * Source-aware routing. Most sources map straight through their kind, but a
 * couple of cases are genuinely ambiguous and the source disambiguates them:
 * a LinkedIn "article" is a feed post that belongs with writing, while a
 * GitHub project that is really a published package should sit with open source.
 */
export function sectionForEvidence(evidence: {
  kind: string;
  sourceType: string;
  payload?: unknown;
}): PortfolioSectionId {
  const kind = evidence.kind as EvidenceKind;
  const payload = (evidence.payload ?? {}) as Record<string, unknown>;

  if (kind === "project" && evidence.sourceType === "npm") return "open-source";
  if (kind === "project" && payload.isFork === true) return "open-source";

  return sectionForKind(kind);
}

export function sectionMeta(id: PortfolioSectionId): PortfolioSection {
  return PORTFOLIO_SECTIONS.find((s) => s.id === id) ?? PORTFOLIO_SECTIONS[PORTFOLIO_SECTIONS.length - 1];
}

/**
 * Group items into sections, preserving the caller's ordering inside each
 * section and dropping sections that ended up empty.
 */
export function groupIntoSections<T extends { evidence: { kind: string; sourceType: string; payload?: unknown } }>(
  items: T[]
): { section: PortfolioSection; items: T[] }[] {
  const buckets = new Map<PortfolioSectionId, T[]>();
  for (const item of items) {
    const id = sectionForEvidence(item.evidence);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(item);
    else buckets.set(id, [item]);
  }
  return PORTFOLIO_SECTIONS.filter((s) => buckets.get(s.id)?.length).map((section) => ({
    section,
    items: buckets.get(section.id)!,
  }));
}

/** Human label for an evidence kind, used in badges. */
export const KIND_LABELS: Record<EvidenceKind, string> = {
  role: "Role",
  project: "Project",
  package: "Package",
  contribution: "Contribution",
  article: "Article",
  publication: "Publication",
  certification: "Certification",
  achievement: "Achievement",
};

export const ALL_KINDS = Object.keys(BY_KIND) as EvidenceKind[];

export function isEvidenceKind(value: string): value is EvidenceKind {
  // See sectionForKind: `value in BY_KIND` would accept "__proto__".
  return Object.hasOwn(BY_KIND, value);
}

/** Narrow an untrusted source label to a known source, for display only. */
export function sourceLabel(sourceType: SourceType | string, payload?: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (sourceType === "manual" && typeof p.sourceLabel === "string" && p.sourceLabel !== "manual") {
    return p.sourceLabel;
  }
  return sourceType;
}
