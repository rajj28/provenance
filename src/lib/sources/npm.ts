import type { DiscoveredItem, SourceAdapter } from "./types";

export const npmAdapter: SourceAdapter = {
  type: "npm",
  async identity(ctx) {
    const username = ctx.credentials.username.trim();
    return {
      externalUserId: username.toLowerCase(),
      displayName: username,
      profileUrl: `https://www.npmjs.com/~${encodeURIComponent(username)}`,
    };
  },
  async fetch(ctx) {
    const username = ctx.credentials.username.trim();
    const url = `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(username)}&size=40`;
    const res = await fetch(url, { headers: { "user-agent": "provenance/1.0" } });
    if (!res.ok) throw new Error(`npm registry search failed (${res.status})`);
    const body = (await res.json()) as {
      objects?: Array<{
        package: {
          name: string;
          version: string;
          description?: string;
          date?: string;
          links?: { npm?: string; repository?: string };
          keywords?: string[];
          publisher?: { username?: string };
        };
      }>;
    };

    const items: DiscoveredItem[] = [];
    for (const object of body.objects || []) {
      const pkg = object.package;
      items.push({
        sourceType: "npm",
        kind: "package",
        externalId: pkg.name,
        url: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
        title: pkg.name,
        summary: pkg.description,
        occurredAt: pkg.date ? new Date(pkg.date) : undefined,
        payload: {
          version: pkg.version,
          description: pkg.description,
          keywords: pkg.keywords || [],
          repository: pkg.links?.repository || null,
          publisher: pkg.publisher?.username || null,
        },
      });
    }
    return items;
  },
};
