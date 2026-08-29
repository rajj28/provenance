import type { DiscoveredItem, EvidenceKind } from "../sources/types";

export type CurationResult = {
  recommendation: "add" | "skip";
  confidence: number;
  significance: number;
  roleRelevance: number;
  whyItMatters: string;
  skills: string[];
  potentialImpact: string;
  suggestedTitle: string;
  suggestedDescription: string;
  evidenceNotes: string;
  uncertainFields: string[];
  model: string;
};

function num(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

function str(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function recencyBoost(occurredAt?: Date) {
  if (!occurredAt) return 0;
  const days = (Date.now() - occurredAt.getTime()) / 86400000;
  if (days < 90) return 18;
  if (days < 365) return 10;
  if (days < 730) return 4;
  return 0;
}

function roleScore(skills: string[], targetRole?: string) {
  if (!targetRole) return 50;
  const hay = `${targetRole} ${skills.join(" ")}`.toLowerCase();
  const role = targetRole.toLowerCase();
  const keywords = role.split(/[^a-z0-9+]+/).filter((w) => w.length > 2);
  if (!keywords.length) return 50;
  const hits = keywords.filter((word) => hay.includes(word)).length;
  return clamp(35 + (hits / keywords.length) * 65);
}

function skillsFrom(item: DiscoveredItem) {
  const payload = item.payload;
  const skills = new Set<string>();
  if (typeof payload.language === "string" && payload.language) skills.add(payload.language);
  if (payload.languages && typeof payload.languages === "object") {
    Object.keys(payload.languages as Record<string, number>)
      .slice(0, 6)
      .forEach((lang) => skills.add(lang));
  }
  const topics = payload.topics;
  if (Array.isArray(topics)) topics.slice(0, 8).forEach((t) => typeof t === "string" && skills.add(t));
  const tags = payload.tags;
  if (typeof tags === "string") tags.split(",").forEach((t) => t.trim() && skills.add(t.trim()));
  if (Array.isArray(tags)) tags.forEach((t) => typeof t === "string" && skills.add(t));
  const keywords = payload.keywords;
  if (Array.isArray(keywords)) keywords.slice(0, 6).forEach((k) => typeof k === "string" && skills.add(k));
  return [...skills].slice(0, 10);
}

export function curateHeuristic(item: DiscoveredItem, targetRole?: string): CurationResult {
  const payload = item.payload;
  const skills = skillsFrom(item);
  const uncertain: string[] = [];
  let significance = 20;
  let why = "";
  let impact = "Impact is inferred only from visible source metadata.";
  let skip = false;

  if (item.kind === "project" && item.sourceType === "github") {
    const stars = num(payload, "stars");
    const forks = num(payload, "forks");
    const isFork = Boolean(payload.isFork);
    const readme = str(payload, "readmeExcerpt");
    const description = str(payload, "description") || item.summary || "";
    const releases = Array.isArray(payload.releases) ? payload.releases.length : 0;
    significance =
      18 +
      Math.min(30, Math.log10(stars + 1) * 14) +
      Math.min(12, Math.log10(forks + 1) * 10) +
      (description.length > 20 ? 8 : 0) +
      (readme.length > 400 ? 10 : 0) +
      (releases > 0 ? 10 : 0) +
      recencyBoost(item.occurredAt) -
      (isFork ? 18 : 0);

    if (isFork && stars < 10 && readme.length < 200) skip = true;
    if (!description && stars < 2 && readme.length < 120) skip = true;

    why = isFork
      ? `This is a public fork with ${stars} stars. Forks are usually weak portfolio evidence unless they show independent adoption.`
      : `Public repository with ${stars} stars, ${forks} forks${releases ? `, and ${releases} release(s)` : ""}.`;
    if (readme) impact = "README and repository metadata are the evidence; no usage metrics beyond stars/forks are assumed.";
  } else if (item.kind === "contribution") {
    const trivial = Boolean(payload.trivialHint);
    significance = trivial ? 12 : 58 + recencyBoost(item.occurredAt);
    skip = trivial;
    why = trivial
      ? "The pull request title looks like a docs/typo/chore change, which rarely belongs on a professional portfolio."
      : `Merged pull request in ${str(payload, "repo") || "an external repository"}, which can show collaboration outside your own repos.`;
    impact = "No claim is made about the size of the change; GitHub search does not always include diff stats.";
    uncertain.push("diff size");
  } else if (item.kind === "package") {
    const version = str(payload, "version");
    significance = 55 + recencyBoost(item.occurredAt);
    why = `Published package ${item.title}${version ? ` (${version})` : ""} on a public registry.`;
    impact = "Download counts are not shown unless the source API returned them.";
    if (!payload.version) uncertain.push("version");
  } else if (item.kind === "article") {
    const reactions = num(payload, "reactions") || num(payload, "reactionCount");
    significance = 40 + Math.min(25, reactions / 4) + recencyBoost(item.occurredAt);
    why = `Published technical article${reactions ? ` with ${reactions} public reactions` : ""}.`;
    if (!reactions) uncertain.push("reach");
  } else if (item.kind === "publication") {
    significance = 70 + recencyBoost(item.occurredAt);
    why = "Public scholarly work with a persistent source identifier.";
    if (payload.authorMatchUncertain) {
      uncertain.push("authorship");
      significance -= 20;
      why += " Author-name matching on arXiv can collide; treat as uncertain until confirmed.";
    }
  } else if (item.kind === "certification" || item.kind === "achievement") {
    significance = 72;
    why = "User-supplied credential or award. Only stated facts are used.";
    if (!item.occurredAt) uncertain.push("date");
  } else if (item.kind === "role") {
    // Roles come from manual import (LinkedIn and similar cannot be read via
    // their APIs), so the issuer is the employer and nothing beyond what the
    // user stated is inferred — no seniority, tenure, or scope claims.
    const issuer = str(payload, "issuer");
    significance = 78;
    why = issuer
      ? `Self-reported role at ${issuer}. Employment history is not verifiable through any API this app uses.`
      : "Self-reported role. Employment history is not verifiable through any API this app uses.";
    impact = "Stated by the user; no platform confirmed the title, dates, or scope.";
    if (!issuer) uncertain.push("employer");
    if (!item.occurredAt) uncertain.push("dates");
  } else {
    significance = 35;
    why = "Discovered activity with limited metadata.";
  }

  significance = clamp(significance);
  const recommendation: "add" | "skip" = skip || significance < 32 ? "skip" : "add";
  const title = suggestTitle(item);
  const description = suggestDescription(item, why);

  return {
    recommendation,
    confidence: skip ? 78 : uncertain.length ? 62 : 74,
    significance,
    roleRelevance: roleScore(skills, targetRole),
    whyItMatters: why,
    skills,
    potentialImpact: impact,
    suggestedTitle: title,
    suggestedDescription: description,
    evidenceNotes: evidenceLine(item),
    uncertainFields: uncertain,
    model: "heuristic-v1",
  };
}

function suggestTitle(item: DiscoveredItem) {
  if (item.kind === "role") {
    const issuer = str(item.payload, "issuer");
    return issuer && !item.title.toLowerCase().includes(issuer.toLowerCase())
      ? `${item.title} — ${issuer}`
      : item.title;
  }
  if (item.kind === "project") return humanizeProject(item.title);
  if (item.kind === "contribution") return `Open-source contribution: ${str(item.payload, "repo") || item.title}`;
  if (item.kind === "package") return `${item.title} package`;
  return item.title;
}

function humanizeProject(name: string) {
  const short = name.includes("/") ? name.split("/")[1] : name;
  return short
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function suggestDescription(item: DiscoveredItem, why: string) {
  const summary = item.summary?.trim();
  if (summary && summary.length > 40) return summary;
  return `${summary ? summary + " " : ""}${why}`.trim();
}

function evidenceLine(item: DiscoveredItem) {
  const parts: string[] = [item.sourceType, item.kind];
  if (item.url) parts.push(item.url);
  return parts.join(" · ");
}

export function shouldSkipTrivial(kind: EvidenceKind, title: string) {
  if (kind !== "contribution") return false;
  return /\b(typo|readme|docs?|whitespace|bump|chore)\b/i.test(title);
}
