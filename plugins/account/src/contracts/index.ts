import type { ComponentType } from "react";
import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

/**
 * kilo.account's public surface: the signed-in Kilo account (credentials stay
 * in the Kilo CLI; the app only reads them through the server), acceptance of
 * the terms, and the Account settings panels other plugins add.
 */
export const ACCOUNT_PLUGIN_ID = "kilo.account";

/** True while a Kilo account is signed in. */
export const SIGNED_IN_KEY = "kilo.account/signedIn";
/** True once the current terms of service are accepted on this device. */
export const TERMS_ACCEPTED_KEY = "kilo.account/termsAccepted";

/**
 * Identifies the terms the welcome step asks users to accept. Bump it when the
 * linked terms change: the app stays gated until the new version is accepted.
 */
export const KILO_TERMS_VERSION = "2026-09-29";

export const KILO_TERMS_URL = "https://kilo.ai/terms";

const nothing = z.undefined();

export const organizationSchema = z.object({ id: z.string(), name: z.string(), role: z.string() });

export const profileSchema = z.object({
	profile: z.object({
		email: z.string(),
		name: z.string().optional(),
		organizations: z.array(organizationSchema).optional(),
		selectedOrganizationId: z.string().optional(),
		hasPersonalAccount: z.boolean().optional(),
	}),
	balance: z.object({ balance: z.number() }).nullable(),
	kiloPass: z
		.object({
			currentPeriodBaseCreditsUsd: z.number(),
			currentPeriodUsageUsd: z.number(),
			currentPeriodBonusCreditsUsd: z.number(),
			nextBillingAt: z.string().nullable().optional(),
		})
		.nullable(),
	currentOrgId: z.string().nullable(),
});
export type KiloProfileData = z.output<typeof profileSchema>;
export type KiloOrganization = z.output<typeof organizationSchema>;

export const deviceAuthSchema = z.object({
	status: z.enum(["idle", "initiating", "waiting", "finishing", "error"]),
	code: z.string().optional(),
	verificationUrl: z.string().optional(),
	/** Seconds the code stays valid. */
	expiresIn: z.number().optional(),
	error: z.string().optional(),
});
export type DeviceAuthState = z.output<typeof deviceAuthSchema>;

export const identityStateSchema = z.object({
	/** Whether the Kilo server can be reached to read the account. */
	connection: z.enum(["pending", "connected", "unavailable"]),
	/** Null until known. */
	authenticated: z.boolean().nullable(),
	profile: profileSchema.nullable(),
	/** Signed in, but the profile could not be read. */
	profileError: z.string().nullable(),
	deviceAuth: deviceAuthSchema,
	/** An organization switch that failed, independent of sign-in. */
	orgError: z.object({ message: z.string(), organizationId: z.string().nullable() }).nullable(),
	isRefreshing: z.boolean(),
	isSwitchingOrg: z.boolean(),
});
export type IdentityState = z.output<typeof identityStateSchema>;

/** The signed-in Kilo account, shared by every window and plugin. */
export const Identity = defineDomain({
	id: "kilo.account/identity",
	home: "main",
	state: identityStateSchema,
	methods: {
		/** Runs the device sign-in flow; resolves once it ends. Concurrent calls share one flow. */
		signIn: method(nothing, z.object({ signedIn: z.boolean() })),
		cancelSignIn: method(nothing, nothing),
		signOut: method(nothing, nothing),
		refresh: method(nothing, nothing),
		/** Null switches to the personal account. */
		setOrganization: method(z.object({ organizationId: z.string().nullable() }), nothing),
		dismissOrgError: method(nothing, nothing),
	},
	events: {
		/** A sign-in completed in this app. */
		"signed-in": z.object({}),
		/** The person signed out in this app. */
		"signed-out": z.object({}),
	},
});

export const termsStateSchema = z.object({
	/** The version the app asks users to accept. */
	version: z.string(),
	accepted: z.boolean(),
	/** When the current version was first accepted (ms since epoch). */
	acceptedAt: z.number().nullable(),
});
export type TermsState = z.output<typeof termsStateSchema>;

/** Acceptance of the terms of service on this device. */
export const Terms = defineDomain({
	id: "kilo.account/terms",
	home: "main",
	state: termsStateSchema,
	methods: {
		accept: method(z.object({ version: z.string() }), termsStateSchema),
	},
	events: {
		/** The current terms were accepted for the first time. */
		accepted: z.object({ version: z.string() }),
		/** An account signed in after acceptance; reported once per account. */
		linked: z.object({ version: z.string() }),
	},
});

/** A panel in Settings → Account below the Kilo account, e.g. another service's sign-in. */
export const AccountPanel = defineExtensionPoint({
	id: "kilo.account/account-panel",
	kind: "additive",
	description: "A panel in Settings → Account for another account.",
	implementation: implementation<ComponentType>("renderer"),
});

export const ACCOUNT_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [AccountPanel],
	domains: [Identity, Terms],
};
