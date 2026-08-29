/**
 * Strict append-only writer.
 *
 * Every write this module produces must satisfy one invariant, checked after
 * the fact and enforced by refusing to return content that violates it:
 *
 *   Every entry that existed before still exists, unchanged, in the same order.
 *   The only difference is N new entries at the end.
 *
 * That is what makes editing someone's live site safe. We are adding a row, not
 * migrating a schema, and a bug here must fail loudly rather than quietly
 * corrupt a stranger's repository.
 */

export class AppendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppendError";
  }
}

/** Where the array lives inside a JSON document. */
export type JsonArrayLocation = { kind: "root" } | { kind: "property"; key: string };

export type ParsedJsonArray = {
  location: JsonArrayLocation;
  rows: unknown[];
  /** Detected indentation, so the appended row matches the file's style. */
  indent: number;
  /** Whether the source file ended with a newline. */
  trailingNewline: boolean;
};

/**
 * Find the array of content entries in a JSON file.
 *
 * Supports a top-level array, or an object with exactly one array-of-objects
 * property (`{ "projects": [...] }`). Ambiguity is refused: if a file has two
 * candidate arrays we cannot know which one the site renders.
 */
export function locateJsonArray(source: string): ParsedJsonArray {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new AppendError(`File is not valid JSON: ${error instanceof Error ? error.message : "parse error"}`);
  }

  const indent = detectIndent(source);
  const trailingNewline = source.endsWith("\n");

  if (Array.isArray(parsed)) {
    return { location: { kind: "root" }, rows: parsed, indent, trailingNewline };
  }

  if (parsed && typeof parsed === "object") {
    const candidates = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => Array.isArray(value) && value.some((v) => v && typeof v === "object" && !Array.isArray(v))
    );
    if (candidates.length === 1) {
      return { location: { kind: "property", key: candidates[0][0] }, rows: candidates[0][1] as unknown[], indent, trailingNewline };
    }
    if (candidates.length > 1) {
      throw new AppendError(
        `Found several possible content arrays (${candidates.map(([k]) => k).join(", ")}). Point at a file with one.`
      );
    }
  }

  throw new AppendError("Could not find an array of entries in this file.");
}

function detectIndent(source: string): number {
  const match = /\n([ \t]+)\S/.exec(source);
  if (!match) return 2;
  if (match[1].includes("\t")) return 2;
  return Math.min(8, match[1].length);
}

/**
 * Produce the new file content with `newRows` appended.
 *
 * Re-serialises the whole document rather than splicing text: a text splice
 * into someone's JSON is exactly the kind of clever that breaks at 3am. The
 * verification below then proves the re-serialisation preserved everything.
 */
export function appendToJson(source: string, newRows: Record<string, unknown>[]): string {
  const parsedArray = locateJsonArray(source);
  if (newRows.length === 0) return source;

  const original = JSON.parse(source) as unknown;
  let updated: unknown;

  if (parsedArray.location.kind === "root") {
    updated = [...(original as unknown[]), ...newRows];
  } else {
    const key = parsedArray.location.key;
    const container = { ...(original as Record<string, unknown>) };
    container[key] = [...(container[key] as unknown[]), ...newRows];
    updated = container;
  }

  const serialized = JSON.stringify(updated, null, parsedArray.indent);
  const result = parsedArray.trailingNewline ? `${serialized}\n` : serialized;

  // Refuse to hand back content that fails the invariant.
  verifyAppendOnly(source, result, newRows.length);
  return result;
}

/**
 * Prove that `after` is `before` plus exactly `expectedAdded` new trailing
 * entries. Throws otherwise. This is the safety net, not a formality: it is
 * what lets us write into a repository we do not own.
 */
export function verifyAppendOnly(before: string, after: string, expectedAdded: number): void {
  const a = locateJsonArray(before);
  const b = locateJsonArray(after);

  if (a.location.kind !== b.location.kind) {
    throw new AppendError("Append changed the document structure.");
  }
  if (a.location.kind === "property" && b.location.kind === "property" && a.location.key !== b.location.key) {
    throw new AppendError("Append moved the content array to a different property.");
  }
  if (b.rows.length !== a.rows.length + expectedAdded) {
    throw new AppendError(
      `Expected ${a.rows.length + expectedAdded} entries after append, found ${b.rows.length}.`
    );
  }

  // Every pre-existing entry must be byte-identical, in its original position.
  for (let i = 0; i < a.rows.length; i += 1) {
    if (JSON.stringify(a.rows[i]) !== JSON.stringify(b.rows[i])) {
      throw new AppendError(`Append modified existing entry at index ${i}. Refusing to write.`);
    }
  }

  // Nothing outside the array may change either.
  if (a.location.kind === "property" && b.location.kind === "property") {
    const stripArray = (source: string, key: string) => {
      const doc = JSON.parse(source) as Record<string, unknown>;
      const { [key]: _dropped, ...rest } = doc;
      void _dropped;
      return JSON.stringify(rest);
    };
    if (stripArray(before, a.location.key) !== stripArray(after, b.location.key)) {
      throw new AppendError("Append modified fields outside the content array. Refusing to write.");
    }
  }
}

/**
 * Build a markdown file with YAML frontmatter — used for content collections
 * (Astro, Eleventy, Jekyll), where "adding a row" means adding one new file and
 * touching nothing that already exists. The safest write of all.
 */
export function buildMarkdownEntry(fields: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

function yamlScalar(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => yamlScalar(v)).join(", ")}]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  // Quote anything that YAML would otherwise reinterpret, and always escape
  // embedded quotes — an unescaped one silently corrupts the frontmatter block.
  const needsQuotes = /[:#\-{}[\],&*?|<>=!%@`"'\n]/.test(text) || text.trim() !== text || text === "";
  if (!needsQuotes) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/** Filename-safe slug for a new content-collection entry. */
export function entrySlug(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return slug || fallback;
}
