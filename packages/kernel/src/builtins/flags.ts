import { z } from "zod";

import { defineDomainObject } from "../domain-object";
import { defineExtensionPoint, implementation } from "../extension-point";
import type { IdentityState } from "./identity";

export const flagValueSchema = z.union([z.boolean(), z.string(), z.number()]);
export type FlagValue = z.output<typeof flagValueSchema>;

/**
 * A feature flag a plugin uses. The contribution id is the flag's id, shared
 * with the flag source (`developer`, `workspace-board`), so it is global:
 * the first plugin to declare an id owns it. Flags are read from manifests,
 * so a plugin behind its own flag still declares it while inactive.
 */
export const KernelFlag = defineExtensionPoint({
	id: "kernel/flag",
	kind: "additive",
	description: "A declared feature flag: its id, description and default.",
	metadata: z.object({
		description: z.string().min(1),
		default: flagValueSchema.default(false),
	}),
});

/** What the flag source implements, in main. */
export interface FlagSource {
	/** Values by flag id; null until the source has answered. Flags it omits keep their default. */
	values(): Readonly<Record<string, FlagValue>> | null;
	/** Calls `listener` after values change. */
	subscribe(listener: () => void): () => void;
	/** Evaluates flags for this identity from now on; called again whenever it changes. */
	identify(identity: IdentityState): void | Promise<void>;
}

/** Evaluates flags for the identity. One wins; without one, every flag has its default. */
export const KernelFlagSource = defineExtensionPoint({
	id: "kernel/flag-source",
	kind: "exclusive",
	description: "Evaluates feature flags for the identity.",
	implementation: implementation<FlagSource>("main"),
});

export const FLAG_ORIGINS = ["default", "source", "override"] as const;

export const flagRecordSchema = z.object({
	value: flagValueSchema,
	default: flagValueSchema,
	description: z.string(),
	/** The plugin that declared it. */
	pluginId: z.string(),
	/** Where the value came from: the declared default, the flag source, or the host's overrides. */
	origin: z.enum(FLAG_ORIGINS),
});
export type FlagRecord = z.output<typeof flagRecordSchema>;

/**
 * Every declared flag's value, by flag id. `ready` turns true once the flag
 * source has answered (or at once, without one). `kernel/flag:<id>` is true
 * while a flag's value is `true`, for `when`.
 */
export const KernelFlags = defineDomainObject({
	id: "kernel/flags",
	home: "main",
	description: "Every declared feature flag and its value for the identity.",
	state: z.object({
		ready: z.boolean(),
		flags: z.record(z.string(), flagRecordSchema),
	}),
	events: {
		changed: z.object({ ids: z.array(z.string()) }),
	},
	lookup: (state, id) => state.flags[id],
});

/** The context key that is true while `flag` is on, for `when` and `useContextKey`. */
export function flagKey<TFlag extends string>(flag: TFlag): `kernel/flag:${TFlag}` {
	return `kernel/flag:${flag}`;
}
