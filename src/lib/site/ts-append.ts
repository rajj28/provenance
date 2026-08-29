import ts from "typescript";
import { AppendError } from "./append";

/**
 * Append an entry to a hardcoded array inside a .ts/.tsx/.js/.jsx module.
 *
 * Many portfolios keep their content in a component or a data module rather
 * than a JSON file, so refusing to touch source would leave those users with
 * nothing. This does it safely, and the safety rests on four things:
 *
 *  1. A real TypeScript parser. Never a regular expression.
 *  2. The mutation is a SINGLE TEXT INSERTION at one offset. The rest of the
 *     file is copied byte-for-byte, by construction — so comments, formatting,
 *     imports, JSX and everything else cannot be disturbed. We never re-print
 *     the file through the TS emitter, which would reformat the whole thing.
 *  3. Post-parse validation. The result is re-parsed and rejected unless it is
 *     syntactically clean, still contains the same array, has exactly N more
 *     elements, and every pre-existing element's source text is unchanged.
 *  4. A conservative reader. Anything we cannot statically understand — a
 *     spread, a function call, a computed key, two candidate arrays — is a
 *     refusal, not a guess.
 *
 * What this still cannot verify is the member's full build: types, lint, and
 * their own invariants. That is why PR mode is the default, so their CI runs
 * before anything reaches their live site.
 */

export type TsArrayElement = {
  /** Exact source text of this element, used for the unchanged-check. */
  text: string;
  /** Statically extracted literal properties. Non-literals are not included. */
  value: Record<string, unknown>;
  /** Property names present but not statically readable (JSX, imports, calls). */
  opaqueKeys: string[];
};

export type TsArrayStyle = {
  /** Indentation string used for elements inside the array. */
  indent: string;
  /** Quote character used for string literals in this file. */
  quote: '"' | "'";
};

export type LocatedTsArray = {
  exportName: string;
  elements: TsArrayElement[];
  /** Offset to insert new element text at (immediately after the last element). */
  insertPos: number;
  /** True when the array is empty, which needs different insertion text. */
  empty: boolean;
  style: TsArrayStyle;
};

const SUPPORTED = /\.(tsx?|jsx?|mjs|cjs)$/i;

export function isSourceModule(path: string) {
  return SUPPORTED.test(path);
}

function parse(source: string, fileName: string) {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Syntactic validation via a public API. `transpileModule` reports syntax
 * diagnostics without needing a Program or type information.
 */
function syntaxErrors(source: string, fileName: string): string[] {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve, allowJs: true },
  });
  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

/** Read a literal initializer into a plain JS value, or report it opaque. */
function literalValue(node: ts.Expression): { ok: true; value: unknown } | { ok: false } {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { ok: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return { ok: true, value: -Number(node.operand.text) };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      const inner = literalValue(el);
      if (!inner.ok) return { ok: false };
      out.push(inner.value);
    }
    return { ok: true, value: out };
  }
  // `as const`, `satisfies T`, and parentheses wrap a value we can still read.
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return literalValue(node.expression);
  }
  return { ok: false };
}

function readElement(node: ts.ObjectLiteralExpression, source: string): TsArrayElement {
  const value: Record<string, unknown> = {};
  const opaqueKeys: string[] = [];

  for (const prop of node.properties) {
    // A spread makes the element's real shape unknowable statically.
    if (ts.isSpreadAssignment(prop)) throw new AppendError("An entry uses a spread, so its shape cannot be read.");
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
      throw new AppendError("An entry contains a method or accessor, which is not a plain data row.");
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      opaqueKeys.push(prop.name.text);
      continue;
    }
    if (ts.isComputedPropertyName(prop.name)) {
      throw new AppendError("An entry uses a computed key, which cannot be matched safely.");
    }
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (key === null) throw new AppendError("An entry has a property name we cannot read.");

    const read = literalValue(prop.initializer);
    if (read.ok) value[key] = read.value;
    else opaqueKeys.push(key);
  }

  return { text: source.slice(node.getStart(), node.end), value, opaqueKeys };
}

/** Detect the file's dominant quote style for string literals. */
function detectQuote(source: string): '"' | "'" {
  const singles = (source.match(/'/g) ?? []).length;
  const doubles = (source.match(/"/g) ?? []).length;
  return singles > doubles ? "'" : '"';
}

function detectIndent(source: string, arrayStart: number, firstElementStart: number): string {
  const between = source.slice(arrayStart, firstElementStart);
  const match = /\n([ \t]*)$/.exec(between);
  if (match) return match[1];
  return "  ";
}

type Candidate = { name: string; node: ts.ArrayLiteralExpression };

/**
 * Find the single array-of-objects this module exports.
 *
 * Only top-level `const`/`let` initializers and `export default` are
 * considered — an array nested inside a function or component is not a content
 * source we can reason about. Two candidates is a refusal, matching the JSON
 * path: guessing which array a site renders could append projects into a list
 * of blog posts.
 */
export function locateTsArray(source: string, fileName: string): LocatedTsArray {
  const errors = syntaxErrors(source, fileName);
  if (errors.length) throw new AppendError(`File does not parse: ${errors[0]}`);

  const sourceFile = parse(source, fileName);
  const candidates: Candidate[] = [];

  const unwrap = (expr: ts.Expression): ts.Expression => {
    let current = expr;
    while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    }
    return current;
  };

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
        const init = unwrap(decl.initializer);
        if (ts.isArrayLiteralExpression(init)) candidates.push({ name: decl.name.text, node: init });
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const init = unwrap(statement.expression);
      if (ts.isArrayLiteralExpression(init)) candidates.push({ name: "default", node: init });
    }
  }

  // Only arrays that look like content: object literals, or spreads. Spreads
  // are kept as candidates purely so the explicit check below can report the
  // real reason — filtering them out here would surface a misleading
  // "no array found" instead of "this array uses a spread".
  const contentArrays = candidates.filter(
    (c) =>
      c.node.elements.length === 0 ||
      c.node.elements.every((el) => ts.isObjectLiteralExpression(el) || ts.isSpreadElement(el))
  );
  const nonEmpty = contentArrays.filter((c) => c.node.elements.length > 0);
  const chosenSet = nonEmpty.length > 0 ? nonEmpty : contentArrays;

  if (chosenSet.length === 0) throw new AppendError("No exported array of entries found in this file.");
  if (chosenSet.length > 1) {
    throw new AppendError(
      `Found several possible content arrays (${chosenSet.map((c) => c.name).join(", ")}). Split them into separate files.`
    );
  }

  const chosen = chosenSet[0];
  for (const el of chosen.node.elements) {
    if (ts.isSpreadElement(el)) throw new AppendError("The array uses a spread, so entries cannot be counted safely.");
    if (!ts.isObjectLiteralExpression(el)) throw new AppendError("The array contains a non-object entry.");
  }

  const elements = chosen.node.elements.map((el) => readElement(el as ts.ObjectLiteralExpression, source));
  const empty = elements.length === 0;
  const last = chosen.node.elements[chosen.node.elements.length - 1];

  return {
    exportName: chosen.name,
    elements,
    // Immediately after the final element, which lands before any trailing
    // comma — so the same insertion works with or without one.
    insertPos: empty ? chosen.node.getStart() + 1 : last.end,
    empty,
    style: {
      indent: empty ? "  " : detectIndent(source, chosen.node.getStart(), chosen.node.elements[0].getStart()),
      quote: detectQuote(source),
    },
  };
}

/** Serialise one row as source text in the file's own style. */
export function renderRow(row: Record<string, unknown>, style: TsArrayStyle, baseIndent: string): string {
  const inner = `${baseIndent}  `;
  const lines = Object.entries(row).map(([key, value]) => `${inner}${renderKey(key)}: ${renderValue(value, style)},`);
  return `{\n${lines.join("\n")}\n${baseIndent}}`;
}

function renderKey(key: string) {
  // A plain identifier stays bare; anything else must be quoted.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderValue(value: unknown, style: TsArrayStyle): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => renderValue(v, style)).join(", ")}]`;
  return renderString(String(value), style.quote);
}

/**
 * Emit a string literal safely. JSON.stringify handles escaping for double
 * quotes; for single-quote files we escape the quote and backslashes ourselves.
 * Either way the result cannot terminate the literal early.
 */
function renderString(text: string, quote: '"' | "'"): string {
  if (quote === '"') return JSON.stringify(text);
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `'${escaped}'`;
}

/**
 * Insert rows and prove the result is sound. Throws rather than returning
 * anything questionable.
 */
export function appendToTsArray(source: string, fileName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return source;
  const located = locateTsArray(source, fileName);
  const { indent } = located.style;

  const rendered = rows.map((row) => renderRow(row, located.style, indent));

  const insertion = located.empty
    ? `\n${indent}${rendered.join(`,\n${indent}`)},\n`
    : `,\n${indent}${rendered.join(`,\n${indent}`)}`;

  // The single mutation: everything before and after the offset is untouched.
  const updated = source.slice(0, located.insertPos) + insertion + source.slice(located.insertPos);

  verifyTsAppend(source, updated, fileName, rows.length);
  return updated;
}

/**
 * Post-parse validation. This is the gate that makes writing into someone
 * else's source acceptable.
 */
export function verifyTsAppend(before: string, after: string, fileName: string, expectedAdded: number): void {
  const errors = syntaxErrors(after, fileName);
  if (errors.length) throw new AppendError(`Result would not parse: ${errors[0]}. Refusing to write.`);

  const a = locateTsArray(before, fileName);
  const b = locateTsArray(after, fileName);

  if (a.exportName !== b.exportName) throw new AppendError("Append targeted a different array. Refusing to write.");
  if (b.elements.length !== a.elements.length + expectedAdded) {
    throw new AppendError(
      `Expected ${a.elements.length + expectedAdded} entries after append, found ${b.elements.length}.`
    );
  }
  for (let i = 0; i < a.elements.length; i += 1) {
    if (a.elements[i].text !== b.elements[i].text) {
      throw new AppendError(`Append modified existing entry at index ${i}. Refusing to write.`);
    }
  }

  // Nothing outside the array may have moved. Everything before the insertion
  // point, and everything after it, must be byte-identical.
  const tail = before.length - a.insertPos;
  if (after.slice(0, a.insertPos) !== before.slice(0, a.insertPos)) {
    throw new AppendError("Append altered content before the array. Refusing to write.");
  }
  if (after.slice(after.length - tail) !== before.slice(before.length - tail)) {
    throw new AppendError("Append altered content after the array. Refusing to write.");
  }
}
