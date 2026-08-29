import type { DiscoveredItem, SourceAdapter } from "./types";

export const kaggleAdapter: SourceAdapter = {
  type: "kaggle",
  async identity(ctx) {
    const username = ctx.credentials.username.trim();
    return {
      externalUserId: username.toLowerCase(),
      displayName: username,
      profileUrl: `https://www.kaggle.com/${encodeURIComponent(username)}`,
    };
  },
  async fetch(ctx) {
    const username = ctx.credentials.username.trim();
    const apiKey = ctx.credentials.apiKey.trim();
    const auth = Buffer.from(`${username}:${apiKey}`).toString("base64");
    const res = await fetch(
      `https://www.kaggle.com/api/v1/kernels/list?user=${encodeURIComponent(username)}&pageSize=20`,
      {
        headers: {
          authorization: `Basic ${auth}`,
          "user-agent": "portfolio-autopilot/1.0",
        },
      }
    );
    if (res.status === 401) throw new Error("Kaggle credentials were rejected");
    if (!res.ok) throw new Error(`Kaggle API failed (${res.status})`);
    const kernels = (await res.json()) as Array<{
      id?: number;
      ref?: string;
      title?: string;
      url?: string;
      totalVotes?: number;
      lastRunTime?: string;
      languageName?: string;
    }>;

    return (Array.isArray(kernels) ? kernels : []).map((kernel) => ({
      sourceType: "kaggle" as const,
      kind: "project" as const,
      externalId: String(kernel.ref || kernel.id),
      url: kernel.url || (kernel.ref ? `https://www.kaggle.com/${kernel.ref}` : undefined),
      title: kernel.title || kernel.ref || "Kaggle kernel",
      occurredAt: kernel.lastRunTime ? new Date(kernel.lastRunTime) : undefined,
      payload: {
        ref: kernel.ref || null,
        votes: kernel.totalVotes || 0,
        language: kernel.languageName || null,
        note: "Kaggle competition rank is not ingested unless the API returns it for this account.",
      },
    })) satisfies DiscoveredItem[];
  },
};
