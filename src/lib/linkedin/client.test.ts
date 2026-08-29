import { describe, expect, it } from "vitest";
import { escapeLittleText, formatCommentary, MAX_COMMENTARY } from "./client";

/**
 * LinkedIn's "little" text format reserves a set of characters and requires
 * every one of them to be backslash-escaped, "even if those characters are not
 * used in one of the supported elements or templates". Getting this wrong
 * either mangles the rendered post or fails the request with a 422, so the
 * rules are pinned here.
 */
describe("little text escaping", () => {
  it("escapes every reserved character", () => {
    for (const char of ["|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~", "\\"]) {
      expect(escapeLittleText(char)).toBe(`\\${char}`);
    }
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLittleText("Shipped a parser in Rust. 40% faster!")).toBe("Shipped a parser in Rust. 40% faster!");
  });

  it("escapes parentheses that would otherwise be read as a mention", () => {
    expect(escapeLittleText("Built it (mostly) alone")).toBe("Built it \\(mostly\\) alone");
  });
});

describe("commentary formatting", () => {
  it("converts a hashtag into LinkedIn's hashtag template", () => {
    expect(formatCommentary("Shipped it #TypeScript")).toBe("Shipped it {hashtag|\\#|TypeScript}");
  });

  it("converts several hashtags and keeps the text between them", () => {
    expect(formatCommentary("#Rust and #WASM")).toBe("{hashtag|\\#|Rust} and {hashtag|\\#|WASM}");
  });

  it("escapes a bare hash that is not a hashtag", () => {
    // "#" followed by a digit is not a valid tag, so it must be plain text.
    expect(formatCommentary("issue #42")).toBe("issue \\#42");
  });

  it("does not treat a mid-word hash as a hashtag", () => {
    expect(formatCommentary("C#")).toBe("C\\#");
  });

  it("escapes reserved characters around a hashtag", () => {
    expect(formatCommentary("(new) #Go")).toBe("\\(new\\) {hashtag|\\#|Go}");
  });

  it("handles a hashtag at the very start of the text", () => {
    expect(formatCommentary("#Opening line")).toBe("{hashtag|\\#|Opening} line");
  });

  it("returns empty output for empty input", () => {
    expect(formatCommentary("")).toBe("");
  });

  it("never emits an unescaped reserved character outside a template", () => {
    const formatted = formatCommentary("Ada & co. shipped v2.0 (finally) — see @here #Ship_it *now*");
    // Strip the well-formed hashtag templates, then assert nothing reserved is
    // left bare in the remaining plain text.
    const withoutTemplates = formatted.replace(/\{hashtag\|\\#\|[A-Za-z0-9]+\}/g, "");
    const bare = withoutTemplates.replace(/\\[|{}@[\]()<>#*_~\\]/g, "");
    expect(bare).not.toMatch(/[|{}@[\]()<>#*_~\\]/);
  });
});

describe("limits", () => {
  it("matches LinkedIn's documented commentary cap", () => {
    expect(MAX_COMMENTARY).toBe(3000);
  });
});
