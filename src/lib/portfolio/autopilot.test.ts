import { describe, expect, it } from "vitest";
import { shouldAutoPublish, deliveryEnabled, isAutopilotMode, settingsOf, AUTOPILOT_MODES } from "./autopilot";

const settings = { mode: "auto" as const, minSignificance: 70, minConfidence: 70 };
const good = { recommendation: "add", significance: 85, confidence: 90, uncertainFields: [] };

describe("autopilot gate", () => {
  it("publishes a strong, certain, recommended item", () => {
    expect(shouldAutoPublish(settings, good)).toBe(true);
  });

  it("never publishes unless the mode is auto", () => {
    expect(shouldAutoPublish({ ...settings, mode: "review" }, good)).toBe(false);
    expect(shouldAutoPublish({ ...settings, mode: "draft" }, good)).toBe(false);
  });

  it("respects the curator's own recommendation", () => {
    // A high score on an item the curator said to skip is still a skip.
    expect(shouldAutoPublish(settings, { ...good, recommendation: "skip" })).toBe(false);
  });

  it("holds anything with a field flagged uncertain", () => {
    // This is the guard that matters: an uncertain claim on someone's real
    // portfolio is exactly what must never happen unattended.
    expect(shouldAutoPublish(settings, { ...good, uncertainFields: ["authorship"] })).toBe(false);
    expect(shouldAutoPublish(settings, { ...good, uncertainFields: ["date", "employer"] })).toBe(false);
  });

  it("enforces both thresholds independently", () => {
    expect(shouldAutoPublish(settings, { ...good, significance: 69 })).toBe(false);
    expect(shouldAutoPublish(settings, { ...good, confidence: 69 })).toBe(false);
    expect(shouldAutoPublish(settings, { ...good, significance: 70, confidence: 70 })).toBe(true);
  });

  it("treats a malformed uncertainFields value as no claim of certainty", () => {
    // The column is Json; a non-array means we cannot prove it is empty.
    expect(shouldAutoPublish(settings, { ...good, uncertainFields: null })).toBe(true);
    expect(shouldAutoPublish(settings, { ...good, uncertainFields: ["x"] })).toBe(false);
  });
});

describe("delivery gating", () => {
  it("pauses website delivery only in draft mode", () => {
    expect(deliveryEnabled("auto")).toBe(true);
    expect(deliveryEnabled("review")).toBe(true);
    expect(deliveryEnabled("draft")).toBe(false);
  });
});

describe("settings", () => {
  it("falls back to review for an unrecognised stored mode", () => {
    // Defaulting to the safe mode matters: a bad value must never be read as
    // permission to publish automatically.
    const parsed = settingsOf({ autopilotMode: "nonsense", autopilotMinSignificance: 70, autopilotMinConfidence: 70 });
    expect(parsed.mode).toBe("review");
  });

  it("validates modes from untrusted form input", () => {
    expect(isAutopilotMode("auto")).toBe(true);
    expect(isAutopilotMode("review")).toBe(true);
    expect(isAutopilotMode("draft")).toBe(true);
    expect(isAutopilotMode("publish-everything")).toBe(false);
  });

  it("exposes exactly the three documented modes", () => {
    expect(AUTOPILOT_MODES.map((m) => m.value)).toEqual(["auto", "review", "draft"]);
  });
});
