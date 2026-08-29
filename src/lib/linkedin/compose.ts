import { MAX_COMMENTARY } from "./client";
import { sectionForEvidence, type PortfolioSectionId } from "../portfolio/sections";

/**
 * Draft LinkedIn post text from an approved portfolio item.
 *
 * This composes a *draft* that the member edits and explicitly sends — nothing
 * is ever posted automatically. The draft deliberately restates only facts the
 * item already carries: no invented metrics, no hype adjectives, no claims the
 * evidence does not support. That is the same rule the curator follows.
 */

export type ComposableItem = {
  title: string;
  summary: string;
  description: string;
  impact: string | null;
  skills: unknown;
  evidence: { kind: string; sourceType: string; url: string | null; payload?: unknown };
};

const OPENERS: Record<PortfolioSectionId, string> = {
  experience: "A role I want to record:",
  projects: "Something I built:",
  "open-source": "Open-source work:",
  writing: "I wrote something:",
  publications: "New publication:",
  credentials: "Newly certified:",
  achievements: "Recognition worth sharing:",
};

function skillList(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/**
 * Hashtags must be alphanumeric — LinkedIn's little format reserves underscore
 * and dash, so a skill like "machine-learning" becomes "machinelearning".
 */
function hashtagify(skill: string) {
  const cleaned = skill.replace(/[^A-Za-z0-9]/g, "");
  if (!cleaned || !/^[A-Za-z]/.test(cleaned)) return null;
  return `#${cleaned}`;
}

export function composePost(item: ComposableItem, portfolioUrl?: string): string {
  const section = sectionForEvidence(item.evidence);
  const lines: string[] = [];

  lines.push(`${OPENERS[section]} ${item.title}`.trim());

  const body = (item.summary || item.description || "").trim();
  if (body) lines.push("", body);

  if (item.impact?.trim()) lines.push("", item.impact.trim());

  const tags = skillList(item.skills)
    .slice(0, 5)
    .map(hashtagify)
    .filter((t): t is string => Boolean(t));

  const links: string[] = [];
  if (item.evidence.url) links.push(item.evidence.url);
  if (portfolioUrl) links.push(`More context: ${portfolioUrl}`);
  if (links.length) lines.push("", ...links);

  if (tags.length) lines.push("", tags.join(" "));

  const text = lines.join("\n").trim();
  return text.length > MAX_COMMENTARY ? `${text.slice(0, MAX_COMMENTARY - 1).trimEnd()}…` : text;
}
