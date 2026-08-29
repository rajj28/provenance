import { Octokit } from "octokit";
import type { DiscoveredItem, SourceAdapter } from "./types";

const TRIVIAL_PR = /\b(typo|readme|docs?|whitespace|bump|chore|ci|lockfile)\b/i;

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const status = Number((error as { status?: number }).status);
      if (status === 403 || status === 429) {
        const wait = 1000 * (i + 1) * 2;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw last;
}

export const githubAdapter: SourceAdapter = {
  type: "github",
  async identity(ctx) {
    const octokit = new Octokit({ auth: ctx.credentials.accessToken });
    const { data } = await octokit.rest.users.getAuthenticated();
    return {
      externalUserId: String(data.id),
      displayName: data.login,
      profileUrl: data.html_url,
    };
  },
  async fetch(ctx) {
    const octokit = new Octokit({ auth: ctx.credentials.accessToken });
    const { data: me } = await withRetry(() => octokit.rest.users.getAuthenticated());
    const items: DiscoveredItem[] = [];

    const repos = await withRetry(() =>
      octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
        per_page: 100,
        affiliation: "owner",
        sort: "pushed",
        visibility: "public",
      })
    );

    const ranked = [...repos]
      .filter((repo) => !repo.private)
      .sort((a, b) => Date.parse(b.pushed_at || "0") - Date.parse(a.pushed_at || "0"))
      .slice(0, 40);

    for (const repo of ranked) {
      if (repo.fork && (repo.stargazers_count || 0) < 5) continue;

      const [languages, readme, releases] = await Promise.all([
        withRetry(() => octokit.rest.repos.listLanguages({ owner: repo.owner.login, repo: repo.name }))
          .then((r) => r.data)
          .catch(() => ({})),
        withRetry(() => octokit.rest.repos.getReadme({ owner: repo.owner.login, repo: repo.name }))
          .then((r) => Buffer.from(r.data.content, "base64").toString("utf8").slice(0, 3500))
          .catch(() => ""),
        withRetry(() =>
          octokit.rest.repos.listReleases({ owner: repo.owner.login, repo: repo.name, per_page: 3 })
        )
          .then((r) =>
            r.data.map((rel) => ({
              tag: rel.tag_name,
              name: rel.name,
              url: rel.html_url,
              publishedAt: rel.published_at,
              prerelease: rel.prerelease,
            }))
          )
          .catch(() => []),
      ]);

      items.push({
        sourceType: "github",
        kind: "project",
        externalId: String(repo.id),
        url: repo.html_url,
        title: repo.full_name,
        summary: repo.description || undefined,
        occurredAt: repo.pushed_at ? new Date(repo.pushed_at) : undefined,
        payload: {
          fullName: repo.full_name,
          description: repo.description,
          homepage: repo.homepage,
          language: repo.language,
          languages,
          topics: repo.topics || [],
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
          watchers: repo.watchers_count || 0,
          openIssues: repo.open_issues_count || 0,
          isFork: repo.fork,
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at,
          license: repo.license?.spdx_id || null,
          defaultBranch: repo.default_branch,
          readmeExcerpt: readme,
          releases,
          ownerLogin: me.login,
        },
      });
    }

    const prSearch = await withRetry(() =>
      octokit.request("GET /search/issues", {
        q: `author:${me.login} type:pr is:merged`,
        sort: "updated",
        per_page: 30,
      })
    ).catch(() => ({ data: { items: [] as Array<{ title: string; html_url: string; repository_url: string; pull_request?: { merged_at?: string }; labels: { name: string }[]; created_at: string }> } }));

    for (const pr of prSearch.data.items) {
      const repoUrl = pr.repository_url.replace("api.github.com/repos", "github.com");
      const repoName = repoUrl.replace("https://github.com/", "");
      const owned = repoName.toLowerCase().startsWith(`${me.login.toLowerCase()}/`);
      if (owned) continue;
      items.push({
        sourceType: "github",
        kind: "contribution",
        externalId: pr.html_url,
        url: pr.html_url,
        title: pr.title,
        summary: `Merged pull request in ${repoName}`,
        occurredAt: pr.pull_request?.merged_at ? new Date(pr.pull_request.merged_at) : new Date(pr.created_at),
        payload: {
          title: pr.title,
          repo: repoName,
          url: pr.html_url,
          labels: pr.labels?.map((l) => l.name) || [],
          trivialHint: TRIVIAL_PR.test(pr.title),
          author: me.login,
        },
      });
    }

    return items;
  },
};
