/**
 * tool-call-validator — validate an LLM tool/function call's JSON arguments
 * against the tool's declared JSON-Schema-subset, returning a structured
 * valid/invalid verdict; throws on a malformed schema or unparseable input.
 *
 * Pure, deterministic, zero-dependency. No I/O, no clock, no randomness — so
 * there is no seam and no `Fake<X>`.
 */

/** The JSON-Schema subset this validator understands. */
export interface Schema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  /** Reject extra fields not in `properties`. Default false. */
  additionalProperties?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T = unknown> =
  | { valid: true; value: T }
  | { valid: false; errors: ValidationError[] };

/**
 * Thrown when the caller misuses the API: a malformed/invalid schema, a
 * non-string argument payload, or an unparseable JSON argument string. This is
 * distinct from a *validation verdict* (`{ valid: false, errors }`), which is
 * the correct, expected outcome for a well-formed but non-conforming tool call.
 */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

const VALID_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate that `schema` is a well-formed Schema in this subset. Throws
 * `SchemaError` on anything malformed (not an object, unknown `type`, wrong
 * shape for a keyword). A malformed schema is a *usage error*, never a
 * silently-passing validation.
 */
function assertSchema(schema: unknown, where: string): asserts schema is Schema {
  if (!isPlainObject(schema)) {
    throw new SchemaError(`invalid schema at ${where}: expected an object, got ${describe(schema)}`);
  }
  const s = schema as Record<string, unknown>;

  if (s.type !== undefined && !VALID_TYPES.has(s.type as string)) {
    throw new SchemaError(`invalid schema at ${where}: unknown type ${JSON.stringify(s.type)}`);
  }
  if (s.required !== undefined && !Array.isArray(s.required)) {
    throw new SchemaError(`invalid schema at ${where}: "required" must be an array`);
  }
  if (s.enum !== undefined && !Array.isArray(s.enum)) {
    throw new SchemaError(`invalid schema at ${where}: "enum" must be an array`);
  }
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean") {
    throw new SchemaError(`invalid schema at ${where}: "additionalProperties" must be a boolean`);
  }
  if (s.properties !== undefined) {
    if (!isPlainObject(s.properties)) {
      throw new SchemaError(`invalid schema at ${where}: "properties" must be an object`);
    }
    for (const [key, sub] of Object.entries(s.properties)) {
      assertSchema(sub, `${where}.properties.${key}`);
    }
  }
  if (s.items !== undefined) {
    assertSchema(s.items, `${where}.items`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/* ---- JSON repair / extract ---- */

/** Extract the first JSON object or array from a string that may contain other text. */
export function extractJson(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  // Strip Markdown code fence
  const fence = s.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1]!.trim();
  // Find first { or [
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  // Walk balanced brackets respecting strings.
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Apply common LLM-output fixes to malformed JSON. Best-effort. */
export function repairJson(raw: string): string {
  let s = raw;
  // Normalize smart quotes
  s = s.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  // Strip /* */ and // comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  // Quote unquoted keys: { foo: 1 } → { "foo": 1 }
  s = s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, "$1\"$2\":");
  // Convert single-quoted strings to double-quoted (very rough — assumes no embedded
  // single quotes); skip if it would produce invalid JSON.
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, "\"$1\"");
  return s;
}

/**
 * Best-effort parse: tries strict `JSON.parse`, then extracts JSON from
 * surrounding text, then applies repairs. Returns `null` if all fail.
 *
 * This is a deliberately lenient *probe* — it reports "no JSON here" as `null`
 * so callers can branch on it. The throwing contract lives in
 * `parseAndValidate`, where a non-string or unrecoverable argument payload is a
 * genuine usage error.
 */
export function parseJsonLoose(input: string): unknown | null {
  if (typeof input !== "string" || !input) return null;
  try { return JSON.parse(input); } catch { /* keep trying */ }
  const extracted = extractJson(input);
  if (extracted) {
    try { return JSON.parse(extracted); } catch { /* keep trying */ }
    try { return JSON.parse(repairJson(extracted)); } catch { /* fall through */ }
  }
  try { return JSON.parse(repairJson(input)); } catch { /* give up */ }
  return null;
}

/* ---- Validation ---- */

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateInner(value: unknown, schema: Schema, path: string, errors: ValidationError[]): void {
  if (schema.type) {
    const t = typeOf(value);
    const expected = schema.type;
    const ok =
      (expected === "integer" && t === "number" && Number.isInteger(value as number)) ||
      (expected !== "integer" && t === expected);
    if (!ok) {
      errors.push({ path, message: `expected ${expected}, got ${t}` });
      return;
    }
  }

  if (schema.enum) {
    if (!schema.enum.some((v) => v === value)) {
      errors.push({ path, message: `value is not in enum` });
    }
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) errors.push({ path: path ? `${path}.${key}` : key, message: "required" });
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateInner(obj[key], sub, path ? `${path}.${key}` : key, errors);
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in schema.properties)) {
            errors.push({ path: path ? `${path}.${key}` : key, message: "unknown property" });
          }
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateInner(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }
  }

  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `string too short (min ${schema.minLength})` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `string too long (max ${schema.maxLength})` });
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `pattern mismatch: ${schema.pattern}` });
    }
  }

  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `below minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `above maximum ${schema.maximum}` });
    }
  }
}

/**
 * Validate a parsed tool-call argument value against a JSON-Schema-subset.
 *
 * Supports: type, properties, required, items, enum, minimum, maximum,
 * minLength, maxLength, pattern, additionalProperties:false.
 *
 * Not supported: oneOf/anyOf/allOf, $ref, format, custom keywords.
 *
 * Returns a *verdict*: `{ valid: true, value }` for a conforming call, or
 * `{ valid: false, errors }` (path-tagged) for a non-conforming one — a failed
 * verdict is the correct, expected result, never an exception. By contrast a
 * **malformed schema** is a usage error and throws `SchemaError`.
 */
export function validate<T = unknown>(value: unknown, schema: Schema): ValidationResult<T> {
  assertSchema(schema, "<root>");
  const errors: ValidationError[] = [];
  validateInner(value, schema, "", errors);
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: value as T };
}

/**
 * Parse a (possibly malformed) JSON tool-call argument string and validate it
 * against `schema`. Combines `parseJsonLoose` + `validate`.
 *
 * Throws `SchemaError` when:
 *  - `schema` is malformed (delegated to `validate`),
 *  - `input` is not a string (the argument payload must be a JSON string),
 *  - `input` cannot be parsed as JSON even after lenient repair.
 *
 * It returns a `{ valid: false, errors }` verdict only when the input *parses*
 * but does not conform to the schema — never to report a parse failure.
 */
export function parseAndValidate<T = unknown>(input: string, schema: Schema): ValidationResult<T> {
  assertSchema(schema, "<root>");
  if (typeof input !== "string") {
    throw new SchemaError(`expected a JSON string argument payload, got ${describe(input)}`);
  }
  const parsed = parseJsonLoose(input);
  if (parsed === null) {
    throw new SchemaError("could not parse tool-call arguments as JSON");
  }
  return validate<T>(parsed, schema);
}
