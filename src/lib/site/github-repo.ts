import { Octokit } from "octokit";

/**
 * Writes a single file into a member's own GitHub repository.
 *
 * Two modes:
 *  - "commit": writes straight to the target branch. Fastest loop; suited to a
 *    site that rebuilds on push.
 *  - "pr": commits to a generated branch and opens a pull request, so the
 *    member reviews before their live site changes. Default, because pushing
 *    to someone's main branch unattended is not a good default.
 *
 * Everything goes through the official Contents/Git APIs — no shelling out to
 * git, no cloning, no writing anything the caller did not ask for.
 */

export type RepoTarget = {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  mode: "commit" | "pr";
};

export type WriteResult =
  | { status: "unchanged"; sha: string | null }
  | { status: "committed"; sha: string; url: string }
  | { status: "pull_request"; sha: string; url: string; number: number };

export class RepoWriteError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "RepoWriteError";
  }
}

function friendlyError(error: unknown): RepoWriteError {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : undefined;
  const raw = error instanceof Error ? error.message : "Unknown GitHub error";

  if (status === 401) return new RepoWriteError("GitHub rejected the token. Generate a new one and reconnect.", 401);
  if (status === 403) {
    return new RepoWriteError(
      "GitHub denied the write. The token needs Contents: Read and write on this repository.",
      403
    );
  }
  if (status === 404) {
    return new RepoWriteError(
      "Repository or branch not found. Check owner/repo/branch, and that the token can see this repository.",
      404
    );
  }
  if (status === 409) return new RepoWriteError("The branch moved while writing. Try again.", 409);
  if (status === 422) return new RepoWriteError(`GitHub rejected the request: ${raw}`, 422);
  return new RepoWriteError(raw, status);
}

/** Verify credentials and access before storing a target. */
export async function verifyRepoAccess(token: string, target: Omit<RepoTarget, "filePath" | "mode">) {
  const octokit = new Octokit({ auth: token });
  try {
    const repo = await octokit.rest.repos.get({ owner: target.owner, repo: target.repo });
    if (!repo.data.permissions?.push) {
      throw new RepoWriteError("The token can read this repository but cannot write to it.", 403);
    }
    // Confirm the branch exists now rather than failing on the first publish.
    await octokit.rest.repos.getBranch({ owner: target.owner, repo: target.repo, branch: target.branch });
    return {
      defaultBranch: repo.data.default_branch,
      private: repo.data.private,
      htmlUrl: repo.data.html_url,
    };
  } catch (error) {
    if (error instanceof RepoWriteError) throw error;
    throw friendlyError(error);
  }
}

async function currentFileSha(octokit: Octokit, target: RepoTarget, ref: string) {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: target.filePath,
      ref,
    });
    // A directory comes back as an array; that means the configured path is not
    // a file and the write would fail confusingly later.
    if (Array.isArray(res.data)) {
      throw new RepoWriteError(`${target.filePath} is a directory in this repository, not a file.`, 422);
    }
    return "sha" in res.data ? res.data.sha : null;
  } catch (error) {
    if (error instanceof RepoWriteError) throw error;
    // 404 simply means the file does not exist yet — the first publish creates it.
    if (typeof error === "object" && error && "status" in error && Number((error as { status: unknown }).status) === 404) {
      return null;
    }
    throw friendlyError(error);
  }
}

/** Read a file's text, or null when it does not exist on that branch. */
export async function readRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const octokit = new Octokit({ auth: token });
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(res.data)) throw new RepoWriteError(`${path} is a directory, not a file.`, 422);
    if (!("content" in res.data) || !res.data.content) return null;
    return Buffer.from(res.data.content, "base64").toString("utf8");
  } catch (error) {
    if (error instanceof RepoWriteError) throw error;
    if (typeof error === "object" && error && "status" in error && Number((error as { status: unknown }).status) === 404) {
      return null;
    }
    throw friendlyError(error);
  }
}

export async function writePortfolioFile(
  token: string,
  target: RepoTarget,
  content: string,
  commitMessage: string
): Promise<WriteResult> {
  const octokit = new Octokit({ auth: token });
  const encoded = Buffer.from(content, "utf8").toString("base64");

  try {
    if (target.mode === "commit") {
      const sha = await currentFileSha(octokit, target, target.branch);
      const res = await octokit.rest.repos.createOrUpdateFileContents({
        owner: target.owner,
        repo: target.repo,
        path: target.filePath,
        message: commitMessage,
        content: encoded,
        branch: target.branch,
        ...(sha ? { sha } : {}),
      });
      return {
        status: "committed",
        sha: res.data.commit.sha ?? "",
        url: res.data.commit.html_url ?? "",
      };
    }

    // PR mode: branch off the target branch, commit there, open a PR.
    const base = await octokit.rest.repos.getBranch({
      owner: target.owner,
      repo: target.repo,
      branch: target.branch,
    });
    const head = `provenance/portfolio-${Date.now().toString(36)}`;

    await octokit.rest.git.createRef({
      owner: target.owner,
      repo: target.repo,
      ref: `refs/heads/${head}`,
      sha: base.data.commit.sha,
    });

    // Look up the blob sha on the base branch: the new branch is identical to
    // it, and updating an existing path requires the current sha.
    const sha = await currentFileSha(octokit, target, target.branch);
    const commit = await octokit.rest.repos.createOrUpdateFileContents({
      owner: target.owner,
      repo: target.repo,
      path: target.filePath,
      message: commitMessage,
      content: encoded,
      branch: head,
      ...(sha ? { sha } : {}),
    });

    const pr = await octokit.rest.pulls.create({
      owner: target.owner,
      repo: target.repo,
      title: commitMessage,
      head,
      base: target.branch,
      body: [
        "Automated portfolio sync from Provenance.",
        "",
        `Updates \`${target.filePath}\` with the items you approved.`,
        "Only this file is changed. Merge when you are happy with it.",
      ].join("\n"),
    });

    return {
      status: "pull_request",
      sha: commit.data.commit.sha ?? "",
      url: pr.data.html_url,
      number: pr.data.number,
    };
  } catch (error) {
    if (error instanceof RepoWriteError) throw error;
    throw friendlyError(error);
  }
}

/**
 * Parse the many shapes a user might paste into a repository field:
 * "owner/repo", a browser URL, an .git clone URL, or an SSH remote.
 */
export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const patterns = [
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i,
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * Normalise a file path for the Contents API: no leading slash, no traversal,
 * and it must land inside the repository.
 *
 * `allowSource` widens the extension allowlist to .ts/.tsx/.js/.jsx, which is
 * only ever passed by append mode. The "own a data file" strategy stays
 * JSON-only, because that path overwrites the whole file — it must never be
 * pointed at a module.
 */
export function normalizeFilePath(input: string, allowSource = false): string | null {
  const trimmed = input.trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  if (trimmed.length > 255) return null;
  const segments = trimmed.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const allowed = allowSource ? /\.(json|jsonc|tsx?|jsx?|mjs|cjs)$/i : /\.(json|jsonc)$/i;
  if (!allowed.test(trimmed)) return null;
  return trimmed;
}
