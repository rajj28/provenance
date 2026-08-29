import { describe, expect, it } from "vitest";
import { composePost, type ComposableItem } from "./compose";
import { MAX_COMMENTARY } from "./client";

function item(overrides: Partial<ComposableItem> = {}): ComposableItem {
  return {
    title: "provenance-cli",
    summary: "A CLI that verifies portfolio evidence against source APIs.",
    description: "Longer description.",
    impact: null,
    skills: ["TypeScript", "Rust"],
    evidence: { kind: "project", sourceType: "github", url: "https://github.com/x/y", payload: {} },
    ...overrides,
  };
}

describe("composePost", () => {
  it("opens with wording matched to the item's section", () => {
    expect(composePost(item())).toMatch(/^Something I built:/);
    expect(composePost(item({ evidence: { kind: "role", sourceType: "manual", url: null } }))).toMatch(
      /^A role I want to record:/
    );
    expect(composePost(item({ evidence: { kind: "certification", sourceType: "manual", url: null } }))).toMatch(
      /^Newly certified:/
    );
  });

  it("includes the evidence link and the portfolio link", () => {
    const text = composePost(item(), "https://example.com/p/ada");
    expect(text).toContain("https://github.com/x/y");
    expect(text).toContain("More context: https://example.com/p/ada");
  });

  it("turns skills into alphanumeric hashtags", () => {
    // Underscore and dash are reserved in LinkedIn's little format, so a skill
    // like "machine-learning" must not produce "#machine-learning".
    const text = composePost(item({ skills: ["machine-learning", "C++", "Next.js"] }));
    expect(text).toContain("#machinelearning");
    expect(text).toContain("#C");
    expect(text).toContain("#Nextjs");
    expect(text).not.toMatch(/#[A-Za-z0-9]*[-_.+]/);
  });

  it("ignores non-string and unusable skill entries", () => {
    const text = composePost(item({ skills: [42, null, "", "123", "Go"] }));
    expect(text).toContain("#Go");
    // "123" cannot start a hashtag, so it is dropped rather than emitted bare.
    expect(text).not.toContain("#123");
  });

  it("handles a missing summary without leaving a dangling label", () => {
    const text = composePost(item({ summary: "", description: "", impact: null, skills: [] }));
    expect(text).toBe("Something I built: provenance-cli\n\nhttps://github.com/x/y");
  });

  it("never exceeds LinkedIn's commentary cap", () => {
    const text = composePost(item({ summary: "x".repeat(5000) }));
    expect(text.length).toBeLessThanOrEqual(MAX_COMMENTARY);
  });

  it("adds no claim that is not in the item", () => {
    // The composer restates supplied facts only — no invented metrics or hype.
    const text = composePost(item({ summary: "Did a thing.", skills: [], impact: null }));
    expect(text).toBe("Something I built: provenance-cli\n\nDid a thing.\n\nhttps://github.com/x/y");
  });
});
