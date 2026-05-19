# tool-call-validator

[![ci](https://github.com/p-vbordei/tool-call-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/tool-call-validator/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/tool-call-validator.svg)](https://www.npmjs.com/package/tool-call-validator)
[![downloads](https://img.shields.io/npm/dm/tool-call-validator.svg)](https://www.npmjs.com/package/tool-call-validator)
[![bundle](https://img.shields.io/bundlejs/size/tool-call-validator)](https://bundlejs.com/?q=tool-call-validator)

Parse and validate JSON tool-call payloads from LLMs. **Lenient parsing** (repairs common LLM mistakes: trailing commas, single quotes, code fences, unquoted keys) + **JSON-Schema-subset** validation. Zero dependencies.

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

### Not supported

Deliberate omissions — this is a tool-call validator, not a full JSON Schema engine:

- `oneOf` / `anyOf` / `allOf`
- `$ref` / definitions
- `format` (date-time, email, etc.) — use `pattern` instead
- Custom keywords

For full JSON Schema, use Ajv. For *just enough* to pin down LLM outputs, this is enough.

## License

Apache-2.0 © Vlad Bordei
