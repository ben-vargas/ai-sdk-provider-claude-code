/**
 * JSON Schema sanitizer for the Claude Code CLI's native structured outputs.
 *
 * The CLI's constrained decoder does not support the JSON Schema `format`
 * keyword (`date-time`, `email`, `uri`, `uuid`, ...). Instead of enforcing or
 * ignoring it, the CLI silently returns a successful result WITHOUT
 * `structured_output`, which surfaces downstream as an opaque
 * `AI_NoObjectGeneratedError` (verified on SDK 0.2.63 and 0.3.170 — upstream
 * CLI limitation). Stripping `format` client-side keeps constrained decoding
 * active for the rest of the schema.
 *
 * Note: `pattern` is intentionally NOT touched. The CLI genuinely enforces
 * (simple) regex patterns, so removing it would drop real enforcement.
 * Complex patterns (lookaheads/backreferences) remain a documented limitation.
 */

/** Keywords whose value is a map of property/definition name -> subschema. */
const SUBSCHEMA_MAP_KEYWORDS = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  // draft-07 `dependencies` values are either subschemas (schema form) or
  // arrays of property-name strings (array form); sanitizeNode passes
  // string arrays through untouched, so walking both forms is safe.
  'dependencies',
] as const;

/** Keywords whose value is a single subschema (or a boolean, which is skipped). */
const SUBSCHEMA_KEYWORDS = [
  'items', // may also be an array of subschemas (draft-07 tuple form)
  'additionalItems',
  'additionalProperties',
  'unevaluatedItems',
  'unevaluatedProperties',
  'not',
  'contains',
  'propertyNames',
  'contentSchema',
  'if',
  'then',
  'else',
] as const;

/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_LIST_KEYWORDS = ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const;

/**
 * Result of sanitizing a JSON schema for the CLI's `outputFormat`.
 */
export interface SanitizedJsonSchema {
  /**
   * Schema safe to pass as `outputFormat.schema`. When no `format` keywords
   * were found, this is the input object itself (same reference); otherwise a
   * copy-on-write clone with every `format` keyword removed — modified nodes
   * are copied, while untouched subtrees are shared by reference with the
   * input (the input is never mutated).
   */
  schema: Record<string, unknown>;

  /**
   * JSON-pointer-style paths (`#`, `#/properties/email`, ...) of the schema
   * nodes whose `format` keyword was removed. Empty when nothing was stripped.
   */
  strippedFormatPaths: string[];
}

/**
 * Deep-walks a JSON schema and removes every `format` keyword, folding the
 * hint into the node's `description` (appending ` (expected format: <value>)`
 * to an existing description, or creating `Expected format: <value>`), so the
 * model still sees the intent in plain language.
 *
 * This is safe end-to-end: `generateObject`/`streamObject` validate the result
 * against the user's ORIGINAL Zod schema client-side, so `.email()` /
 * `.datetime()` / `.url()` / `.uuid()` enforcement is fully preserved — only
 * the CLI-side enforcement, which never existed for `format`, is dropped.
 *
 * Walked locations: `properties`, `patternProperties`, `$defs`/`definitions`,
 * `dependentSchemas`/`dependencies`, `items` (object and tuple forms),
 * `prefixItems`, `anyOf`/`oneOf`/`allOf`, `not`, `additionalProperties`,
 * `contentSchema`, and related applicator keywords. `$ref` values are strings
 * (no recursion risk), but object identity is still guarded so cyclic inputs
 * cannot cause infinite recursion.
 *
 * @param schema - JSON schema as provided by the AI SDK's `responseFormat`
 * @returns The (possibly unchanged) schema plus the list of stripped paths
 */
export function sanitizeJsonSchemaForOutputFormat(
  schema: Record<string, unknown>
): SanitizedJsonSchema {
  const strippedFormatPaths: string[] = [];
  const sanitized = sanitizeNode(schema, '#', new WeakSet(), strippedFormatPaths);
  return {
    schema: (sanitized ?? schema) as Record<string, unknown>,
    strippedFormatPaths,
  };
}

/**
 * Copy-on-write recursive sanitizer. Returns the input value unchanged (same
 * reference) when neither the node nor any descendant contains a `format`
 * keyword.
 */
function sanitizeNode(
  node: unknown,
  path: string,
  visiting: WeakSet<object>,
  strippedFormatPaths: string[]
): unknown {
  if (typeof node !== 'object' || node === null) {
    return node;
  }

  // Cycle guard: $refs are strings so well-formed schemas cannot recurse, but
  // a cyclic object graph must not cause infinite recursion. On revisit the
  // node is returned as-is.
  if (visiting.has(node)) {
    return node;
  }
  visiting.add(node);

  try {
    if (Array.isArray(node)) {
      return sanitizeList(node, path, visiting, strippedFormatPaths);
    }

    const record = node as Record<string, unknown>;
    let result = record;
    const setKey = (key: string, value: unknown) => {
      if (result === record) {
        result = { ...record };
      }
      result[key] = value;
    };

    // Strip the `format` keyword, folding the hint into the description.
    if (typeof record.format === 'string') {
      const format = record.format;
      const existingDescription = record.description;
      result = { ...record };
      delete result.format;
      if (typeof existingDescription === 'string' && existingDescription.length > 0) {
        result.description = `${existingDescription} (expected format: ${format})`;
      } else if (existingDescription === undefined || existingDescription === '') {
        result.description = `Expected format: ${format}`;
      }
      // Non-string `description` values (spec-invalid, only possible in
      // hand-written schemas) are preserved untouched rather than overwritten.
      strippedFormatPaths.push(path);
    }

    // Maps of name -> subschema (properties, patternProperties, $defs, definitions).
    for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
      const map = record[keyword];
      if (typeof map !== 'object' || map === null || Array.isArray(map)) continue;
      const mapRecord = map as Record<string, unknown>;
      let newMap = mapRecord;
      for (const [name, child] of Object.entries(mapRecord)) {
        const sanitizedChild = sanitizeNode(
          child,
          `${path}/${keyword}/${name}`,
          visiting,
          strippedFormatPaths
        );
        if (sanitizedChild !== child) {
          if (newMap === mapRecord) {
            newMap = { ...mapRecord };
          }
          newMap[name] = sanitizedChild;
        }
      }
      if (newMap !== mapRecord) {
        setKey(keyword, newMap);
      }
    }

    // Single subschemas (items, additionalProperties, not, ...). `items` may
    // also be a tuple array (handled transparently by sanitizeNode).
    for (const keyword of SUBSCHEMA_KEYWORDS) {
      const child = record[keyword];
      if (typeof child !== 'object' || child === null) continue;
      const sanitizedChild = sanitizeNode(
        child,
        `${path}/${keyword}`,
        visiting,
        strippedFormatPaths
      );
      if (sanitizedChild !== child) {
        setKey(keyword, sanitizedChild);
      }
    }

    // Arrays of subschemas (prefixItems, anyOf, oneOf, allOf).
    for (const keyword of SUBSCHEMA_LIST_KEYWORDS) {
      const list = record[keyword];
      if (!Array.isArray(list)) continue;
      const sanitizedList = sanitizeList(list, `${path}/${keyword}`, visiting, strippedFormatPaths);
      if (sanitizedList !== list) {
        setKey(keyword, sanitizedList);
      }
    }

    return result;
  } finally {
    // Visit-stack semantics: shared (DAG) subschemas reached via different
    // parents are each sanitized; only true cycles short-circuit above.
    visiting.delete(node);
  }
}

/** Copy-on-write sanitization of an array of subschemas. */
function sanitizeList(
  list: unknown[],
  path: string,
  visiting: WeakSet<object>,
  strippedFormatPaths: string[]
): unknown[] {
  let result = list;
  for (let i = 0; i < list.length; i++) {
    const sanitizedChild = sanitizeNode(list[i], `${path}/${i}`, visiting, strippedFormatPaths);
    if (sanitizedChild !== list[i]) {
      if (result === list) {
        result = [...list];
      }
      result[i] = sanitizedChild;
    }
  }
  return result;
}
