import type { DiscoveredItem, SourceAdapter } from "./types";

export const devtoAdapter: SourceAdapter = {
  type: "devto",
  async identity(ctx) {
    const username = ctx.credentials.username.trim().replace(/^@/, "");
    return {
      externalUserId: username.toLowerCase(),
      displayName: username,
      profileUrl: `https://dev.to/${encodeURIComponent(username)}`,
    };
  },
  async fetch(ctx) {
    const username = ctx.credentials.username.trim().replace(/^@/, "");
    const res = await fetch(`https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=30`, {
      headers: { accept: "application/json", "user-agent": "portfolio-autopilot/1.0" },
    });
    if (!res.ok) throw new Error(`Dev.to API failed (${res.status})`);
    const articles = (await res.json()) as Array<{
      id: number;
      title: string;
      description: string;
      url: string;
      published_at: string;
      tags: string;
      positive_reactions_count: number;
      public_reactions_count?: number;
      reading_time_minutes: number;
      canonical_url?: string;
    }>;

    return articles.map((article) => ({
      sourceType: "devto" as const,
      kind: "article" as const,
      externalId: String(article.id),
      url: article.url,
      title: article.title,
      summary: article.description,
      occurredAt: article.published_at ? new Date(article.published_at) : undefined,
      payload: {
        tags: article.tags,
        reactions: article.public_reactions_count ?? article.positive_reactions_count,
        readingTimeMinutes: article.reading_time_minutes,
        canonicalUrl: article.canonical_url || null,
      },
    })) satisfies DiscoveredItem[];
  },
};
