# tool-call-validator — agent capsule

Validate an LLM tool/function call's JSON arguments against the tool's declared
JSON-Schema-subset; throws on malformed schema or input.

- **Family:** lib
- **Public surface (`src/index.ts`):** the `Schema` interface (the
  JSON-Schema subset understood here); `ValidationError` and the
  `ValidationResult<T>` verdict union; `validate(value, schema)` (validate an
  already-parsed argument value); `parseAndValidate(input, schema)` (parse a raw
  JSON argument string, then validate); the lenient-parse helpers
  `extractJson`, `repairJson`, `parseJsonLoose`; and the `SchemaError` class
  thrown on usage/parse errors.
- **Seams & fakes:** **none — pure library, no I/O.** Validation is a pure,
  deterministic transform over a caller-supplied value/string and schema: no
  network, no filesystem, no clock, no randomness, no keys. There is therefore
  **no `Fake<X>`** and **no `live-check`**. The exported functions are
  themselves the contract of record; tests drive them directly.
- **Invariants:**
  - **What it validates.** A JSON-Schema *subset*: `type`
    (`string`/`number`/`integer`/`boolean`/`object`/`array`/`null`, with
    `integer` distinguished from `number`), `properties`, `required`, `items`,
    `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern`, and
    `additionalProperties: false` (reject unknown keys). **Out of scope** (by
    design): `oneOf`/`anyOf`/`allOf`, `$ref`, `format`, custom keywords.
  - **Verdict shape.** A conforming call returns `{ valid: true, value }`; a
    non-conforming one returns `{ valid: false, errors: [{ path, message }] }`
    with one path-tagged error per violation. Validation never coerces values —
    it reports, it does not mutate.
  - **Validation verdict vs. throw (the core distinction).** A *failed
    validation* — missing required field, wrong type, out-of-range, unknown
    property — is a **verdict** (`{ valid: false, errors }`), the correct and
    expected outcome, never an exception. A genuine *usage/parse error* — a
    **malformed schema** (not an object, an unknown `type`, a mis-shaped
    keyword), a **non-string** argument payload to `parseAndValidate`, or an
    argument string that is **unparseable** even after lenient repair — throws
    `SchemaError`. The library never silent-empties on bad input.
  - **Lenient parse, then validate.** `parseAndValidate` runs `parseJsonLoose`
    first (strict `JSON.parse`, then extract-from-prose, then repair common LLM
    mistakes: code fences, trailing commas, unquoted keys, single/smart quotes,
    comments). `parseJsonLoose` itself is a probe that returns `null` for "no
    JSON here"; the throwing contract lives in `parseAndValidate`.
- **Depends on:** nothing — zero runtime dependencies, no sibling cubes. Uses
  only `JSON`/`RegExp` JS primitives, so it runs unchanged on Bun, Node,
  browsers, and edge runtimes.
- **Commands:** `bun test` · `bunx tsc --noEmit`
- **Before editing:** keep the validate-verdict-vs-throw line intact — a failed
  validation is `{ valid: false, errors }`, a malformed schema or unparseable
  input throws `SchemaError`; never collapse one into the other and never
  silent-empty. Preserve the JSON-Schema subset and the no-coercion rule. Do
  **not** invent a network/store/clock seam — the value and schema are always
  caller-supplied, so it stays a pure library. Use extensionless local imports
  only.
