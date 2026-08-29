import type { DiscoveredItem, SourceAdapter } from "./types";

export const orcidAdapter: SourceAdapter = {
  type: "orcid",
  async identity(ctx) {
    const orcid = ctx.credentials.orcid.trim();
    return {
      externalUserId: orcid,
      displayName: orcid,
      profileUrl: `https://orcid.org/${orcid}`,
    };
  },
  async fetch(ctx) {
    const orcid = ctx.credentials.orcid.trim();
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(orcid)) {
      throw new Error("ORCID iD must look like 0000-0000-0000-0000");
    }
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/works`, {
      headers: { accept: "application/json", "user-agent": "portfolio-autopilot/1.0" },
    });
    if (res.status === 404) throw new Error("ORCID record not found or not public");
    if (!res.ok) throw new Error(`ORCID API failed (${res.status})`);
    const body = (await res.json()) as {
      group?: Array<{
        "work-summary"?: Array<{
          "put-code": number;
          title?: { title?: { value?: string } };
          "publication-date"?: { year?: { value?: string } };
          url?: { value?: string };
          type?: string;
        }>;
      }>;
    };

    const items: DiscoveredItem[] = [];
    for (const group of body.group || []) {
      const work = group["work-summary"]?.[0];
      if (!work) continue;
      const title = work.title?.title?.value;
      if (!title) continue;
      const year = work["publication-date"]?.year?.value;
      items.push({
        sourceType: "orcid",
        kind: "publication",
        externalId: String(work["put-code"]),
        url: work.url?.value || `https://orcid.org/${orcid}`,
        title,
        occurredAt: year ? new Date(`${year}-01-01`) : undefined,
        payload: {
          type: work.type || null,
          year: year || null,
          orcid,
        },
      });
    }
    return items;
  },
};
