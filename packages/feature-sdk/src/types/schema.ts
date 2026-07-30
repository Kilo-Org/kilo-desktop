/**
 * Minimal structural schema interface (satisfied by Zod schemas).
 * parse() must throw on invalid input and return the parsed value.
 */
export interface SchemaLike<T = unknown> {
	parse(input: unknown): T;
}
