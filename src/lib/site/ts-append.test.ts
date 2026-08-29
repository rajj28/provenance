import { describe, expect, it } from "vitest";
import { locateTsArray, appendToTsArray, verifyTsAppend, renderRow, isSourceModule } from "./ts-append";
import { AppendError } from "./append";

const DATA_MODULE = `import type { Project } from "./types";

// Projects shown on the home page.
export const projects: Project[] = [
  {
    name: "Weather Dashboard",
    blurb: "Real-time weather.",
    link: "https://weather.example",
    tags: ["React", "Tailwind"],
    year: 2024,
  },
];
`;

const COMPONENT = `export default function Projects() {
  return <ul>{items.map((i) => <li key={i.title}>{i.title}</li>)}</ul>;
}

export const items = [
  { title: "First", url: "https://first.example" },
];
`;

describe("locateTsArray", () => {
  it("finds a typed exported array", () => {
    const found = locateTsArray(DATA_MODULE, "data.ts");
    expect(found.exportName).toBe("projects");
    expect(found.elements).toHaveLength(1);
    expect(found.elements[0].value).toEqual({
      name: "Weather Dashboard",
      blurb: "Real-time weather.",
      link: "https://weather.example",
      tags: ["React", "Tailwind"],
      year: 2024,
    });
  });

  it("reads an array in a .tsx file that also contains JSX", () => {
    const found = locateTsArray(COMPONENT, "Projects.tsx");
    expect(found.exportName).toBe("items");
    expect(found.elements[0].value.title).toBe("First");
  });

  it("handles export default, as const, and satisfies", () => {
    expect(locateTsArray(`export default [{ title: "a" }];`, "d.ts").exportName).toBe("default");
    expect(locateTsArray(`export const x = [{ title: "a" }] as const;`, "d.ts").exportName).toBe("x");
    expect(locateTsArray(`export const x = [{ title: "a" }] satisfies A[];`, "d.ts").exportName).toBe("x");
  });

  it("records non-literal properties as opaque rather than misreading them", () => {
    // `icon: <Star />` and `img: heroImage` cannot be read statically; they
    // must not be mistaken for data, and must not block the append.
    const src = `import heroImage from "./hero.png";
export const items = [
  { title: "A", img: heroImage, icon: <Star />, count: 3 },
];`;
    const found = locateTsArray(src, "x.tsx");
    expect(found.elements[0].value).toEqual({ title: "A", count: 3 });
    expect(found.elements[0].opaqueKeys.sort()).toEqual(["icon", "img"]);
  });

  it("reads negative numbers, booleans and null", () => {
    const found = locateTsArray(`export const x = [{ title: "a", n: -2, ok: true, none: null }];`, "d.ts");
    expect(found.elements[0].value).toEqual({ title: "a", n: -2, ok: true, none: null });
  });

  it("refuses a file that does not parse", () => {
    expect(() => locateTsArray(`export const x = [{ title: `, "d.ts")).toThrow(/does not parse/i);
  });

  it("refuses two candidate arrays", () => {
    // Guessing could append a project into the list of blog posts.
    const src = `export const projects = [{ title: "a" }];\nexport const posts = [{ title: "b" }];`;
    expect(() => locateTsArray(src, "d.ts")).toThrow(/several possible content arrays/i);
  });

  it("refuses spreads it cannot reason about", () => {
    expect(() => locateTsArray(`export const x = [...base, { title: "a" }];`, "d.ts")).toThrow(/spread/i);
    expect(() => locateTsArray(`export const x = [{ ...base, title: "a" }];`, "d.ts")).toThrow(/spread/i);
  });

  it("refuses computed keys and methods", () => {
    expect(() => locateTsArray(`export const x = [{ [k]: "a", title: "b" }];`, "d.ts")).toThrow(/computed key/i);
    expect(() => locateTsArray(`export const x = [{ title: "a", go() {} }];`, "d.ts")).toThrow(/method or accessor/i);
  });

  it("ignores arrays nested inside a function", () => {
    // Only module-level content is a data source we can reason about.
    const src = `export function f() { const local = [{ title: "a" }]; return local; }`;
    expect(() => locateTsArray(src, "d.ts")).toThrow(/no exported array/i);
  });

  it("ignores arrays of scalars", () => {
    const src = `export const tags = ["a", "b"];\nexport const items = [{ title: "x" }];`;
    expect(locateTsArray(src, "d.ts").exportName).toBe("items");
  });
});

describe("appendToTsArray", () => {
  it("appends an entry and keeps the file parseable", () => {
    const out = appendToTsArray(DATA_MODULE, "data.ts", [
      { name: "provenance-cli", blurb: "A CLI.", link: "https://cli.example", tags: ["TypeScript"], year: 2026 },
    ]);
    const found = locateTsArray(out, "data.ts");
    expect(found.elements).toHaveLength(2);
    expect(found.elements[1].value.name).toBe("provenance-cli");
  });

  it("preserves imports, comments and every existing byte", () => {
    const out = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "New", blurb: "b" }]);
    expect(out).toContain('import type { Project } from "./types";');
    expect(out).toContain("// Projects shown on the home page.");
    // The original file is a strict prefix up to the insertion point.
    expect(out.startsWith(DATA_MODULE.slice(0, DATA_MODULE.indexOf("];")))).toBe(true);
  });

  it("does not disturb JSX in a component file", () => {
    const out = appendToTsArray(COMPONENT, "Projects.tsx", [{ title: "Second", url: "https://b.example" }]);
    expect(out).toContain("<li key={i.title}>{i.title}</li>");
    expect(locateTsArray(out, "Projects.tsx").elements).toHaveLength(2);
  });

  it("adopts the file's quote style", () => {
    const single = `export const x = [\n  { title: 'A' },\n];\n`;
    const out = appendToTsArray(single, "d.ts", [{ title: "B" }]);
    expect(out).toContain("title: 'B'");
    expect(out).not.toContain('title: "B"');
  });

  it("appends into an empty array", () => {
    const out = appendToTsArray(`export const x: T[] = [];\n`, "d.ts", [{ title: "First" }]);
    expect(locateTsArray(out, "d.ts").elements).toHaveLength(1);
  });

  it("works whether or not a trailing comma is present", () => {
    const withComma = `export const x = [\n  { title: "A" },\n];\n`;
    const without = `export const x = [\n  { title: "A" }\n];\n`;
    expect(locateTsArray(appendToTsArray(withComma, "d.ts", [{ title: "B" }]), "d.ts").elements).toHaveLength(2);
    expect(locateTsArray(appendToTsArray(without, "d.ts", [{ title: "B" }]), "d.ts").elements).toHaveLength(2);
  });

  it("appends several entries in order", () => {
    const out = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "B" }, { name: "C" }]);
    const names = locateTsArray(out, "data.ts").elements.map((e) => e.value.name);
    expect(names).toEqual(["Weather Dashboard", "B", "C"]);
  });

  it("is a no-op with nothing to add", () => {
    expect(appendToTsArray(DATA_MODULE, "data.ts", [])).toBe(DATA_MODULE);
  });

  it("escapes strings so a value cannot break out of the literal", () => {
    // The injection case: a title containing a quote must not terminate the
    // string and turn the rest of the file into code.
    const nasty = `A" , malicious: "x`;
    const out = appendToTsArray(DATA_MODULE, "data.ts", [{ name: nasty }]);
    const found = locateTsArray(out, "data.ts");
    expect(found.elements).toHaveLength(2);
    expect(found.elements[1].value.name).toBe(nasty);
    expect(found.elements[1].value).not.toHaveProperty("malicious");
  });

  it("escapes correctly in single-quote files too", () => {
    const single = `export const x = [\n  { title: 'A' },\n];\n`;
    const nasty = `it's a ' test`;
    const out = appendToTsArray(single, "d.ts", [{ title: nasty }]);
    expect(locateTsArray(out, "d.ts").elements[1].value.title).toBe(nasty);
  });

  it("escapes newlines rather than producing an unterminated literal", () => {
    const out = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "line1\nline2" }]);
    expect(locateTsArray(out, "data.ts").elements[1].value.name).toBe("line1\nline2");
  });

  it("quotes property names that are not valid identifiers", () => {
    const out = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "A", "data-x": "y" }]);
    expect(out).toContain('"data-x": "y"');
    expect(locateTsArray(out, "data.ts").elements).toHaveLength(2);
  });
});

describe("verifyTsAppend", () => {
  it("accepts a genuine append", () => {
    const after = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "B" }]);
    expect(() => verifyTsAppend(DATA_MODULE, after, "data.ts", 1)).not.toThrow();
  });

  it("rejects a result that would not parse", () => {
    expect(() => verifyTsAppend(DATA_MODULE, `export const projects = [{`, "data.ts", 1)).toThrow(/would not parse/i);
  });

  it("rejects a modified existing entry", () => {
    const tampered = DATA_MODULE.replace("Weather Dashboard", "HIJACKED").replace("];", `  { name: "B" },\n];`);
    expect(() => verifyTsAppend(DATA_MODULE, tampered, "data.ts", 1)).toThrow(AppendError);
  });

  it("rejects a change outside the array", () => {
    // Removing an import while appending would break their build.
    const after = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "B" }]).replace(
      'import type { Project } from "./types";\n',
      ""
    );
    expect(() => verifyTsAppend(DATA_MODULE, after, "data.ts", 1)).toThrow(/before the array|would not parse/i);
  });

  it("rejects the wrong number of added entries", () => {
    const after = appendToTsArray(DATA_MODULE, "data.ts", [{ name: "B" }, { name: "C" }]);
    expect(() => verifyTsAppend(DATA_MODULE, after, "data.ts", 1)).toThrow(/expected 2 entries/i);
  });
});

describe("renderRow", () => {
  it("emits valid source for mixed value types", () => {
    const text = renderRow({ title: "A", n: 3, ok: true, tags: ["x", "y"] }, { indent: "  ", quote: '"' }, "  ");
    expect(() => locateTsArray(`export const x = [${text}];`, "d.ts")).not.toThrow();
  });
});

describe("isSourceModule", () => {
  it("recognises the module extensions it supports", () => {
    for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs"]) {
      expect(isSourceModule(`src/data/x.${ext}`)).toBe(true);
    }
    expect(isSourceModule("data/x.json")).toBe(false);
    expect(isSourceModule("README.md")).toBe(false);
  });
});
