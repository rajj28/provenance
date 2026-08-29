import OpenAI from "openai";
import type { DiscoveredItem } from "../sources/types";
import { curateHeuristic, type CurationResult } from "./heuristic";
import { logger } from "../logger";

const SYSTEM = `You curate professional portfolio evidence.
You receive ONLY facts extracted from official APIs or the user.
Never invent stars, downloads, rankings, job titles, company names, or outcomes.
If a fact is missing, list it in uncertainFields.
Skip trivial work: typos, readme-only PRs, empty repos, homework dumps, and generic tutorial clones without unique substance.
Recommend "add" only when a hiring manager would reasonably want this on a portfolio.
Return JSON with keys:
recommendation ("add"|"skip"), confidence (0-100), significance (0-100), roleRelevance (0-100),
whyItMatters, skills (string[]), potentialImpact, suggestedTitle, suggestedDescription,
evidenceNotes, uncertainFields (string[]).
Tone: specific, calm, professional. No hype, no emojis.`;

export async function curateItem(item: DiscoveredItem, targetRole?: string): Promise<CurationResult> {
  const fallback = curateHeuristic(item, targetRole);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            targetRole: targetRole || null,
            item: {
              sourceType: item.sourceType,
              kind: item.kind,
              title: item.title,
              summary: item.summary,
              url: item.url,
              occurredAt: item.occurredAt,
              payload: item.payload,
            },
            heuristicHint: fallback,
          }),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CurationResult>;
    return {
      recommendation: parsed.recommendation === "skip" ? "skip" : "add",
      confidence: Number(parsed.confidence) || fallback.confidence,
      significance: Number(parsed.significance) || fallback.significance,
      roleRelevance: Number(parsed.roleRelevance) || fallback.roleRelevance,
      whyItMatters: parsed.whyItMatters || fallback.whyItMatters,
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 12) : fallback.skills,
      potentialImpact: parsed.potentialImpact || fallback.potentialImpact,
      suggestedTitle: parsed.suggestedTitle || fallback.suggestedTitle,
      suggestedDescription: parsed.suggestedDescription || fallback.suggestedDescription,
      evidenceNotes: parsed.evidenceNotes || fallback.evidenceNotes,
      uncertainFields: Array.isArray(parsed.uncertainFields)
        ? parsed.uncertainFields
        : fallback.uncertainFields,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
  } catch (error) {
    logger.warn("ai_curation_failed_using_heuristic", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return fallback;
  }
}
