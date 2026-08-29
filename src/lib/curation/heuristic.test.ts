import { describe, expect, it } from "vitest";
import { curateHeuristic } from "./heuristic";
import { fingerprintOf, type DiscoveredItem } from "../sources/types";
import { shouldReopenRejected } from "../sync/policy";

function item(partial: Partial<DiscoveredItem> & Pick<DiscoveredItem, "kind" | "externalId" | "title" | "payload">): DiscoveredItem {
  return {
    sourceType: "github",
    ...partial,
  };
}

describe("fingerprintOf", () => {
  it("is stable and case-normalized", () => {
    const a = fingerprintOf({ sourceType: "github", kind: "project", externalId: "123" });
    const b = fingerprintOf({ sourceType: "github", kind: "project", externalId: "123" });
    expect(a).toBe("github:project:123");
    expect(a).toBe(b);
  });
});

describe("curateHeuristic", () => {
  it("skips trivial pull requests", () => {
    const result = curateHeuristic(
      item({
        kind: "contribution",
        externalId: "https://github.com/org/repo/pull/1",
        title: "Fix typo in README",
        payload: { trivialHint: true, repo: "org/repo", title: "Fix typo in README" },
      })
    );
    expect(result.recommendation).toBe("skip");
    expect(result.significance).toBeLessThan(32);
  });

  it("recommends a substantial original repository", () => {
    const result = curateHeuristic(
      item({
        kind: "project",
        externalId: "99",
        title: "me/api-server",
        summary: "Production TypeScript API used by partner teams",
        occurredAt: new Date(),
        payload: {
          stars: 84,
          forks: 12,
          isFork: false,
          description: "Production TypeScript API used by partner teams",
          readmeExcerpt: "A".repeat(500),
          releases: [{ tag: "v1.2.0" }],
          language: "TypeScript",
          languages: { TypeScript: 12000 },
        },
      }),
      "backend engineering"
    );
    expect(result.recommendation).toBe("add");
    expect(result.significance).toBeGreaterThan(50);
    expect(result.skills).toContain("TypeScript");
  });

  it("skips empty undocumented repos", () => {
    const result = curateHeuristic(
      item({
        kind: "project",
        externalId: "1",
        title: "me/tmp",
        payload: { stars: 0, forks: 0, isFork: false, description: "", readmeExcerpt: "" },
      })
    );
    expect(result.recommendation).toBe("skip");
  });
});

describe("shouldReopenRejected", () => {
  it("does not reopen a rejected item with unchanged evidence", () => {
    expect(shouldReopenRejected("rejected", "abc", "abc")).toBe(false);
  });

  it("reopens a rejected item when the payload hash changes", () => {
    expect(shouldReopenRejected("rejected", "abc", "def")).toBe(true);
  });
});
