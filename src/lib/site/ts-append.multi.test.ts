import { describe, it, expect } from "vitest";
import { locateTsArray, appendToTsArray, arrayNameMatchesKind } from "./ts-append";

/**
 * A module with several content arrays — the shape of most real portfolios,
 * where projects, experience and skills all live in one App.jsx. Choosing
 * among them is allowed only on evidence; these tests pin down exactly when.
 */
const MULTI = `import React from "react";

const PROJECTS = [
  { name: "One", url: "https://one.example", year: 2024 },
  { name: "Two", url: "https://two.example", year: 2025 },
];

const EXPERIENCE = [
  { company: "Acme", role: "Engineer", years: "2023 — Now" },
];

const CHAPTERS = [
  { n: "Ch. 1", label: "Intro" },
];

export default function App() { return <div>{PROJECTS.length}</div>; }
`;

describe("multi-array modules: choosing on evidence", () => {
  it("still refuses with no evidence, and now says how to fix it", () => {
    expect(() => locateTsArray(MULTI, "App.jsx")).toThrow(/several possible content arrays \(PROJECTS, EXPERIENCE, CHAPTERS\).*Settings/);
  });

  it("an explicit array name selects that array and nothing else", () => {
    const loc = locateTsArray(MULTI, "App.jsx", { arrayName: "EXPERIENCE" });
    expect(loc.exportName).toBe("EXPERIENCE");
    expect(loc.elements).toHaveLength(1);
    expect(loc.elements[0].value).toEqual({ company: "Acme", role: "Engineer", years: "2023 — Now" });
  });

  it("an explicit name that is not in the file is refused, listing what is", () => {
    expect(() => locateTsArray(MULTI, "App.jsx", { arrayName: "POSTS" })).toThrow(/No content array named `POSTS`.*PROJECTS, EXPERIENCE, CHAPTERS/);
  });

  it("an explicit name is checked even when the file has a single array", () => {
    // Guards against a stale setting after the member renamed their array.
    const single = `export const projects = [{ title: "a" }];`;
    expect(() => locateTsArray(single, "d.ts", { arrayName: "PROJECTS" })).toThrow(/only content array is `projects`, not `PROJECTS`/);
    expect(locateTsArray(single, "d.ts", { arrayName: "projects" }).exportName).toBe("projects");
  });

  it("the item kind picks the array whose name says it holds that kind", () => {
    expect(locateTsArray(MULTI, "App.jsx", { kind: "project" }).exportName).toBe("PROJECTS");
    expect(locateTsArray(MULTI, "App.jsx", { kind: "role" }).exportName).toBe("EXPERIENCE");
  });

  it("a kind with no matching array name is refused, never guessed", () => {
    // An article has nowhere to go in this file. Appending it to PROJECTS
    // would be exactly the "project into the list of blog posts" mistake.
    expect(() => locateTsArray(MULTI, "App.jsx", { kind: "article" })).toThrow(/several possible content arrays/);
  });

  it("two arrays that both look like the kind are refused, naming them", () => {
    const two = `const projects = [{ title: "a" }];\nconst featuredProjects = [{ title: "b" }];`;
    expect(() => locateTsArray(two, "d.ts", { kind: "project" })).toThrow(/Several arrays look like they hold projects \(projects, featuredProjects\)/);
    // …but an explicit name resolves it.
    expect(locateTsArray(two, "d.ts", { arrayName: "featuredProjects" }).exportName).toBe("featuredProjects");
  });

  it("an explicit name beats the kind when both are given", () => {
    expect(locateTsArray(MULTI, "App.jsx", { arrayName: "CHAPTERS", kind: "project" }).exportName).toBe("CHAPTERS");
  });

  it("appends into the chosen array and leaves the others byte-identical", () => {
    const after = appendToTsArray(MULTI, "App.jsx", [{ name: "Three", url: "https://three.example", year: 2026 }], { kind: "project" });
    const projects = locateTsArray(after, "App.jsx", { arrayName: "PROJECTS" });
    expect(projects.elements).toHaveLength(3);
    expect(projects.elements[2].value).toEqual({ name: "Three", url: "https://three.example", year: 2026 });
    // Untouched arrays are untouched — same element text, same count.
    expect(locateTsArray(after, "App.jsx", { arrayName: "EXPERIENCE" }).elements).toEqual(
      locateTsArray(MULTI, "App.jsx", { arrayName: "EXPERIENCE" }).elements
    );
    expect(locateTsArray(after, "App.jsx", { arrayName: "CHAPTERS" }).elements).toHaveLength(1);
    // Everything outside the PROJECTS array is byte-identical.
    const cut = MULTI.indexOf("const EXPERIENCE");
    expect(after.slice(after.indexOf("const EXPERIENCE"))).toBe(MULTI.slice(cut));
    expect(after.slice(0, MULTI.indexOf("{ name: \"Two\""))).toBe(MULTI.slice(0, MULTI.indexOf("{ name: \"Two\"")));
  });

  it("a title with a quote cannot break out of the chosen array either", () => {
    const after = appendToTsArray(MULTI, "App.jsx", [{ name: 'Say "hi"', url: "https://x", year: 2026 }], { arrayName: "PROJECTS" });
    expect(locateTsArray(after, "App.jsx", { arrayName: "PROJECTS" }).elements[2].value.name).toBe('Say "hi"');
    expect(locateTsArray(after, "App.jsx", { arrayName: "EXPERIENCE" }).elements).toHaveLength(1);
  });
});

describe("arrayNameMatchesKind vocabulary", () => {
  it("normalises case, separators and common prefixes", () => {
    for (const n of ["PROJECTS", "projects", "projectList", "my_projects", "featuredProjects", "selectedWork", "SELECTED_WORK"]) {
      expect(arrayNameMatchesKind(n, "project"), n).toBe(true);
    }
    for (const n of ["posts", "blogPosts", "WRITING", "articles"]) expect(arrayNameMatchesKind(n, "article"), n).toBe(true);
    for (const n of ["EXPERIENCE", "jobs", "workHistory", "timeline"]) expect(arrayNameMatchesKind(n, "role"), n).toBe(true);
  });

  it("does not match by loose substring or generic names", () => {
    expect(arrayNameMatchesKind("workshops", "project")).toBe(false); // 'work' is not a trailing word here
    expect(arrayNameMatchesKind("items", "project")).toBe(false);
    expect(arrayNameMatchesKind("data", "article")).toBe(false);
    expect(arrayNameMatchesKind("PROJECTS", "article")).toBe(false);
    expect(arrayNameMatchesKind("PROJECTS", "not-a-kind")).toBe(false);
  });
});
