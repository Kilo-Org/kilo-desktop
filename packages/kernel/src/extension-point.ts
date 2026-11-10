import { z } from "zod";

import type { QualifiedId } from "./ids";
import type { WhenExpression } from "./when";

/**
 * Extension point kinds:
 * - additive: many contributions, ordered by priority.
 * - exclusive: one winner (user pin, then priority); later candidates are the fallback chain.
 * - decision: the owner asks contributors a question; each answers proceed / ask / reject.
 */
export type ExtensionKind = "additive" | "exclusive" | "decision";

/** Where a contribution's implementation (component, handler, service…) is bound. */
export type ImplementationProcess = "main" | "renderer" | "any";

declare const implementationType: unique symbol;

export interface ImplementationSpec<TImpl> {
	readonly process: ImplementationProcess;
	/** A contribution without an implementation is inactive when this is true. */
	readonly required: boolean;
	readonly [implementationType]?: TImpl;
}

export function implementation<TImpl>(
	process: ImplementationProcess,
	options: { readonly required?: boolean } = {},
): ImplementationSpec<TImpl> {
	return { process, required: options.required ?? true };
}

export type DecisionAnswer = "proceed" | { readonly ask: string } | { readonly reject: string };

export type DecisionHandler<TInput> = (input: TInput) => DecisionAnswer | Promise<DecisionAnswer>;

export interface DecisionSpec<TInput> {
	readonly input: z.ZodType<TInput>;
	/** `open`: a failing or slow handler counts as proceed. `closed`: as reject. */
	readonly failMode: "open" | "closed";
	readonly timeoutMs: number;
}

export interface ExtensionPointDefinition<
	TMeta = unknown,
	TImpl = unknown,
	TKind extends ExtensionKind = ExtensionKind,
	/** What authors write: defaults in the schema make fields optional here. */
	TMetaInput = TMeta,
> {
	readonly id: QualifiedId;
	readonly kind: TKind;
	readonly description?: string;
	readonly metadata: z.ZodType<TMeta, TMetaInput>;
	readonly implementation?: ImplementationSpec<TImpl>;
	readonly decision?: DecisionSpec<unknown>;
	/**
	 * Contributions may point into their own plugin's `resources/` folder with
	 * `${resources}` in metadata strings; in main, the kernel replaces it with
	 * the contributor's folder, so consumers get absolute paths and never look
	 * up another plugin's files.
	 */
	readonly resources?: boolean;
}

// oxlint-disable-next-line typescript/no-explicit-any -- existential over point type parameters
export type AnyExtensionPoint = ExtensionPointDefinition<any, any, ExtensionKind, any>;

export type MetadataOf<TPoint> =
	TPoint extends ExtensionPointDefinition<infer TMeta, unknown, ExtensionKind, unknown>
		? TMeta
		: never;

export type MetadataInputOf<TPoint> =
	TPoint extends ExtensionPointDefinition<unknown, unknown, ExtensionKind, infer TInput>
		? TInput
		: never;

export type ImplementationOf<TPoint> =
	// oxlint-disable-next-line typescript/no-explicit-any -- inference position
	TPoint extends ExtensionPointDefinition<any, infer TImpl, ExtensionKind, unknown> ? TImpl : never;

/** Fields every contribution entry may carry besides the point's own metadata. */
export interface ContributionCommonFields {
	/** Local id, unique per contributor and point. */
	readonly id: string;
	/** Higher first. Defaults to 0. */
	readonly priority?: number;
	readonly when?: WhenExpression;
}

export type ContributionEntry<TPoint> = ContributionCommonFields & MetadataInputOf<TPoint>;

export const EMPTY_METADATA = z.object({});

export function defineExtensionPoint<
	TMeta,
	TImpl = never,
	TKind extends ExtensionKind = ExtensionKind,
	TMetaInput = TMeta,
>(
	definition: {
		readonly id: QualifiedId;
		readonly kind: TKind;
		readonly description?: string;
		readonly metadata?: z.ZodType<TMeta, TMetaInput>;
		readonly implementation?: ImplementationSpec<TImpl>;
		readonly resources?: boolean;
	} & (TKind extends "decision" ? never : unknown),
): ExtensionPointDefinition<TMeta, TImpl, TKind, TMetaInput> {
	return {
		...definition,
		metadata: definition.metadata ?? (EMPTY_METADATA as unknown as z.ZodType<TMeta, TMetaInput>),
	};
}

export function defineDecisionExtensionPoint<
	TInput,
	TMeta = Record<never, never>,
	TMetaInput = TMeta,
>(definition: {
	readonly id: QualifiedId;
	readonly description?: string;
	readonly process: ImplementationProcess;
	readonly metadata?: z.ZodType<TMeta, TMetaInput>;
	readonly input: z.ZodType<TInput>;
	readonly failMode: "open" | "closed";
	readonly timeoutMs: number;
}): ExtensionPointDefinition<TMeta, DecisionHandler<TInput>, "decision", TMetaInput> {
	return {
		id: definition.id,
		kind: "decision",
		...(definition.description === undefined ? {} : { description: definition.description }),
		metadata: definition.metadata ?? (EMPTY_METADATA as unknown as z.ZodType<TMeta, TMetaInput>),
		implementation: implementation<DecisionHandler<TInput>>(definition.process),
		decision: {
			input: definition.input as z.ZodType<unknown>,
			failMode: definition.failMode,
			timeoutMs: definition.timeoutMs,
		},
	};
}
