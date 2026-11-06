import type { MethodSpec } from "@kilo-desktop/kernel";

/**
 * Writes the zod schemas behind extension points and domain objects as
 * TypeScript-like types, so Diagnostics can show the domain model in the
 * language people and agents write it in. Reads zod 4's schema definitions
 * (`_zod.def`) structurally, so the plugin needs no zod at runtime; anything
 * unrecognised is `unknown`. Types are what authors write: transformed
 * schemas show their input, and defaulted fields are optional.
 */

interface SchemaDef {
	readonly type: string;
	readonly [key: string]: unknown;
}

interface Schema {
	readonly _zod: { readonly def: SchemaDef };
	readonly description?: string;
}

const INDENT = "  ";
/** Deeper than any real contract; only a recursive (lazy) schema gets here. */
const MAX_DEPTH = 8;
const INLINE_FIELDS = 2;
const INLINE_WIDTH = 60;

const PRIMITIVES: Readonly<Record<string, string>> = {
	string: "string",
	number: "number",
	int: "number",
	nan: "number",
	boolean: "boolean",
	bigint: "bigint",
	symbol: "symbol",
	null: "null",
	undefined: "undefined",
	void: "void",
	never: "never",
	any: "any",
	unknown: "unknown",
	date: "Date",
	file: "File",
	template_literal: "string",
	transform: "unknown",
	custom: "unknown",
};

/** Wrappers that only change whether a value may be left out; see {@link field}. */
const OPTIONAL_WRAPPERS = new Set(["optional", "default", "prefault"]);
/** Wrappers that don't change the type authors write. */
const TRANSPARENT_WRAPPERS = new Set(["readonly", "catch", "nonoptional", "success"]);

function isSchema(value: unknown): value is Schema {
	const def = (value as Partial<Schema> | null | undefined)?._zod?.def;
	return typeof def?.type === "string";
}

function defOf(schema: Schema): SchemaDef {
	return schema._zod.def;
}

export function formatType(schema: unknown): string {
	return write(schema, 0, 0);
}

/** `name(input: T): Output`, with no parameter when the method takes nothing. */
export function formatMethod(name: string, spec: MethodSpec): string {
	const input = write(spec.input, 0, 0);
	const output = write(spec.output, 0, 0);
	const parameter = input === "undefined" || input === "void" ? "" : `input: ${input}`;
	return `${name}(${parameter}): ${output === "undefined" ? "void" : output}`;
}

export function formatEvent(name: string, payload: unknown): string {
	return `${JSON.stringify(name)}: ${write(payload, 0, 0)}`;
}

/**
 * `depth` guards recursion; `level` is the indentation of the line the type
 * starts on, which only object members deepen.
 */
function write(schema: unknown, depth: number, level: number): string {
	if (!isSchema(schema)) return "unknown";
	if (depth > MAX_DEPTH) return "…";
	const def = defOf(schema);
	const primitive = PRIMITIVES[def.type];
	if (primitive) return primitive;
	const next = (inner: unknown) => write(inner, depth + 1, level);
	switch (def.type) {
		case "literal":
			return (def["values"] as readonly unknown[]).map(literal).join(" | ");
		case "enum":
			return Object.values(def["entries"] as Record<string, unknown>)
				.map(literal)
				.join(" | ");
		case "object":
			return object(def, depth, level);
		case "array":
			return `${group(next(def["element"]))}[]`;
		case "tuple": {
			const items = (def["items"] as readonly unknown[]).map(next);
			if (isSchema(def["rest"])) items.push(`...${group(next(def["rest"]))}[]`);
			return `[${items.join(", ")}]`;
		}
		case "union":
			return (def["options"] as readonly unknown[]).map(next).join(" | ");
		case "intersection":
			return `${group(next(def["left"]))} & ${group(next(def["right"]))}`;
		case "record":
			return `Record<${next(def["keyType"])}, ${next(def["valueType"])}>`;
		case "map":
			return `Map<${next(def["keyType"])}, ${next(def["valueType"])}>`;
		case "set":
			return `Set<${next(def["valueType"])}>`;
		case "promise":
			return `Promise<${next(def["innerType"])}>`;
		case "function":
			return "(...args: unknown[]) => unknown";
		case "nullable":
			return `${next(def["innerType"])} | null`;
		case "optional":
			return `${next(def["innerType"])} | undefined`;
		case "pipe":
			return next(def["in"]);
		case "lazy":
			return next((def["getter"] as () => unknown)());
		default:
			if (OPTIONAL_WRAPPERS.has(def.type) || TRANSPARENT_WRAPPERS.has(def.type)) {
				return write(def["innerType"], depth, level);
			}
			return "unknown";
	}
}

interface Field {
	readonly name: string;
	readonly type: string;
	readonly optional: boolean;
	readonly defaultValue?: unknown;
	readonly description?: string;
}

/** Unwraps a property's optional / default wrappers into a field. */
function field(name: string, schema: unknown, depth: number, level: number): Field {
	let optional = false;
	let defaultValue: unknown;
	let description = isSchema(schema) ? schema.description : undefined;
	let current = schema;
	while (isSchema(current) && OPTIONAL_WRAPPERS.has(defOf(current).type)) {
		const def = defOf(current);
		optional = true;
		if (def.type !== "optional" && defaultValue === undefined) defaultValue = def["defaultValue"];
		current = def["innerType"];
		description ??= isSchema(current) ? current.description : undefined;
	}
	return {
		name,
		type: write(current, depth + 1, level + 1),
		optional,
		...(defaultValue === undefined ? {} : { defaultValue }),
		...(description ? { description } : {}),
	};
}

function object(def: SchemaDef, depth: number, level: number): string {
	const shape = def["shape"] as Readonly<Record<string, unknown>>;
	const fields = Object.entries(shape).map(([name, schema]) => field(name, schema, depth, level));
	const catchall = def["catchall"];
	const rest =
		isSchema(catchall) && defOf(catchall).type !== "never"
			? `[key: string]: ${write(catchall, depth + 1, level + 1)}`
			: undefined;
	const members = [...fields.map(member), ...(rest ? [rest] : [])];
	if (members.length === 0) return "{}";

	const inline = `{ ${members.join("; ")} }`;
	const fitsInline =
		members.length <= INLINE_FIELDS &&
		inline.length <= INLINE_WIDTH &&
		!inline.includes("\n") &&
		fields.every((entry) => entry.defaultValue === undefined && !entry.description);
	if (fitsInline) return inline;

	const indent = INDENT.repeat(level + 1);
	const lines = fields.flatMap((entry) => [
		...(entry.description ? [`${indent}/** ${entry.description} */`] : []),
		`${indent}${member(entry)};${
			entry.defaultValue === undefined ? "" : ` // default: ${JSON.stringify(entry.defaultValue)}`
		}`,
	]);
	if (rest) lines.push(`${indent}${rest};`);
	return ["{", ...lines, `${INDENT.repeat(level)}}`].join("\n");
}

function member(entry: Field): string {
	return `${propertyName(entry.name)}${entry.optional ? "?" : ""}: ${entry.type}`;
}

function propertyName(name: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function literal(value: unknown): string {
	return typeof value === "bigint" ? `${value}n` : JSON.stringify(value);
}

/** Parenthesises a top-level union or intersection where it would bind wrongly (`T[]`, `A & B`). */
function group(type: string): string {
	let nesting = 0;
	let inString = false;
	for (let index = 0; index < type.length; index++) {
		const char = type[index]!;
		if (inString) {
			if (char === "\\") index++;
			else if (char === '"') inString = false;
		} else if (char === '"') inString = true;
		else if ("{[(<".includes(char)) nesting++;
		else if ("}])".includes(char) || (char === ">" && type[index - 1] !== "=")) nesting--;
		else if (nesting === 0 && (char === "|" || char === "&")) return `(${type})`;
	}
	return type;
}
