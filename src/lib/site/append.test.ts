import { describe, expect, it } from "vitest";
import { appendToJson, locateJsonArray, verifyAppendOnly, AppendError, buildMarkdownEntry, entrySlug } from "./append";

const ROOT_ARRAY = `[
  {
    "name": "First",
    "blurb": "The first one.",
    "link": "https://a.example"
  }
]
`;

const WRAPPED = `{
  "title": "My site",
  "projects": [
    { "name": "First", "blurb": "One." }
  ]
}
`;

describe("locateJsonArray", () => {
  it("finds a top-level array", () => {
    const found = locateJsonArray(ROOT_ARRAY);
    expect(found.location).toEqual({ kind: "root" });
    expect(found.rows).toHaveLength(1);
  });

  it("finds a single array property inside an object", () => {
    const found = locateJsonArray(WRAPPED);
    expect(found.location).toEqual({ kind: "property", key: "projects" });
  });

  it("refuses an ambiguous file with two candidate arrays", () => {
    // Guessing which array the site renders could append projects into the
    // "posts" list on someone's live page.
    const ambiguous = `{"projects":[{"name":"a"}],"posts":[{"name":"b"}]}`;
    expect(() => locateJsonArray(ambiguous)).toThrow(/several possible content arrays/i);
  });

  it("refuses invalid JSON rather than overwriting it", () => {
    expect(() => locateJsonArray("{ not json")).toThrow(AppendError);
  });

  it("refuses a file with no array of entries", () => {
    expect(() => locateJsonArray(`{"title":"x"}`)).toThrow(/could not find an array/i);
  });

  it("ignores arrays of scalars when picking the content array", () => {
    // ["a","b"] is a tag list, not a content collection.
    const doc = `{"tags":["a","b"],"projects":[{"name":"x"}]}`;
    expect(locateJsonArray(doc).location).toEqual({ kind: "property", key: "projects" });
  });
});

describe("appendToJson", () => {
  it("appends a row to a top-level array", () => {
    const out = appendToJson(ROOT_ARRAY, [{ name: "Second", blurb: "Two." }]);
    const rows = JSON.parse(out) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toBe("Second");
  });

  it("leaves every existing entry byte-identical", () => {
    const out = appendToJson(ROOT_ARRAY, [{ name: "Second" }]);
    const before = JSON.parse(ROOT_ARRAY) as unknown[];
    const after = JSON.parse(out) as unknown[];
    expect(after[0]).toEqual(before[0]);
  });

  it("appends inside the array property and leaves siblings untouched", () => {
    const out = appendToJson(WRAPPED, [{ name: "Second", blurb: "Two." }]);
    const doc = JSON.parse(out) as { title: string; projects: unknown[] };
    expect(doc.title).toBe("My site");
    expect(doc.projects).toHaveLength(2);
  });

  it("preserves the file's indentation and trailing newline", () => {
    const fourSpace = `[\n    {\n        "name": "First"\n    }\n]\n`;
    const out = appendToJson(fourSpace, [{ name: "Second" }]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain('\n    {\n        "name": "First"');

    const noNewline = `[{"name":"First"}]`;
    expect(appendToJson(noNewline, [{ name: "x" }]).endsWith("\n")).toBe(false);
  });

  it("appends several rows in order", () => {
    const out = appendToJson(ROOT_ARRAY, [{ name: "B" }, { name: "C" }]);
    const rows = JSON.parse(out) as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["First", "B", "C"]);
  });

  it("is a no-op when there is nothing to add", () => {
    expect(appendToJson(ROOT_ARRAY, [])).toBe(ROOT_ARRAY);
  });

  it("appends to an empty array", () => {
    const out = appendToJson(`[]\n`, [{ name: "First" }]);
    expect(JSON.parse(out)).toEqual([{ name: "First" }]);
  });
});

describe("verifyAppendOnly", () => {
  it("accepts a genuine append", () => {
    const after = appendToJson(ROOT_ARRAY, [{ name: "Second" }]);
    expect(() => verifyAppendOnly(ROOT_ARRAY, after, 1)).not.toThrow();
  });

  it("rejects a modified existing entry", () => {
    // The single most important case: a bug that rewrites the member's data.
    const tampered = JSON.stringify([{ name: "CHANGED" }, { name: "Second" }], null, 2);
    expect(() => verifyAppendOnly(ROOT_ARRAY, tampered, 1)).toThrow(/modified existing entry at index 0/i);
  });

  it("rejects a deleted entry", () => {
    const deleted = JSON.stringify([{ name: "Second" }], null, 2);
    expect(() => verifyAppendOnly(ROOT_ARRAY, deleted, 1)).toThrow(AppendError);
  });

  it("rejects a reordered array", () => {
    const original = JSON.stringify([{ name: "A" }, { name: "B" }], null, 2);
    const reordered = JSON.stringify([{ name: "B" }, { name: "A" }, { name: "C" }], null, 2);
    expect(() => verifyAppendOnly(original, reordered, 1)).toThrow(/modified existing entry/i);
  });

  it("rejects the wrong number of added entries", () => {
    const after = appendToJson(ROOT_ARRAY, [{ name: "B" }, { name: "C" }]);
    expect(() => verifyAppendOnly(ROOT_ARRAY, after, 1)).toThrow(/expected 2 entries/i);
  });

  it("rejects a change outside the content array", () => {
    // Renaming the site title while appending a project would be a silent,
    // very confusing regression on someone's homepage.
    const tampered = JSON.stringify(
      { title: "HIJACKED", projects: [{ name: "First", blurb: "One." }, { name: "Second" }] },
      null,
      2
    );
    expect(() => verifyAppendOnly(WRAPPED, tampered, 1)).toThrow(/outside the content array/i);
  });

  it("rejects a document whose structure changed", () => {
    const restructured = JSON.stringify({ projects: [{ name: "First" }, { name: "x" }] }, null, 2);
    expect(() => verifyAppendOnly(ROOT_ARRAY, restructured, 1)).toThrow(/structure/i);
  });
});

describe("buildMarkdownEntry", () => {
  it("writes frontmatter and a body", () => {
    const out = buildMarkdownEntry({ title: "Hello", tags: ["a", "b"] }, "Some body.");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("title: Hello");
    expect(out).toContain("tags: [a, b]");
    expect(out.trimEnd().endsWith("Some body.")).toBe(true);
  });

  it("quotes values YAML would otherwise reinterpret", () => {
    // An unquoted colon silently turns one field into a nested map.
    expect(buildMarkdownEntry({ title: "Ship: the sequel" }, "")).toContain('title: "Ship: the sequel"');
    expect(buildMarkdownEntry({ title: "- dash" }, "")).toContain('title: "- dash"');
    expect(buildMarkdownEntry({ title: "#tag" }, "")).toContain('title: "#tag"');
  });

  it("escapes embedded quotes and newlines", () => {
    const out = buildMarkdownEntry({ title: 'He said "hi"' }, "");
    expect(out).toContain('title: "He said \\"hi\\""');
    expect(buildMarkdownEntry({ title: "a\nb" }, "")).toContain('title: "a b"');
  });

  it("keeps numbers and booleans unquoted", () => {
    const out = buildMarkdownEntry({ year: 2026, draft: false }, "");
    expect(out).toContain("year: 2026");
    expect(out).toContain("draft: false");
  });

  it("omits null and undefined fields", () => {
    const out = buildMarkdownEntry({ title: "x", cover: null, note: undefined }, "");
    expect(out).not.toContain("cover");
    expect(out).not.toContain("note");
  });
});

describe("entrySlug", () => {
  it("makes a filename-safe slug", () => {
    expect(entrySlug("My Cool Project!", "x")).toBe("my-cool-project");
    expect(entrySlug("  spaces  ", "x")).toBe("spaces");
  });

  it("falls back when a title yields nothing usable", () => {
    expect(entrySlug("!!!", "fallback-id")).toBe("fallback-id");
    expect(entrySlug("", "fallback-id")).toBe("fallback-id");
  });
});
