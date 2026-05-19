# tool-call-validator

[![ci](https://github.com/p-vbordei/tool-call-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/tool-call-validator/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/tool-call-validator.svg)](https://www.npmjs.com/package/tool-call-validator)
[![downloads](https://img.shields.io/npm/dm/tool-call-validator.svg)](https://www.npmjs.com/package/tool-call-validator)
[![bundle](https://img.shields.io/bundlejs/size/tool-call-validator)](https://bundlejs.com/?q=tool-call-validator)

> Parse and validate JSON tool-call payloads from LLMs. Lenient parsing (repairs common LLM mistakes: trailing commas, single quotes, code fences, unquoted keys) + JSON-Schema-subset validation. Zero dependencies.

```ts
import { parseAndValidate } from "tool-call-validator";

const schema = {
  type: "object",
  properties: {
    location: { type: "string" },
    units: { enum: ["c", "f"] },
  },
  required: ["location"],
} as const;

// Even when the model returns this nonsense:
const ugly = "Sure! Here:\n```json\n{ location: 'Bucharest', units: 'c', }\n```";

const r = parseAndValidate(ugly, schema);
if (r.valid) {
  callWeatherTool(r.value);
} else {
  for (const e of r.errors) console.warn(`${e.path}: ${e.message}`);
}
```

## Install

```sh
npm install tool-call-validator
```

Works with Node 20+, browsers, Bun, Deno. ESM + CJS.

## Why

When an LLM returns a tool call, the JSON quality is variable:

- Trailing commas
- Single-quoted strings
- Unquoted keys
- Wrapped in ` ```json ... ``` `
- Prose around the JSON ("Here's the result: {...}")
- Smart quotes copy-pasted from elsewhere

A strict `JSON.parse` rejects all of these. You're stuck either retrying with a stricter prompt (slow, expensive) or doing one-off cleanup per call. `tool-call-validator` does both halves:

1. **Lenient parsing** — tries strict first, then extracts JSON from prose, then applies repairs.
2. **Schema validation** — JSON-Schema subset with helpful path-based errors.

Together: pass the raw model output, get a validated typed object or a structured error report.

## Recipes

### Full LLM tool-call loop

```ts
import { parseAndValidate, type Schema } from "tool-call-validator";

const tools = {
  get_weather: {
    schema: {
      type: "object",
      properties: { location: { type: "string" }, units: { enum: ["c", "f"] } },
      required: ["location"],
    } as const satisfies Schema,
    execute: async (args) => fetchWeather(args.location, args.units),
  },
};

async function callTool(name: string, rawArgs: string) {
  const tool = tools[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);

  const v = parseAndValidate(rawArgs, tool.schema);
  if (!v.valid) {
    // Feed errors back to the LLM for a retry
    return { error: "validation failed", details: v.errors };
  }
  return await tool.execute(v.value);
}
```

### Just parse, validate elsewhere

```ts
import { parseJsonLoose } from "tool-call-validator";

const parsed = parseJsonLoose(modelOutput);
if (parsed === null) throw new Error("couldn't extract JSON");

// Validate with your own logic / Zod / Ajv
```

### Strict mode — reject unknown keys

```ts
import { parseAndValidate } from "tool-call-validator";

const schema = {
  type: "object",
  properties: { id: { type: "integer" } },
  required: ["id"],
  additionalProperties: false,  // reject anything not listed
} as const;

const r = parseAndValidate('{"id": 1, "extra": "hi"}', schema);
// → valid: false, errors include "unknown property"
```

### Path-based error reporting back to the LLM

```ts
import { parseAndValidate } from "tool-call-validator";

const r = parseAndValidate(rawArgs, schema);
if (!r.valid) {
  const errorMsg = r.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
  conversation.push({ role: "tool", content: `Validation failed:\n${errorMsg}` });
}
```

## API

### Parsing helpers

| Function | What |
|---|---|
| `extractJson(text)` | Pull out the first JSON object/array from prose or code fences |
| `repairJson(text)` | Apply common fixes (trailing commas, unquoted keys, smart quotes, comments, single→double quotes) |
| `parseJsonLoose(text)` | Try strict, then extract, then repair. Returns `unknown` or `null` |

### Validation

```ts
type Schema = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean;  // false to reject unknown keys
};

validate(value, schema) → { valid: true, value } | { valid: false, errors: [{ path, message }] }
parseAndValidate(text, schema) → same shape, but parses the text first
```

## What repair does

| Input | Output |
|---|---|
| ` ```json\n{...}\n``` ` | JSON unwrapped |
| `{a: 1}` | `{"a": 1}` |
| `{"a": 1,}` | `{"a": 1}` |
| `{'a': 'b'}` | `{"a": "b"}` |
| `{"a": 1} // comment` | `{"a": 1}` |
| `{"a": "b"}` (smart quotes) | `{"a": "b"}` |
| `Here's the JSON: {...}` | JSON extracted from prose |

## Not in scope

Deliberate omissions — this is a tool-call validator, not a full JSON Schema engine:

- `oneOf` / `anyOf` / `allOf`
- `$ref` / definitions
- `format` (date-time, email, etc.) — use `pattern` instead
- Custom keywords

For full JSON Schema, use Ajv. For *just enough* to pin down LLM outputs, this is enough.

## License

Apache-2.0 © Vlad Bordei
