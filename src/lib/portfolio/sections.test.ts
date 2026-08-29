import { describe, expect, it } from "vitest";
import {
  ALL_KINDS,
  groupIntoSections,
  KIND_LABELS,
  PORTFOLIO_SECTIONS,
  sectionForEvidence,
  sectionForKind,
  isEvidenceKind,
  sourceLabel,
} from "./sections";
import type { EvidenceKind } from "../sources/types";

const KINDS: EvidenceKind[] = [
  "role",
  "project",
  "contribution",
  "article",
  "package",
  "publication",
  "certification",
  "achievement",
];

function ev(kind: string, sourceType = "manual", payload: unknown = {}) {
  return { evidence: { kind, sourceType, payload } };
}

describe("portfolio sections", () => {
  it("routes every evidence kind to a real section", () => {
    // The mapping must be total: an unrouted kind would silently vanish from
    // the public page, which is the one thing sectioning must never do.
    for (const kind of KINDS) {
      const id = sectionForKind(kind);
      expect(PORTFOLIO_SECTIONS.some((s) => s.id === id), kind).toBe(true);
    }
  });

  it("covers exactly the kinds declared in the source types", () => {
    expect([...ALL_KINDS].sort()).toEqual([...KINDS].sort());
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...KINDS].sort());
  });

  it("puts roles in experience and certifications in credentials", () => {
    expect(sectionForKind("role")).toBe("experience");
    expect(sectionForKind("certification")).toBe("credentials");
    expect(sectionForKind("publication")).toBe("publications");
  });

  it("treats packages and contributions as open source", () => {
    expect(sectionForKind("package")).toBe("open-source");
    expect(sectionForKind("contribution")).toBe("open-source");
  });

  it("routes npm projects and forks to open source rather than projects", () => {
    expect(sectionForEvidence({ kind: "project", sourceType: "npm" })).toBe("open-source");
    expect(sectionForEvidence({ kind: "project", sourceType: "github", payload: { isFork: true } })).toBe("open-source");
    expect(sectionForEvidence({ kind: "project", sourceType: "github", payload: { isFork: false } })).toBe("projects");
  });

  it("falls back to achievements for an unknown kind", () => {
    expect(sectionForEvidence({ kind: "something-new", sourceType: "manual" })).toBe("achievements");
  });

  it("groups items in declared section order and drops empty sections", () => {
    const grouped = groupIntoSections([
      ev("achievement"),
      ev("role"),
      ev("article"),
      ev("role"),
    ]);
    expect(grouped.map((g) => g.section.id)).toEqual(["experience", "writing", "achievements"]);
    expect(grouped[0].items).toHaveLength(2);
  });

  it("preserves input order inside a section", () => {
    const first = ev("role", "manual", { n: 1 });
    const second = ev("role", "manual", { n: 2 });
    const [group] = groupIntoSections([first, second]);
    expect(group.items[0]).toBe(first);
    expect(group.items[1]).toBe(second);
  });

  it("validates evidence kinds from untrusted input", () => {
    expect(isEvidenceKind("role")).toBe(true);
    expect(isEvidenceKind("__proto__")).toBe(false);
    expect(isEvidenceKind("nonsense")).toBe(false);
  });

  it("shows the original platform for manually imported evidence", () => {
    expect(sourceLabel("manual", { sourceLabel: "linkedin" })).toBe("linkedin");
    expect(sourceLabel("manual", { sourceLabel: "manual" })).toBe("manual");
    expect(sourceLabel("github", {})).toBe("github");
  });
});
