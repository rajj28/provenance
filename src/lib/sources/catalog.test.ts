import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG } from "./catalog";
import { getAdapter } from "./registry";
import type { SourceType } from "./types";

const liveConnectors = SOURCE_CATALOG.filter((s) => s.live && s.type !== "manual");
// Publish-only integrations (LinkedIn) are not readable, so they have no
// adapter, but they do have a real OAuth flow — a different shape from a
// restricted source, which has neither.
const publishOnly = SOURCE_CATALOG.filter((s) => s.publish);
const restricted = SOURCE_CATALOG.filter((s) => !s.live && !s.publish);

describe("source catalog", () => {
  it("lists every source exactly once", () => {
    const types = SOURCE_CATALOG.map((s) => s.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("has a working adapter behind every live connector", () => {
    // Hashnode shipped as "live" with no reachable API. This keeps the catalog
    // and the adapter registry from drifting apart again.
    for (const source of liveConnectors) {
      expect(() => getAdapter(source.type as SourceType), source.type).not.toThrow();
    }
  });

  it("never marks a publish-only integration as a live source", () => {
    // If LinkedIn were ever flipped to live:true it would be handed to the sync
    // engine, which would look for an adapter that cannot exist — LinkedIn does
    // not permit reading a member's posts.
    for (const source of publishOnly) {
      expect(source.live, source.type).toBe(false);
      expect(() => getAdapter(source.type as SourceType), source.type).toThrow();
    }
  });

  it("does not offer credential fields for restricted or publish-only sources", () => {
    for (const source of [...restricted, ...publishOnly]) {
      // Credentials for these arrive through OAuth or not at all; a text field
      // here would invite pasting a password into the app.
      expect(source.fields, source.type).toHaveLength(0);
    }
    for (const source of restricted) {
      expect(source.auth, source.type).toBe("manual");
    }
  });

  it("gives every live connector at least one required field", () => {
    for (const source of liveConnectors) {
      expect(source.fields.length, source.type).toBeGreaterThan(0);
      // GitHub is the one connector whose only field is optional, because OAuth
      // can supply the token instead.
      if (source.type !== "github") {
        expect(source.fields.some((f) => !f.optional), source.type).toBe(true);
      }
    }
  });

  it("explains why each non-live source is not a live connector", () => {
    for (const source of [...restricted, ...publishOnly]) {
      expect(source.apiNotes.length, source.type).toBeGreaterThan(40);
    }
  });
});
