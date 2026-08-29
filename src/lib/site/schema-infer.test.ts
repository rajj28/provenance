import { describe, expect, it } from "vitest";
import { inferSchema, mapItemToRow, isUsableSchema } from "./schema-infer";
import type { PayloadItem } from "../portfolio/payload";

const item: PayloadItem = {
  id: "i1",
  title: "provenance-cli",
  summary: "A CLI that verifies portfolio evidence.",
  description: "Longer text.",
  role: "Maintainer",
  impact: null,
  skills: ["TypeScript", "Rust"],
  kind: "project",
  kindLabel: "Project",
  source: "github",
  url: "https://github.com/ada/cli",
  occurredAt: "2026-03-01T00:00:00.000Z",
  year: 2026,
  links: [{ label: "Docs", url: "https://docs.example" }],
};

describe("inferSchema", () => {
  it("adopts the site's own field names", () => {
    const rows = [{ name: "A", blurb: "B", link: "https://c" }];
    const schema = inferSchema(rows)!;
    expect(schema.fieldMap.title).toBe("name");
    expect(schema.fieldMap.description).toBe("blurb");
    expect(schema.fieldMap.url).toBe("link");
  });

  it("prefers an exact key over a weaker alias", () => {
    // With both `title` and `name`, `title` must win — otherwise a site with
    // separate title and name columns gets them swapped.
    const schema = inferSchema([{ name: "n", title: "t" }])!;
    expect(schema.fieldMap.title).toBe("title");
  });

  it("never assigns one key to two fields", () => {
    const schema = inferSchema([{ title: "t", description: "d", url: "u" }])!;
    const used = Object.values(schema.fieldMap);
    expect(new Set(used).size).toBe(used.length);
  });

  it("unions keys across rows, since optional keys are often omitted", () => {
    const schema = inferSchema([{ title: "a" }, { title: "b", tags: ["x"] }])!;
    expect(schema.keys).toEqual(["title", "tags"]);
  });

  it("reports keys it could not map", () => {
    const schema = inferSchema([{ title: "a", coverImage: "x.png", featured: true }])!;
    expect(schema.unmapped).toContain("coverImage");
    expect(schema.unmapped).toContain("featured");
  });

  it("returns null when there is nothing to infer from", () => {
    expect(inferSchema([])).toBeNull();
    expect(inferSchema(["a", "b"])).toBeNull();
    expect(inferSchema([{}])).toBeNull();
  });

  it("declines a schema with no title-equivalent", () => {
    // Without something to use as a heading we cannot write a recognisable row.
    expect(isUsableSchema(inferSchema([{ coverImage: "x", featured: true }]))).toBe(false);
    expect(isUsableSchema(inferSchema([{ name: "x" }]))).toBe(true);
  });
});

describe("mapItemToRow", () => {
  it("writes only the site's keys, never ours", () => {
    const rows = [{ name: "A", blurb: "B", link: "https://c" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(Object.keys(row)).toEqual(["name", "blurb", "link"]);
    expect(row.name).toBe("provenance-cli");
    expect(row).not.toHaveProperty("title");
  });

  it("omits keys it cannot fill instead of inventing a value", () => {
    // An empty string in `coverImage` renders a broken image on a real site.
    const rows = [{ title: "A", coverImage: "a.png" }];
    const { row, skipped } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row).not.toHaveProperty("coverImage");
    expect(skipped).toContain("coverImage");
  });

  it("matches the existing column type for dates stored as numbers", () => {
    const rows = [{ title: "A", year: 2024 }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row.year).toBe(2026);
    expect(typeof row.year).toBe("number");
  });

  it("matches a date column stored as a bare year string", () => {
    const rows = [{ title: "A", date: "2024" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row.date).toBe("2026");
  });

  it("keeps full ISO dates when that is the existing format", () => {
    const rows = [{ title: "A", date: "2024-01-05T00:00:00.000Z" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row.date).toBe("2026-03-01T00:00:00.000Z");
  });

  it("joins a list into a string when the column holds strings", () => {
    const rows = [{ title: "A", tech: "React, Node" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row.tech).toBe("TypeScript, Rust");
  });

  it("keeps a list when the column holds arrays", () => {
    const rows = [{ title: "A", tags: ["x"] }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(row.tags).toEqual(["TypeScript", "Rust"]);
  });

  it("emits keys in the existing schema's order", () => {
    const rows = [{ link: "u", name: "n", blurb: "b" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    expect(Object.keys(row)).toEqual(["link", "name", "blurb"]);
  });

  it("falls back to a link when the item has no direct url", () => {
    const rows = [{ title: "A", url: "u" }];
    const noUrl = { ...item, url: null };
    const { row } = mapItemToRow(noUrl, inferSchema(rows)!, rows);
    expect(row.url).toBe("https://docs.example");
  });

  it("produces a row that is JSON-serialisable and free of nested objects", () => {
    const rows = [{ name: "A", blurb: "B", link: "c", tags: ["t"], date: "2024" }];
    const { row } = mapItemToRow(item, inferSchema(rows)!, rows);
    for (const value of Object.values(row)) {
      const ok = typeof value === "string" || typeof value === "number" || Array.isArray(value);
      expect(ok).toBe(true);
    }
    expect(() => JSON.stringify(row)).not.toThrow();
  });
});
