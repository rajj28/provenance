import type { DiscoveredItem, SourceAdapter } from "./types";

function xmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim() : "";
}

export const arxivAdapter: SourceAdapter = {
  type: "arxiv",
  async identity(ctx) {
    const author = ctx.credentials.author.trim();
    return { externalUserId: author.toLowerCase(), displayName: author };
  },
  async fetch(ctx) {
    const author = ctx.credentials.author.trim();
    const query = `au:${author.replace(/\s+/g, "_")}`;
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=20`;
    const res = await fetch(url, { headers: { "user-agent": "portfolio-autopilot/1.0" } });
    if (!res.ok) throw new Error(`arXiv API failed (${res.status})`);
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    const items: DiscoveredItem[] = [];
    for (const entry of entries) {
      const id = xmlText(entry, "id");
      const title = xmlText(entry, "title").replace(/\s+/g, " ");
      const summary = xmlText(entry, "summary").replace(/\s+/g, " ").slice(0, 800);
      const published = xmlText(entry, "published");
      const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
      if (!id || !title) continue;
      items.push({
        sourceType: "arxiv",
        kind: "publication",
        externalId: id,
        url: id.replace("http://", "https://"),
        title,
        summary,
        occurredAt: published ? new Date(published) : undefined,
        payload: {
          authors,
          queriedAuthor: author,
          authorMatchUncertain: !authors.some((name) =>
            name.toLowerCase().includes(author.split(" ").pop()?.toLowerCase() || author.toLowerCase())
          ),
        },
      });
    }
    return items;
  },
};
