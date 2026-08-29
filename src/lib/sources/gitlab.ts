import type { DiscoveredItem, SourceAdapter } from "./types";

export const gitlabAdapter: SourceAdapter = {
  type: "gitlab",
  async identity(ctx) {
    const res = await fetch("https://gitlab.com/api/v4/user", {
      headers: { "PRIVATE-TOKEN": ctx.credentials.accessToken },
    });
    if (!res.ok) throw new Error(`GitLab identity failed (${res.status})`);
    const me = (await res.json()) as { id: number; username: string; web_url: string };
    return {
      externalUserId: String(me.id),
      displayName: me.username,
      profileUrl: me.web_url,
    };
  },
  async fetch(ctx) {
    const res = await fetch(
      "https://gitlab.com/api/v4/projects?owned=true&simple=false&order_by=last_activity_at&per_page=40",
      { headers: { "PRIVATE-TOKEN": ctx.credentials.accessToken } }
    );
    if (!res.ok) throw new Error(`GitLab projects failed (${res.status})`);
    const projects = (await res.json()) as Array<{
      id: number;
      name_with_namespace: string;
      description: string | null;
      web_url: string;
      star_count: number;
      forks_count: number;
      last_activity_at: string;
      created_at: string;
      topics?: string[];
      visibility: string;
    }>;

    const items: DiscoveredItem[] = [];
    for (const project of projects) {
      if (project.visibility !== "public") continue;
      items.push({
        sourceType: "gitlab",
        kind: "project",
        externalId: String(project.id),
        url: project.web_url,
        title: project.name_with_namespace,
        summary: project.description || undefined,
        occurredAt: new Date(project.last_activity_at),
        payload: {
          description: project.description,
          stars: project.star_count,
          forks: project.forks_count || 0,
          topics: project.topics || [],
          createdAt: project.created_at,
          visibility: project.visibility,
        },
      });
    }
    return items;
  },
};
