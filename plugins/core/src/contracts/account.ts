import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

const nothing = z.undefined();

/** True while a Kilo account is signed in. */
export const SIGNED_IN_KEY = "kilo.core/signedIn";
/** True once the current terms of service are accepted on this device. */
export const TERMS_ACCEPTED_KEY = "kilo.core/termsAccepted";

/**
 * Identifies the terms the app asks users to accept. Bump it when the linked
 * terms change: the app stays gated until the new version is accepted.
 */
export const KILO_TERMS_VERSION = "2026-09-29";

export const KILO_TERMS_URL = "https://kilo.ai/terms";

export const organizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: z.string().optional(),
});
export type KiloOrganization = z.output<typeof organizationSchema>;

/**
 * The signed-in account as Kilo v2's gateway reports it: its profile
 * (`kilocode.gateway.profile`), balance and Kilo Pass, each read on its own.
 */
export const profileSchema = z.object({
	email: z.string(),
	name: z.string().optional(),
	organizations: z.array(organizationSchema),
	hasPersonalAccount: z.boolean(),
	/** The organisation requests use now; null is the personal account. */
	organizationId: z.string().nullable(),
	/** Null when it could not be read. */
	balance: z
		.object({ balance: z.number().nullable(), isDepleted: z.boolean().optional() })
		.nullable(),
	kiloPass: z
		.object({
			currentPeriodBaseCreditsUsd: z.number(),
			currentPeriodUsageUsd: z.number(),
			currentPeriodBonusCreditsUsd: z.number(),
			nextBillingAt: z.string().nullable(),
		})
		.nullable(),
});
export type KiloProfile = z.output<typeof profileSchema>;

/** Where the device sign-in flow is: the code to show and the page to open while `waiting`. */
export const deviceSignInSchema = z.object({
	status: z.enum(["idle", "initiating", "waiting", "finishing", "error"]),
	code: z.string().optional(),
	verificationUrl: z.string().optional(),
	/** Seconds the code stays valid. */
	expiresIn: z.number().optional(),
	error: z.string().optional(),
});
export type DeviceSignInState = z.output<typeof deviceSignInSchema>;

export const accountStateSchema = z.object({
	/** Whether the Kilo server can be reached to read the account. */
	connection: z.enum(["pending", "connected", "unavailable"]),
	/** Null until known. */
	signedIn: z.boolean().nullable(),
	profile: profileSchema.nullable(),
	/** Signed in, but the profile could not be read. */
	profileError: z.string().nullable(),
	deviceSignIn: deviceSignInSchema,
	/** The last organisation switch that failed, until the next switch. */
	organizationError: z
		.object({ message: z.string(), organizationId: z.string().nullable() })
		.nullable(),
	refreshing: z.boolean(),
	switchingOrganization: z.boolean(),
});
export type AccountState = z.output<typeof accountStateSchema>;

/**
 * The signed-in Kilo account. Credentials stay in the Kilo CLI; the app only
 * reads the account through the server. It is also the app's primary
 * identity (`kernel/identity-provider`).
 */
export const KiloAccount = defineDomainObject({
	id: "kilo.core/account",
	home: "main",
	description: "The signed-in Kilo account: profile, organisations, sign-in and sign-out.",
	state: accountStateSchema,
	methods: {
		/** Runs the device sign-in flow; resolves once it ends. Concurrent calls share one flow. */
		signIn: method(nothing, z.object({ signedIn: z.boolean() })),
		cancelSignIn: method(nothing, nothing),
		signOut: method(nothing, nothing),
		refresh: method(nothing, nothing),
		/** Null switches to the personal account. */
		setOrganization: method(z.object({ organizationId: z.string().nullable() }), nothing),
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

/** Acceptance of the terms of service on this device. The Kilo server waits for it. */
export const KiloTerms = defineDomainObject({
	id: "kilo.core/terms",
	home: "main",
	description: "Acceptance of the terms of service on this device.",
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
