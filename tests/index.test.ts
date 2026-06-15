import { describe, it, expect } from "bun:test";
import {
  extractJson,
  repairJson,
  parseJsonLoose,
  validate,
  parseAndValidate,
  SchemaError,
} from "../src/index";

describe("extractJson", () => {
  it("returns input unchanged when already JSON", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts JSON from prose", () => {
    expect(extractJson('Here is the result: {"name":"foo"} OK')).toBe('{"name":"foo"}');
  });
  it("handles nested braces", () => {
    expect(extractJson('{"a":{"b":[1,2]}}')).toBe('{"a":{"b":[1,2]}}');
  });
  it("handles array root", () => {
    expect(extractJson("Output: [1, 2, 3]")).toBe("[1, 2, 3]");
  });
  it("ignores braces inside strings", () => {
    expect(extractJson('{"text":"has } in it"}')).toBe('{"text":"has } in it"}');
  });
  it("returns null when no JSON", () => {
    expect(extractJson("just text")).toBeNull();
  });
});

describe("repairJson", () => {
  it("removes trailing commas", () => {
    expect(JSON.parse(repairJson('{"a":1,"b":2,}'))).toEqual({ a: 1, b: 2 });
    expect(JSON.parse(repairJson('[1,2,3,]'))).toEqual([1, 2, 3]);
  });
  it("quotes unquoted keys", () => {
    expect(JSON.parse(repairJson('{foo:"bar"}'))).toEqual({ foo: "bar" });
  });
  it("converts single quotes to double", () => {
    expect(JSON.parse(repairJson("{'a':'b'}"))).toEqual({ a: "b" });
  });
  it("strips // comments", () => {
    expect(JSON.parse(repairJson('{"a":1} // trailing'))).toEqual({ a: 1 });
  });
  it("strips /* */ comments", () => {
    expect(JSON.parse(repairJson('{/* note */"a":1}'))).toEqual({ a: 1 });
  });
  it("normalizes smart quotes", () => {
    expect(JSON.parse(repairJson('{“a”:“b”}'))).toEqual({ a: "b" });
  });
});

describe("parseJsonLoose", () => {
  it("falls back through repairs", () => {
    expect(parseJsonLoose("```json\n{a: 'b',}\n```")).toEqual({ a: "b" });
  });
  it("returns null on hopeless input", () => {
    expect(parseJsonLoose("this is not json at all")).toBeNull();
  });
});

describe("validate: primitives", () => {
  it("string", () => {
    expect(validate("hi", { type: "string" }).valid).toBe(true);
    expect(validate(42, { type: "string" }).valid).toBe(false);
  });
  it("number", () => {
    expect(validate(3.14, { type: "number" }).valid).toBe(true);
    expect(validate("3.14", { type: "number" }).valid).toBe(false);
  });
  it("integer distinguishes from float", () => {
    expect(validate(3, { type: "integer" }).valid).toBe(true);
    expect(validate(3.5, { type: "integer" }).valid).toBe(false);
  });
  it("null", () => {
    expect(validate(null, { type: "null" }).valid).toBe(true);
    expect(validate(0, { type: "null" }).valid).toBe(false);
  });
});

describe("validate: object", () => {
  const schema = {
    type: "object" as const,
    properties: {
      name: { type: "string" as const, minLength: 1 },
      age: { type: "integer" as const, minimum: 0 },
    },
    required: ["name"],
  };
  it("accepts valid", () => {
    expect(validate({ name: "Vlad", age: 30 }, schema).valid).toBe(true);
  });
  it("requires required field → {valid:false, errors}", () => {
    const r = validate({ age: 30 }, schema);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]!.path).toBe("name");
  });
  it("reports a wrong-type field → {valid:false, errors}", () => {
    const r = validate({ name: 123 }, schema);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.path === "name" && e.message.includes("expected string"))).toBe(true);
  });
  it("validates nested fields", () => {
    const r = validate({ name: "", age: -1 }, schema);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.path === "name")).toBe(true);
      expect(r.errors.some((e) => e.path === "age")).toBe(true);
    }
  });
  it("rejects unknown property with additionalProperties: false", () => {
    const strict = { ...schema, additionalProperties: false };
    const r = validate({ name: "x", extra: 1 }, strict);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]!.path).toBe("extra");
  });
});

describe("validate: array + enum", () => {
  it("array items", () => {
    expect(
      validate([1, 2, 3], { type: "array", items: { type: "integer" } }).valid,
    ).toBe(true);
    expect(
      validate([1, "two"], { type: "array", items: { type: "integer" } }).valid,
    ).toBe(false);
  });
  it("enum", () => {
    expect(validate("a", { enum: ["a", "b", "c"] }).valid).toBe(true);
    expect(validate("z", { enum: ["a", "b", "c"] }).valid).toBe(false);
  });
});

describe("validate: string constraints", () => {
  it("pattern", () => {
    expect(validate("abc", { type: "string", pattern: "^[a-z]+$" }).valid).toBe(true);
    expect(validate("abc1", { type: "string", pattern: "^[a-z]+$" }).valid).toBe(false);
  });
  it("min/maxLength", () => {
    expect(validate("ab", { type: "string", minLength: 3 }).valid).toBe(false);
    expect(validate("abcd", { type: "string", maxLength: 3 }).valid).toBe(false);
  });
});

describe("validate: malformed schema throws (usage error, not a verdict)", () => {
  it("throws on a non-object schema", () => {
    // @ts-expect-error — deliberately bad usage
    expect(() => validate({ a: 1 }, null)).toThrow(SchemaError);
    // @ts-expect-error — deliberately bad usage
    expect(() => validate({ a: 1 }, "string")).toThrow(SchemaError);
  });
  it("throws on an unknown type keyword", () => {
    // @ts-expect-error — "frobnicate" is not a valid type
    expect(() => validate({}, { type: "frobnicate" })).toThrow(SchemaError);
  });
  it("throws on a malformed nested property schema", () => {
    expect(() =>
      // @ts-expect-error — nested schema is not an object
      validate({ a: 1 }, { type: "object", properties: { a: 7 } }),
    ).toThrow(SchemaError);
  });
  it("throws when 'required' is not an array", () => {
    // @ts-expect-error — required must be an array
    expect(() => validate({}, { type: "object", required: "name" })).toThrow(SchemaError);
  });
});

describe("parseAndValidate", () => {
  it("end-to-end on a clean tool call", () => {
    const schema = {
      type: "object" as const,
      properties: {
        location: { type: "string" as const },
        units: { enum: ["c", "f"] as const },
      },
      required: ["location"],
    };
    const r = parseAndValidate('{"location":"Bucharest","units":"c"}', schema);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value).toEqual({ location: "Bucharest", units: "c" });
  });

  it("end-to-end on a messy LLM output", () => {
    const schema = {
      type: "object" as const,
      properties: { name: { type: "string" as const } },
      required: ["name"],
    };
    const messy = "Sure, here you go:\n```json\n{name: 'Vlad',}\n```";
    const r = parseAndValidate(messy, schema);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value).toEqual({ name: "Vlad" });
  });

  it("parses-but-non-conforming → {valid:false, errors} (verdict, not throw)", () => {
    const schema = {
      type: "object" as const,
      properties: { name: { type: "string" as const } },
      required: ["name"],
    };
    const r = parseAndValidate('{"name": 42}', schema);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.path === "name")).toBe(true);
  });

  it("throws SchemaError on unparseable JSON input", () => {
    expect(() => parseAndValidate("definitely not json", { type: "object" })).toThrow(SchemaError);
  });

  it("throws SchemaError on a non-string argument payload", () => {
    // @ts-expect-error — input must be a string
    expect(() => parseAndValidate({ already: "parsed" }, { type: "object" })).toThrow(SchemaError);
  });

  it("throws SchemaError on a malformed schema before parsing", () => {
    // @ts-expect-error — bad schema
    expect(() => parseAndValidate('{"a":1}', { type: "nope" })).toThrow(SchemaError);
  });
});
