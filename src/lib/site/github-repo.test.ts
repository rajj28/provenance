import { describe, expect, it } from "vitest";
import { normalizeFilePath, parseRepoInput } from "./github-repo";

describe("parseRepoInput", () => {
  it("accepts the shapes a user is likely to paste", () => {
    const expected = { owner: "ada", repo: "site" };
    expect(parseRepoInput("ada/site")).toEqual(expected);
    expect(parseRepoInput("https://github.com/ada/site")).toEqual(expected);
    expect(parseRepoInput("https://github.com/ada/site.git")).toEqual(expected);
    expect(parseRepoInput("https://github.com/ada/site/tree/main/src")).toEqual(expected);
    expect(parseRepoInput("git@github.com:ada/site.git")).toEqual(expected);
    expect(parseRepoInput("  ada/site  ")).toEqual(expected);
  });

  it("keeps dots and dashes in repository names", () => {
    expect(parseRepoInput("ada/ada.github.io")).toEqual({ owner: "ada", repo: "ada.github.io" });
    expect(parseRepoInput("my-org/my-site")).toEqual({ owner: "my-org", repo: "my-site" });
  });

  it("rejects input that is not a repository", () => {
    expect(parseRepoInput("")).toBeNull();
    expect(parseRepoInput("just-a-name")).toBeNull();
    expect(parseRepoInput("https://gitlab.com/ada/site")).toBeNull();
    expect(parseRepoInput("a/b/c/d")).toBeNull();
  });
});

describe("normalizeFilePath", () => {
  it("accepts a json path inside the repository", () => {
    expect(normalizeFilePath("data/portfolio.json")).toBe("data/portfolio.json");
    expect(normalizeFilePath("/data/portfolio.json")).toBe("data/portfolio.json");
    expect(normalizeFilePath("portfolio.json")).toBe("portfolio.json");
    expect(normalizeFilePath("src/content/_data/pf.JSON")).toBe("src/content/_data/pf.JSON");
  });

  it("refuses path traversal", () => {
    // A path escaping the repo root would make this app write somewhere the
    // member never agreed to.
    expect(normalizeFilePath("../../etc/passwd.json")).toBeNull();
    expect(normalizeFilePath("data/../../x.json")).toBeNull();
    expect(normalizeFilePath("./x.json")).toBeNull();
    expect(normalizeFilePath("data//x.json")).toBeNull();
  });

  it("refuses non-json targets", () => {
    // The writer emits JSON; letting it overwrite source files would be a
    // foot-gun aimed at someone's repository.
    expect(normalizeFilePath("src/index.ts")).toBeNull();
    expect(normalizeFilePath("README.md")).toBeNull();
    expect(normalizeFilePath("")).toBeNull();
    expect(normalizeFilePath("   ")).toBeNull();
  });
});
