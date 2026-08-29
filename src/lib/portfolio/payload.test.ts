import { describe, expect, it } from "vitest";
import { buildPayload, stableContent, PORTFOLIO_SCHEMA_VERSION } from "./payload";

const USER = {
  name: "Ada Lovelace",
  headline: "Platform engineer",
  bio: "Builds things.",
  location: "London",
  targetRole: "Staff Engineer",
  slug: "ada",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "item_1",
    title: "provenance-cli",
    summary: "A CLI.",
    description: "A longer description.",
    role: null,
    impact: null,
    skills: ["TypeScript"],
    links: [{ label: "Docs", url: "https://example.com/docs" }],
    evidence: {
      kind: "project",
      sourceType: "github",
      url: "https://github.com/ada/cli",
      occurredAt: new Date("2026-03-01T00:00:00Z"),
      payload: {},
    },
    ...overrides,
  } as Parameters<typeof buildPayload>[1][number];
}

describe("portfolio payload", () => {
  it("groups items into sections and also exposes a flat list", () => {
    const payload = buildPayload(USER, [row(), row({ id: "i2", evidence: { ...row().evidence, kind: "article" } })], "https://app.test");
    expect(payload.sections.map((s) => s.id)).toEqual(["projects", "writing"]);
    expect(payload.items).toHaveLength(2);
    expect(payload.counts).toEqual({ items: 2, sections: 2 });
  });

  it("publishes the schema version consumers pin against", () => {
    // Third-party sites read this payload and are not redeployed when we ship,
    // so the version is part of the public contract.
    expect(buildPayload(USER, [], "https://app.test").schemaVersion).toBe(PORTFOLIO_SCHEMA_VERSION);
  });

  it("exposes nothing private about the member", () => {
    const json = JSON.stringify(buildPayload(USER, [row()], "https://app.test"));
    for (const leak of ["email", "passwordHash", "encrypted", "accessToken", "userId"]) {
      expect(json.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("coerces malformed skills and links instead of trusting the Json column", () => {
    const payload = buildPayload(
      USER,
      [row({ skills: ["ok", 42, null, ""], links: [{ url: "https://a" }, { label: "no url" }, "nope", null] })],
      "https://app.test"
    );
    expect(payload.items[0].skills).toEqual(["ok"]);
    expect(payload.items[0].links).toEqual([{ label: "Link", url: "https://a" }]);
  });

  it("derives a year and keeps a full timestamp", () => {
    const item = buildPayload(USER, [row()], "https://app.test").items[0];
    expect(item.year).toBe(2026);
    expect(item.occurredAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("handles an item with no date", () => {
    const item = buildPayload(USER, [row({ evidence: { ...row().evidence, occurredAt: null } })], "https://app.test").items[0];
    expect(item.year).toBeNull();
    expect(item.occurredAt).toBeNull();
  });

  it("produces identical stable content across builds of the same data", () => {
    // The repo writer compares this hash to avoid committing empty changes, so
    // the moving `generatedAt` field must be excluded.
    const a = buildPayload(USER, [row()], "https://app.test");
    const b = buildPayload(USER, [row()], "https://app.test");
    expect(stableContent(a)).toBe(stableContent(b));
    expect(stableContent(a)).not.toContain("generatedAt");
    // ...while the payload itself still carries a timestamp for humans.
    expect(a.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("changes stable content when an item actually changes", () => {
    const before = stableContent(buildPayload(USER, [row()], "https://app.test"));
    const after = stableContent(buildPayload(USER, [row({ title: "renamed" })], "https://app.test"));
    expect(before).not.toBe(after);
  });
});
