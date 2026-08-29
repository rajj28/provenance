import { Octokit } from "octokit";
import { locateJsonArray, AppendError } from "./append";
import { locateTsArray, isSourceModule } from "./ts-append";
import { inferSchema, isUsableSchema, type InferredSchema } from "./schema-infer";

/**
 * Find the content file a member's site *already* renders, so new work can be
 * appended to it rather than dropped into a new file they must wire up.
 *
 * Scope is deliberately narrow. We look only in the handful of directories
 * every static-site generator uses for exactly this purpose, and only accept a
 * file when we can both locate its array of entries and infer its field names.
 * Anything else is reported as unsupported instead of guessed at.
 *
 * Two file kinds are supported:
 *   - JSON data files, parsed and re-serialised with an append-only proof.
 *   - .ts/.tsx/.js/.jsx modules exporting a hardcoded array, handled by a real
 *     TypeScript parser (see ./ts-append.ts). We read the array, we insert one
 *     element, and we never re-print or reformat the file.
 *
 * We still never reason about application *logic* — only a module-level array
 * of object literals qualifies. An array built by a function call, assembled
 * from spreads, or nested inside a component is refused, not guessed at.
 */

export type ContentCandidate = {
  path: string;
  entryCount: number;
  schema: InferredSchema;
  /** Rows as currently stored, used for type-matching and de-duplication. */
  rows: unknown[];
  kind: "json" | "module";
  /** For modules: the exported binding holding the array. */
  exportName?: string;
  /** Keys present in the file that we cannot read statically (JSX, imports). */
  opaqueKeys: string[];
};

export type DiscoveryResult = {
  candidates: ContentCandidate[];
  /** Paths that looked like content but could not be used, with the reason. */
  rejected: { path: string; reason: string }[];
};

const SEARCH_DIRS = [
  "data",
  "src/data",
  "_data",
  "src/_data",
  "content",
  "src/content",
  "app/data",
  "public/data",
  // Modules commonly live alongside components rather than in a data folder.
  "src",
  "src/config",
  "src/constants",
  "config",
  "lib",
  "src/lib",
];

// Files that are configuration or lockfiles, never content.
const IGNORE = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "jsconfig.json",
  "composer.json",
  "manifest.json",
  "vercel.json",
  "netlify.json",
  "renovate.json",
  "components.json",
]);

function isCandidatePath(path: string) {
  const isJson = path.endsWith(".json");
  const isModule = isSourceModule(path);
  if (!isJson && !isModule) return false;

  const base = path.split("/").pop() ?? "";
  if (IGNORE.has(base)) return false;
  if (path.startsWith("node_modules/") || path.startsWith(".")) return false;
  // Never treat tests, types, or config modules as content.
  if (/\.(test|spec|d)\.[jt]sx?$/i.test(base)) return false;
  if (/^(next|astro|vite|tailwind|postcss|eslint|svelte|nuxt|jest|vitest)\.config\./i.test(base)) return false;

  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return SEARCH_DIRS.includes(dir);
}

export async function discoverContentSources(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<DiscoveryResult> {
  const octokit = new Octokit({ auth: token });
  const candidates: ContentCandidate[] = [];
  const rejected: { path: string; reason: string }[] = [];

  let paths: string[] = [];
  try {
    const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
    paths = tree.data.tree
      .filter((node) => node.type === "blob" && node.path)
      .map((node) => node.path as string)
      .filter(isCandidatePath)
      // Bound the work: a handful of data files is normal, hundreds is not.
      .slice(0, 25);
  } catch {
    return { candidates, rejected };
  }

  for (const path of paths) {
    try {
      const res = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
      if (Array.isArray(res.data) || !("content" in res.data) || !res.data.content) continue;
      // Skip anything large enough to be a dataset rather than a content list.
      if (res.data.size && res.data.size > 512_000) {
        rejected.push({ path, reason: "File is too large to be a content list." });
        continue;
      }

      const source = Buffer.from(res.data.content, "base64").toString("utf8");

      if (isSourceModule(path)) {
        const located = locateTsArray(source, path);
        const rows = located.elements.map((el) => el.value);
        const schema = inferSchema(rows);
        if (!isUsableSchema(schema)) {
          rejected.push({ path, reason: "No title-like field to append against." });
          continue;
        }
        candidates.push({
          path,
          entryCount: located.elements.length,
          schema,
          rows,
          kind: "module",
          exportName: located.exportName,
          opaqueKeys: [...new Set(located.elements.flatMap((el) => el.opaqueKeys))],
        });
        continue;
      }

      const located = locateJsonArray(source);
      const schema = inferSchema(located.rows);
      if (!isUsableSchema(schema)) {
        rejected.push({ path, reason: "No title-like field to append against." });
        continue;
      }
      candidates.push({
        path,
        entryCount: located.rows.length,
        schema,
        rows: located.rows,
        kind: "json",
        opaqueKeys: [],
      });
    } catch (error) {
      rejected.push({
        path,
        reason: error instanceof AppendError ? error.message : "Could not read or parse this file.",
      });
    }
  }

  // Most entries first: the file with the richest existing content is almost
  // always the one the site actually renders.
  candidates.sort((a, b) => b.entryCount - a.entryCount);
  return { candidates, rejected };
}

/**
 * Which of our items are not already present in the file.
 *
 * De-duplication reads the live file rather than trusting stored state, so it
 * stays correct if the member edits or reorders entries by hand, or if we lose
 * track. Matching is by URL first (unambiguous) then by normalised title.
 */
export function selectNewItems<T extends { title: string; url: string | null }>(
  items: T[],
  existingRows: unknown[],
  schema: InferredSchema
): T[] {
  const titleKey = schema.fieldMap.title;
  const urlKey = schema.fieldMap.url;

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  for (const row of existingRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (urlKey && typeof record[urlKey] === "string") seenUrls.add(normalizeUrl(record[urlKey] as string));
    if (titleKey && typeof record[titleKey] === "string") seenTitles.add(normalizeTitle(record[titleKey] as string));
  }

  return items.filter((item) => {
    if (item.url && seenUrls.has(normalizeUrl(item.url))) return false;
    if (seenTitles.has(normalizeTitle(item.title))) return false;
    return true;
  });
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
