import { z } from "zod";

import { defineDomainObject } from "../domain-object";
import { defineExtensionPoint, implementation } from "../extension-point";

/** A fact about an account that flags can target and telemetry attaches. */
export const accountAttributeSchema = z.union([z.string(), z.number(), z.boolean()]);

/** An account as its plugin describes it. */
export const accountInputSchema = z.object({
	/** Stable id of the account where it lives. */
	id: z.string().min(1),
	email: z.string().optional(),
	name: z.string().optional(),
	organization: z.object({ id: z.string().min(1), name: z.string().optional() }).optional(),
	/** Further facts (plan, employee…), by name. */
	attributes: z.record(z.string(), accountAttributeSchema).default({}),
});
export type AccountInput = z.input<typeof accountInputSchema>;

/** An account in `kernel/identity`: what its plugin described, and which contribution it came from. */
export const accountSchema = accountInputSchema.extend({
	/** The contribution that describes it (`<plugin>/<id>`). */
	source: z.string(),
});
export type Account = z.output<typeof accountSchema>;

export const identityStateSchema = z.object({
	/** The person using the app, from `kernel/identity-provider`; null while signed out. */
	primary: accountSchema.nullable(),
	/** Other signed-in accounts, from `kernel/linked-account`, in contribution order. */
	linked: z.array(accountSchema),
});
export type IdentityState = z.output<typeof identityStateSchema>;

/**
 * Who the user is: the primary account plus linked accounts. Flags are
 * evaluated for it and telemetry describes it, so neither needs to know which
 * plugins provide the accounts.
 */
export const KernelIdentity = defineDomainObject({
	id: "kernel/identity",
	home: "main",
	description: "Who the user is: the primary account and linked accounts.",
	state: identityStateSchema,
	events: {
		changed: z.object({}),
	},
});

/** What an account contribution implements, in main: the current account and its changes. */
export interface AccountSource {
	/** The signed-in account, or null when there is none. */
	current(): AccountInput | null;
	/** Calls `listener` after the account changes. */
	subscribe(listener: () => void): () => void;
}

/** The primary identity. One wins; without one, the user is anonymous. */
export const KernelIdentityProvider = defineExtensionPoint({
	id: "kernel/identity-provider",
	kind: "exclusive",
	description: "The primary identity: the account the user signs in with.",
	implementation: implementation<AccountSource>("main"),
});

/** Another signed-in account, added to the identity flags and telemetry see. */
export const KernelLinkedAccount = defineExtensionPoint({
	id: "kernel/linked-account",
	kind: "additive",
	description: "Another signed-in account, added to the identity flags and telemetry see.",
	implementation: implementation<AccountSource>("main"),
});
