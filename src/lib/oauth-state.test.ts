import { describe, expect, it, vi, afterEach } from "vitest";
import { createOAuthState, readOAuthState, OAuthStateError } from "./oauth-state";

afterEach(() => vi.useRealTimers());

describe("oauth state", () => {
  it("round-trips the user id", () => {
    const state = createOAuthState("user_123", "linkedin");
    expect(readOAuthState(state, "linkedin")).toBe("user_123");
  });

  it("issues a different value each time", () => {
    // A fixed state would be replayable and would leak that two flows belong to
    // the same user.
    expect(createOAuthState("user_123", "linkedin")).not.toBe(createOAuthState("user_123", "linkedin"));
  });

  it("rejects a state minted for a different provider", () => {
    // Without this, a state from the GitHub flow could be replayed into the
    // LinkedIn callback to bind the wrong account.
    const state = createOAuthState("user_123", "github");
    expect(() => readOAuthState(state, "linkedin")).toThrow(OAuthStateError);
  });

  it("rejects a tampered payload", () => {
    const state = createOAuthState("user_123", "linkedin");
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const forged = Buffer.from(raw.replace("user_123", "user_999")).toString("base64url");
    expect(() => readOAuthState(forged, "linkedin")).toThrow(OAuthStateError);
  });

  it("rejects a truncated or malformed state", () => {
    expect(() => readOAuthState("", "linkedin")).toThrow(OAuthStateError);
    expect(() => readOAuthState(Buffer.from("a:b:c").toString("base64url"), "linkedin")).toThrow(OAuthStateError);
  });

  it("expires after ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const state = createOAuthState("user_123", "linkedin");

    vi.setSystemTime(new Date("2026-08-30T12:09:00Z"));
    expect(readOAuthState(state, "linkedin")).toBe("user_123");

    vi.setSystemTime(new Date("2026-08-30T12:11:00Z"));
    expect(() => readOAuthState(state, "linkedin")).toThrow(/expired/i);
  });
});
