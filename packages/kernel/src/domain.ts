import type { z } from "zod";

import type { QualifiedId } from "./ids";
import type { HostPermission } from "./permissions";

/**
 * A domain object type: observable state, methods and events, provided by
 * exactly one plugin in its `home` process and proxied to every other process
 * and window. Defined once in the owner's contracts.
 */
export interface MethodSpec<
	TInput extends z.ZodType = z.ZodType,
	TOutput extends z.ZodType = z.ZodType,
> {
	readonly input: TInput;
	readonly output: TOutput;
}

export type MethodSpecs = Readonly<Record<string, MethodSpec>>;
export type EventSpecs = Readonly<Record<string, z.ZodType>>;

export interface Domain<
	TState extends z.ZodType = z.ZodType,
	TMethods extends MethodSpecs = MethodSpecs,
	TEvents extends EventSpecs = EventSpecs,
> {
	readonly id: QualifiedId;
	readonly home: "main" | "renderer";
	readonly description?: string;
	readonly state: TState;
	readonly methods: TMethods;
	readonly events: TEvents;
	/** Non-owners need this host permission to call methods (kernel host primitives). */
	readonly permission?: HostPermission;
	/**
	 * Methods refuse calls from other processes, whoever claims to make them:
	 * for secrets that must never reach a window.
	 */
	readonly homeCallersOnly?: boolean;
	/** Resolves an `ObjectRef` id against the state, for collection-like domains. */
	readonly lookup?: (state: z.output<TState>, id: string) => unknown;
}

// oxlint-disable-next-line typescript/no-explicit-any -- existential over domain type parameters
export type AnyDomain = Domain<any, any, any>;

export type DomainState<TDomain> =
	TDomain extends Domain<infer TState, MethodSpecs, EventSpecs> ? z.output<TState> : never;

export type DomainMethods<TDomain> =
	TDomain extends Domain<z.ZodType, infer TMethods, EventSpecs>
		? {
				readonly [K in keyof TMethods]: (
					input: z.input<TMethods[K]["input"]>,
				) => Promise<z.output<TMethods[K]["output"]>>;
			}
		: never;

export type DomainMethodImpls<TDomain> =
	TDomain extends Domain<z.ZodType, infer TMethods, EventSpecs>
		? {
				readonly [K in keyof TMethods]: (
					input: z.output<TMethods[K]["input"]>,
					caller: DomainCaller,
				) =>
					| ImplementationOutput<z.input<TMethods[K]["output"]>>
					| Promise<ImplementationOutput<z.input<TMethods[K]["output"]>>>;
			}
		: never;

/** Methods whose output may be undefined can simply return nothing. */
type ImplementationOutput<T> = undefined extends T ? T | void : T;

export type DomainEventName<TDomain> =
	TDomain extends Domain<z.ZodType, MethodSpecs, infer TEvents> ? keyof TEvents & string : never;

export type DomainEventPayload<TDomain, TName extends string> =
	TDomain extends Domain<z.ZodType, MethodSpecs, infer TEvents>
		? TName extends keyof TEvents
			? z.output<TEvents[TName]>
			: never
		: never;

export interface DomainCaller {
	/**
	 * The calling plugin, or `kernel`. Trustworthy from the main process; from
	 * a window it is advisory among that window's plugins, which share one
	 * JavaScript context (see docs/plugins/domains.md).
	 */
	readonly pluginId: string;
	/** The process the call came from. */
	readonly process: "main" | "renderer";
	/** The window a renderer call came from; the transport vouches for it. */
	readonly windowId?: string;
}

export function defineDomain<
	TState extends z.ZodType,
	TMethods extends MethodSpecs = Record<never, never>,
	TEvents extends EventSpecs = Record<never, never>,
>(definition: {
	readonly id: QualifiedId;
	readonly home: "main" | "renderer";
	readonly description?: string;
	readonly state: TState;
	readonly methods?: TMethods;
	readonly events?: TEvents;
	readonly permission?: HostPermission;
	readonly homeCallersOnly?: boolean;
	readonly lookup?: (state: z.output<TState>, id: string) => unknown;
}): Domain<TState, TMethods, TEvents> {
	return {
		...definition,
		methods: definition.methods ?? ({} as TMethods),
		events: definition.events ?? ({} as TEvents),
	};
}

export function method<TInput extends z.ZodType, TOutput extends z.ZodType>(
	input: TInput,
	output: TOutput,
): MethodSpec<TInput, TOutput> {
	return { input, output };
}

/** A typed reference to one object of a domain type. Serializable; resolves to `null` when gone. */
export interface ObjectRef<TType extends QualifiedId = QualifiedId> {
	readonly type: TType;
	readonly id: string;
}

export function ref<TDomain extends AnyDomain>(
	domain: TDomain,
	id: string,
): ObjectRef<TDomain["id"]> {
	return { type: domain.id, id };
}

export function isRef<TDomain extends AnyDomain>(
	domain: TDomain,
	value: unknown,
): value is ObjectRef<TDomain["id"]> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === domain.id &&
		typeof (value as { id?: unknown }).id === "string"
	);
}
