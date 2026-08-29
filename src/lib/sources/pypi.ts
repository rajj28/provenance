import type { DiscoveredItem, SourceAdapter } from "./types";

// PyPI publishes an official per-project JSON API (/pypi/<name>/json) but has no
// documented endpoint that lists the projects belonging to a username — the
// /user/<name>/ page is HTML only. Rather than scrape it, the connector takes the
// project names explicitly and reads each one through the official API.
function projectNames(raw: string) {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => name.toLowerCase())
    ),
  ].slice(0, 40);
}

type ProjectJson = {
  info: {
    name: string;
    version: string;
    summary?: string;
    author?: string;
    author_email?: string;
    maintainer?: string;
    maintainer_email?: string;
    home_page?: string;
    project_url?: string;
    project_urls?: Record<string, string> | null;
    requires_python?: string;
    keywords?: string;
    license?: string;
    classifiers?: string[];
  };
  urls?: Array<{ upload_time_iso_8601?: string }>;
  releases?: Record<string, unknown>;
};

export const pypiAdapter: SourceAdapter = {
  type: "pypi",
  async identity(ctx) {
    const username = (ctx.credentials.username || "").trim();
    const first = projectNames(ctx.credentials.projects || "")[0] || "pypi";
    const handle = username || first;
    return {
      externalUserId: handle.toLowerCase(),
      displayName: username || `PyPI: ${first}`,
      profileUrl: username
        ? `https://pypi.org/user/${encodeURIComponent(username)}/`
        : `https://pypi.org/project/${encodeURIComponent(first)}/`,
    };
  },
  async fetch(ctx) {
    const names = projectNames(ctx.credentials.projects || "");
    if (!names.length) throw new Error("List at least one PyPI project name.");

    const items: DiscoveredItem[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
        headers: { accept: "application/json", "user-agent": "provenance/1.0" },
      });
      if (res.status === 404) {
        missing.push(name);
        continue;
      }
      if (!res.ok) throw new Error(`PyPI lookup for ${name} failed (${res.status})`);

      const json = (await res.json()) as ProjectJson;
      const info = json.info;
      const uploaded = json.urls?.[0]?.upload_time_iso_8601;
      const releaseCount = json.releases ? Object.keys(json.releases).length : 0;

      items.push({
        sourceType: "pypi",
        kind: "package",
        externalId: info.name,
        url: `https://pypi.org/project/${info.name}/`,
        title: info.name,
        summary: info.summary,
        occurredAt: uploaded ? new Date(uploaded) : undefined,
        payload: {
          version: info.version,
          summary: info.summary ?? null,
          author: info.author || info.author_email || null,
          maintainer: info.maintainer || info.maintainer_email || null,
          homePage: info.home_page || info.project_url || null,
          projectUrls: info.project_urls || {},
          requiresPython: info.requires_python || null,
          license: info.license || null,
          keywords: (info.keywords || "")
            .split(/[,\s]+/)
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 8),
          releaseCount,
          // PyPI's JSON API does not attribute a project to an account, so the
          // connector cannot confirm the user owns it. Curation must not claim it.
          ownershipVerified: false,
        },
      });
    }

    if (!items.length) {
      throw new Error(`No PyPI project found for: ${missing.join(", ") || names.join(", ")}`);
    }
    return items;
  },
};
