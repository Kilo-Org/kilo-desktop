import type { SchemaLike } from "./types/schema.js";

/**
 * Input + output schemas for one feature channel (used by sdk.invoke / mainSdk.channels).
 * Satisfied by Zod schemas; kept structural so plugins need not depend on shell
 * contracts. Standard Schema type metadata preserves distinct raw and parsed
 * types for transforming schemas.
 */
export interface MethodContract<
	TInputSchema extends SchemaLike = SchemaLike,
	TOutputSchema extends SchemaLike = SchemaLike,
> {
	readonly input: TInputSchema;
	readonly output: TOutputSchema;
}

/** Per-feature map of channel name → method contract. */
export type ChannelMap = Record<string, MethodContract>;

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

type InputSchema<M> = M extends { readonly input: infer S extends SchemaLike } ? S : never;
type OutputSchema<M> = M extends { readonly output: infer S extends SchemaLike } ? S : never;

/** Raw argument accepted by typed sdk.invoke. */
export type ChannelInput<M> = SchemaInput<InputSchema<M>>;
/** Parsed argument received by a main-process handler. */
export type ChannelHandlerInput<M> = SchemaOutput<InputSchema<M>>;
/** Raw value returned by a main-process handler before output parsing. */
export type ChannelHandlerOutput<M> = SchemaInput<OutputSchema<M>>;
/** Parsed value returned by typed sdk.invoke. */
export type ChannelOutput<M> = SchemaOutput<OutputSchema<M>>;

/** Rest args for typed invoke: omitted when the channel input is `undefined`. */
export type InvokeArguments<TInput> = [TInput] extends [undefined]
	? [args?: undefined]
	: [args: TInput];

/** Main-process handler for one channel: parsed input in, raw output out. */
export type ChannelHandler<M> = (
	args: ChannelHandlerInput<M>,
) => ChannelHandlerOutput<M> | Promise<ChannelHandlerOutput<M>>;

/**
 * One handler per channel in the map. Used by `mainSdk.channels(map).handleAll`
 * — the compiler enforces that every channel gets a handler.
 */
export type ChannelHandlerMap<C extends ChannelMap> = {
	[K in keyof C]: ChannelHandler<C[K]>;
};

/**
 * Define a channel's input/output schemas. Prefer grouping these via
 * `defineContract` in the contracts package.
 *
 * @example
 * export const todosContract = defineContract({
 *   list: { input: z.undefined(), output: z.array(todoSchema) },
 *   add: { input: z.object({ title: z.string() }), output: todoSchema },
 * });
 */
export function defineMethod<TInputSchema extends SchemaLike, TOutputSchema extends SchemaLike>(
	input: TInputSchema,
	output: TOutputSchema,
): MethodContract<TInputSchema, TOutputSchema> {
	return { input, output };
}

/**
 * Define a feature contract — a channel map that carries an inferred service
 * type via `InferContract<typeof contract>`. Runtime value is a plain object;
 * the type system does all the work. Lives in the SDK so plugins can define
 * contracts without depending on shell-internal packages.
 *
 * @example
 * export const todosContract = defineContract({
 *   list: defineMethod(z.undefined(), z.array(todoSchema)),
 *   add:  defineMethod(z.object({ title: z.string() }), todoSchema),
 * });
 * export type TodoService = InferContract<typeof todosContract>;
 */
export function defineContract<C extends ChannelMap>(channels: C): C {
	return channels;
}

/**
 * Infer a method-style service interface from a contract.
 * Each channel becomes a method: input → args, output → return type.
 * Channels with `undefined` input become zero-arg methods.
 *
 * @example
 * type TodoService = InferContract<typeof todosContract>;
 * // { list(): Promise<Todo[]>; add(args: { title: string }): Promise<Todo> }
 */
export type InferContract<C extends ChannelMap> = {
	[K in keyof C & string]: [ChannelInput<C[K]>] extends [undefined]
		? () => Promise<ChannelOutput<C[K]>>
		: (args: ChannelInput<C[K]>) => Promise<ChannelOutput<C[K]>>;
};
