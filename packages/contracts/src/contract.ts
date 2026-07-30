import type { z } from "zod";

export interface IpcMethodContract<
	TInput extends z.ZodType = z.ZodType,
	TOutput extends z.ZodType = z.ZodType,
> {
	readonly input: TInput;
	readonly output: TOutput;
}

export interface IpcEventContract<TPayload extends z.ZodType = z.ZodType> {
	readonly payload: TPayload;
}

export function defineMethod<TInput extends z.ZodType, TOutput extends z.ZodType>(
	input: TInput,
	output: TOutput,
): IpcMethodContract<TInput, TOutput> {
	return { input, output };
}

export function defineEvent<TPayload extends z.ZodType>(
	payload: TPayload,
): IpcEventContract<TPayload> {
	return { payload };
}

// ─── Feature contracts ───────────────────────────────────────────────────────

/** Structural schema constraint (satisfied by Zod, no import needed). */
type SchemaLike<T = unknown> = { parse(input: unknown): T };
type MethodContractLike = { readonly input: SchemaLike; readonly output: SchemaLike };

/** A map of channel name → { input, output } schemas defining a feature's API. */
export type ContractMap = Record<string, MethodContractLike>;

type StandardSchemaInput<S> = S extends {
	readonly "~standard": {
		readonly types?: { readonly input: infer I; readonly output: unknown } | undefined;
	};
}
	? I
	: never;

type SchemaOutput<S> = S extends SchemaLike<infer O> ? O : never;
type SchemaInput<S> = [StandardSchemaInput<S>] extends [never]
	? SchemaOutput<S>
	: StandardSchemaInput<S>;

/**
 * Infer a method-style service interface from a contract.
 * Each channel becomes a method: input → args, output → return type.
 * Channels with `undefined` input become zero-arg methods.
 *
 * @example
 * type TodoService = InferContract<typeof todosContract>;
 * // { list(): Promise<Todo[]>; add(args: { title: string }): Promise<Todo> }
 */
export type InferContract<C extends ContractMap> = {
	[K in keyof C & string]: [SchemaInput<C[K]["input"]>] extends [undefined]
		? () => Promise<SchemaOutput<C[K]["output"]>>
		: (args: SchemaInput<C[K]["input"]>) => Promise<SchemaOutput<C[K]["output"]>>;
};

/**
 * Define a feature contract — a channel map that carries an inferred service
 * type via `InferContract<typeof contract>`. Runtime value is a plain object;
 * the type system does all the work.
 *
 * @example
 * export const todosContract = defineContract({
 *   list: defineMethod(z.undefined(), z.array(todoSchema)),
 *   add:  defineMethod(z.object({ title: z.string() }), todoSchema),
 * });
 * export type TodoService = InferContract<typeof todosContract>;
 */
export function defineContract<C extends ContractMap>(channels: C): C {
	return channels;
}
