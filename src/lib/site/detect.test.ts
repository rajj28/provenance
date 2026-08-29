import { describe, expect, it } from "vitest";
import { detectFromSignals } from "./detect";

describe("framework detection", () => {
  it("recognises frameworks by dependency", () => {
    expect(detectFromSignals(["package.json"], ["astro"]).id).toBe("astro");
    expect(detectFromSignals(["package.json"], ["next"]).id).toBe("nextjs");
    expect(detectFromSignals(["package.json"], ["nuxt"]).id).toBe("nuxt");
    expect(detectFromSignals(["package.json"], ["@sveltejs/kit"]).id).toBe("sveltekit");
    expect(detectFromSignals(["package.json"], ["@11ty/eleventy"]).id).toBe("eleventy");
  });

  it("recognises frameworks with no package.json at all", () => {
    expect(detectFromSignals(["hugo.toml"], []).id).toBe("hugo");
    expect(detectFromSignals(["_config.yml"], []).id).toBe("jekyll");
  });

  it("prefers the specific framework over the generic bundler", () => {
    // An Astro site also depends on vite; matching vite first would send the
    // data file to the wrong place for every Astro user.
    expect(detectFromSignals(["package.json"], ["astro", "vite"]).id).toBe("astro");
    expect(detectFromSignals(["package.json"], ["next", "react"]).id).toBe("nextjs");
  });

  it("suggests the path each generator actually reads", () => {
    // Hugo and Jekyll expose these directories automatically; getting them
    // wrong means the committed file is simply ignored.
    expect(detectFromSignals(["hugo.toml"], []).suggestedPath).toBe("data/portfolio.json");
    expect(detectFromSignals(["_config.yml"], []).suggestedPath).toBe("_data/portfolio.json");
    expect(detectFromSignals(["package.json"], ["astro"]).suggestedPath).toBe("src/data/portfolio.json");
  });

  it("falls back safely for an unrecognised repository", () => {
    const fallback = detectFromSignals(["README.md", "index.html"], []);
    expect(fallback.id).toBe("unknown");
    expect(fallback.confidence).toBe("low");
    expect(fallback.suggestedPath).toBe("data/portfolio.json");
  });

  it("always suggests a path the writer will accept", () => {
    // Detection feeds normalizeFilePath; a suggestion it would reject is a bug.
    for (const deps of [["astro"], ["next"], ["nuxt"], ["@sveltejs/kit"], ["@11ty/eleventy"], ["vite"], []]) {
      const path = detectFromSignals(["package.json"], deps).suggestedPath;
      expect(path).toMatch(/^[\w./-]+\.json$/);
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain("..");
    }
  });
});
