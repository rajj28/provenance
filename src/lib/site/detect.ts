import { Octokit } from "octokit";

/**
 * Framework detection for a member's portfolio repository.
 *
 * The point is NOT to understand their application. It is to answer one narrow
 * question — "where does this framework expect data files to live?" — so the
 * member does not have to know, and so this app can own a content layer without
 * ever touching their components, routes, or styles.
 *
 * Detection is best-effort by design: an unrecognised repo still works, it just
 * falls back to a sensible default path the member can change.
 */

export type DetectedFramework = {
  id: string;
  name: string;
  /** Where the payload file should go for this framework. */
  suggestedPath: string;
  /** How the member wires it up, shown verbatim in the UI. */
  usageHint: string;
  confidence: "high" | "low";
};

const FALLBACK: DetectedFramework = {
  id: "unknown",
  name: "Static site",
  suggestedPath: "data/portfolio.json",
  usageHint: "Read data/portfolio.json at build time, or fetch the JSON feed directly from the browser.",
  confidence: "low",
};

type Signals = {
  files: Set<string>;
  dependencies: Set<string>;
};

/**
 * Ordered most-specific first: Astro and Next both carry a package.json, so a
 * generic "has package.json" rule must never win over a framework match.
 */
const RULES: {
  id: string;
  name: string;
  suggestedPath: string;
  usageHint: string;
  matches: (s: Signals) => boolean;
}[] = [
  {
    id: "astro",
    name: "Astro",
    suggestedPath: "src/data/portfolio.json",
    usageHint: "import portfolio from '../data/portfolio.json' in any .astro page, then map over portfolio.sections.",
    matches: (s) => s.dependencies.has("astro") || s.files.has("astro.config.mjs") || s.files.has("astro.config.ts"),
  },
  {
    id: "nextjs",
    name: "Next.js",
    suggestedPath: "src/data/portfolio.json",
    usageHint: "import portfolio from '@/data/portfolio.json' in a Server Component and render portfolio.sections.",
    matches: (s) => s.dependencies.has("next") || s.files.has("next.config.js") || s.files.has("next.config.ts"),
  },
  {
    id: "nuxt",
    name: "Nuxt",
    suggestedPath: "content/portfolio.json",
    usageHint: "Read content/portfolio.json with queryContent(), or import it directly in a page component.",
    matches: (s) => s.dependencies.has("nuxt") || s.files.has("nuxt.config.ts") || s.files.has("nuxt.config.js"),
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    suggestedPath: "src/lib/data/portfolio.json",
    usageHint: "import portfolio from '$lib/data/portfolio.json' in a +page.svelte or load function.",
    matches: (s) => s.dependencies.has("@sveltejs/kit") || s.files.has("svelte.config.js"),
  },
  {
    id: "hugo",
    name: "Hugo",
    suggestedPath: "data/portfolio.json",
    usageHint: "Hugo exposes data/portfolio.json automatically as .Site.Data.portfolio in templates.",
    matches: (s) => s.files.has("hugo.toml") || s.files.has("config.toml") || s.files.has("hugo.yaml"),
  },
  {
    id: "jekyll",
    name: "Jekyll",
    suggestedPath: "_data/portfolio.json",
    usageHint: "Jekyll exposes _data/portfolio.json automatically as site.data.portfolio in Liquid templates.",
    matches: (s) => s.files.has("_config.yml") || s.files.has("Gemfile"),
  },
  {
    id: "eleventy",
    name: "Eleventy",
    suggestedPath: "src/_data/portfolio.json",
    usageHint: "Eleventy exposes _data/portfolio.json automatically as the `portfolio` global in templates.",
    matches: (s) => s.dependencies.has("@11ty/eleventy") || s.files.has(".eleventy.js") || s.files.has("eleventy.config.js"),
  },
  {
    id: "vite",
    name: "Vite / React",
    suggestedPath: "src/data/portfolio.json",
    usageHint: "import portfolio from './data/portfolio.json' in your app, or fetch the JSON feed at runtime.",
    matches: (s) => s.dependencies.has("vite") || s.dependencies.has("react") || s.files.has("vite.config.ts"),
  },
];

export async function detectFramework(token: string, owner: string, repo: string, branch: string) {
  const octokit = new Octokit({ auth: token });
  const signals: Signals = { files: new Set(), dependencies: new Set() };

  try {
    const tree = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "false",
    });
    for (const node of tree.data.tree) {
      if (node.path) signals.files.add(node.path);
    }
  } catch {
    // A repo we cannot list is not a failure — fall through to the default.
    return FALLBACK;
  }

  if (signals.files.has("package.json")) {
    try {
      const res = await octokit.rest.repos.getContent({ owner, repo, path: "package.json", ref: branch });
      if (!Array.isArray(res.data) && "content" in res.data && res.data.content) {
        const parsed = JSON.parse(Buffer.from(res.data.content, "base64").toString("utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const name of Object.keys({ ...parsed.dependencies, ...parsed.devDependencies })) {
          signals.dependencies.add(name);
        }
      }
    } catch {
      // Unreadable or malformed package.json: file-name signals still apply.
    }
  }

  for (const rule of RULES) {
    if (rule.matches(signals)) {
      return {
        id: rule.id,
        name: rule.name,
        suggestedPath: rule.suggestedPath,
        usageHint: rule.usageHint,
        confidence: "high" as const,
      };
    }
  }
  return FALLBACK;
}

/** Exposed for tests: rule evaluation without any network access. */
export function detectFromSignals(files: string[], dependencies: string[]): DetectedFramework {
  const signals: Signals = { files: new Set(files), dependencies: new Set(dependencies) };
  for (const rule of RULES) {
    if (rule.matches(signals)) {
      return {
        id: rule.id,
        name: rule.name,
        suggestedPath: rule.suggestedPath,
        usageHint: rule.usageHint,
        confidence: "high",
      };
    }
  }
  return FALLBACK;
}
