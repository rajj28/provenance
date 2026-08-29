import type { PayloadItem } from "../portfolio/payload";

/**
 * Infer a site's existing content shape from the rows it already has, then
 * express our items in *that* shape.
 *
 * The rule this module exists to enforce: we adopt the member's field names, we
 * never impose ours. If their projects have `{ name, blurb, link }`, we write
 * `{ name, blurb, link }` — not `{ title, summary, url }`. Their templates
 * already read those keys, so an appended row renders with no template change.
 *
 * When we cannot confidently map a key we leave it out and say so, rather than
 * guessing a value onto someone's live site.
 */

export type InferredSchema = {
  /** Keys present on the existing rows, in their original order. */
  keys: string[];
  /** Our canonical field -> their key. Only confident matches appear. */
  fieldMap: Partial<Record<CanonicalField, string>>;
  /** Their keys we could not fill. Surfaced to the member as a warning. */
  unmapped: string[];
  /** Rows we sampled to infer this. */
  sampleSize: number;
};

export type CanonicalField = "title" | "description" | "url" | "date" | "tags" | "role" | "source";

/**
 * Aliases are ordered by strength: an exact `title` beats a fuzzy `name`, so a
 * schema with both maps correctly instead of arbitrarily.
 */
const ALIASES: Record<CanonicalField, string[]> = {
  title: ["title", "name", "heading", "label", "project", "projectname"],
  description: ["description", "summary", "excerpt", "blurb", "subtitle", "desc", "detail", "details", "body", "text"],
  url: ["url", "link", "href", "website", "homepage", "demo", "live", "liveurl", "repo", "repository", "github"],
  date: ["date", "publishedat", "published", "year", "createdat", "created", "when", "time"],
  tags: ["tags", "skills", "tech", "technologies", "stack", "topics", "keywords", "categories", "labels"],
  role: ["role", "position", "jobtitle", "company", "organization", "org", "employer"],
  source: ["source", "platform", "via", "origin"],
};

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Infer from an array of existing rows. Uses the union of keys across the
 * sample, because real data files often omit optional keys on some rows.
 */
export function inferSchema(rows: unknown[]): InferredSchema | null {
  const objects = rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r));
  if (objects.length === 0) return null;

  // Preserve first-seen key order so an appended row reads naturally in a diff.
  const keys: string[] = [];
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  if (keys.length === 0) return null;

  const fieldMap: Partial<Record<CanonicalField, string>> = {};
  const claimed = new Set<string>();

  // Two passes so an exact alias always wins over a weaker one on another field.
  for (const strength of [0, 1]) {
    for (const [field, aliases] of Object.entries(ALIASES) as [CanonicalField, string[]][]) {
      if (fieldMap[field]) continue;
      for (const key of keys) {
        if (claimed.has(key)) continue;
        const norm = normalizeKey(key);
        const index = aliases.indexOf(norm);
        if (index === -1) continue;
        // Pass 0 takes only the primary alias; pass 1 accepts the rest.
        if (strength === 0 && index !== 0) continue;
        fieldMap[field] = key;
        claimed.add(key);
        break;
      }
    }
  }

  return {
    keys,
    fieldMap,
    unmapped: keys.filter((k) => !claimed.has(k)),
    sampleSize: objects.length,
  };
}

/** Infer from markdown frontmatter objects (same logic, different origin). */
export const inferSchemaFromFrontmatter = inferSchema;

function valueFor(field: CanonicalField, item: PayloadItem): unknown {
  switch (field) {
    case "title":
      return item.title;
    case "description":
      return item.summary || item.description;
    case "url":
      return item.url ?? item.links[0]?.url ?? null;
    case "date":
      return item.occurredAt;
    case "tags":
      return item.skills;
    case "role":
      return item.role;
    case "source":
      return item.source;
  }
}

/**
 * Coerce a value to the type the existing rows use for that key, so we never
 * change a column's type. A site whose `date` is the number 2026 must keep
 * getting a number, or its sort or format helper breaks.
 */
function coerceToSampleType(value: unknown, samples: unknown[]): unknown {
  const sample = samples.find((s) => s !== undefined && s !== null);
  if (sample === undefined || value === null || value === undefined) return value;

  if (typeof sample === "string" && typeof value !== "string") {
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  }
  if (typeof sample === "number" && typeof value === "string") {
    // Most commonly a year extracted from an ISO date.
    const year = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    const n = year ? Number(year[1]) : Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (Array.isArray(sample) && !Array.isArray(value)) {
    return value === "" ? [] : [value];
  }
  if (typeof sample === "string" && typeof value === "string") {
    // A date column stored as "2026" rather than a full ISO string.
    const allYears = samples.every((s) => typeof s === "string" && /^\d{4}$/.test(s));
    const iso = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    if (allYears && iso) return iso[1];
  }
  return value;
}

export type MappedRow = { row: Record<string, unknown>; filled: string[]; skipped: string[] };

/**
 * Build one row in the member's own shape.
 *
 * Only keys we can fill are included. A key we cannot fill is omitted rather
 * than given an invented value — an empty string in an `image` field renders a
 * broken image on someone's real site.
 */
export function mapItemToRow(item: PayloadItem, schema: InferredSchema, existingRows: unknown[]): MappedRow {
  const row: Record<string, unknown> = {};
  const filled: string[] = [];

  const columnSamples = (key: string) =>
    existingRows
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .map((r) => r[key]);

  // Emit in the schema's key order so the appended row matches its neighbours.
  for (const key of schema.keys) {
    const field = (Object.keys(schema.fieldMap) as CanonicalField[]).find((f) => schema.fieldMap[f] === key);
    if (!field) continue;
    const value = valueFor(field, item);
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    row[key] = coerceToSampleType(value, columnSamples(key));
    filled.push(key);
  }

  return { row, filled, skipped: schema.keys.filter((k) => !filled.includes(k)) };
}

/**
 * Whether a schema is usable at all. Without a title-equivalent we cannot
 * produce a row a human would recognise, so we decline rather than write junk.
 */
export function isUsableSchema(schema: InferredSchema | null): schema is InferredSchema {
  return Boolean(schema && schema.fieldMap.title);
}
