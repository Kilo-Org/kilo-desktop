import type { SchemaLike } from "./types/schema.js";
import type { SDK } from "./types/sdk.js";

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

/**
 * Define a channel's input/output schemas. Prefer grouping these in a `as const`
 * channel map owned by the feature/plugin.
 *
 * @example
 * export const todosChannels = {
 *   list: defineMethod(z.undefined(), z.array(todoSchema)),
 *   add: defineMethod(z.object({ title: z.string() }), todoSchema),
 * } as const;
 */
export function defineMethod<TInputSchema extends SchemaLike, TOutputSchema extends SchemaLike>(
	input: TInputSchema,
	output: TOutputSchema,
): MethodContract<TInputSchema, TOutputSchema> {
	return { input, output };
}

/**
 * SDK with invoke typed against a channel map. Channel names, args, and return
 * types are inferred. The feature router parses inputs and outputs once at the
 * handler boundary.
 */
export interface TypedSDK<C extends ChannelMap> extends Omit<SDK, "invoke"> {
	invoke<K extends keyof C & string>(
		channel: K,
		...args: InvokeArguments<ChannelInput<C[K]>>
	): Promise<ChannelOutput<C[K]>>;
}

/**
 * Brand an SDK so invoke is typed against a channel map. Parsing happens in the
 * feature router; this is a compile-time view only.
 *
 * @example
 * const sdk = withChannels(useSdk("todos"), todosChannels);
 * const todos = await sdk.invoke("list");
 * const todo = await sdk.invoke("add", { title: "Milk" });
 */
export function withChannels<C extends ChannelMap>(sdk: SDK, _channels: C): TypedSDK<C> {
	return sdk as TypedSDK<C>;
}
