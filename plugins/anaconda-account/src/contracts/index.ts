import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.anaconda-account's public surface: the Anaconda account, a credential
 * source for features that call Anaconda services (the model catalog). It is
 * not the app's identity — that is the Kilo account (kilo.account). The API
 * key lives in the Anaconda keyring shared with the Anaconda CLI and conda,
 * and only the plugins allowed to read it get it, from main.
 */
export const ANACONDA_ACCOUNT_PLUGIN_ID = "kilo.anaconda-account";

/** Plugins whose calls to `apiKey()` are answered; everyone else gets PERMISSION_DENIED. */
export const ANACONDA_API_KEY_READERS: readonly string[] = [
	ANACONDA_ACCOUNT_PLUGIN_ID,
	"kilo.local-inference",
];

export const anacondaAccountUserSchema = z.object({
	userId: z.string().optional(),
	username: z.string().optional(),
	email: z.string().optional(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
});

/**
 * `authenticated` means a valid Anaconda API key is stored (however it got
 * there); `anonymous` means no usable key; `error` is a failed resolve or
 * sign-in/out, with a user-facing reason.
 */
export const anacondaAccountSessionSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("anonymous") }),
	z.object({ status: z.literal("authenticated"), user: anacondaAccountUserSchema }),
	z.object({ status: z.literal("error"), reason: z.string() }),
]);

/** `cancelled` marks a sign-in the person cancelled — not an error worth reporting. */
export const anacondaAccountResultSchema = z.union([
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), reason: z.string(), cancelled: z.boolean().optional() }),
]);

export const anacondaAccountStateSchema = z.object({
	session: anacondaAccountSessionSchema,
	/** True while a browser sign-in is waiting, in any window. */
	signingIn: z.boolean(),
});

export type AnacondaAccountUser = z.output<typeof anacondaAccountUserSchema>;
export type AnacondaAccountSession = z.output<typeof anacondaAccountSessionSchema>;
export type AnacondaAccountResult = z.output<typeof anacondaAccountResultSchema>;
export type AnacondaAccountState = z.output<typeof anacondaAccountStateSchema>;

const nothing = z.undefined();

/** The Anaconda account and its browser sign-in, shared by every window and plugin. */
export const AnacondaAccount = defineDomain({
	id: "kilo.anaconda-account/account",
	home: "main",
	state: anacondaAccountStateSchema,
	methods: {
		/** Resolves the session from the stored key once; later calls return it. */
		session: method(nothing, anacondaAccountSessionSchema),
		/** Re-checks the stored key (picks up keys added or removed by other tools). */
		refresh: method(nothing, anacondaAccountSessionSchema),
		/**
		 * Runs the browser sign-in that stores an Anaconda API key. While one is
		 * waiting, calling it again reopens the authorization page and shares its
		 * outcome. Never fails: failures come back as `{ ok: false }`.
		 */
		signIn: method(nothing, anacondaAccountResultSchema),
		/** Cancels a waiting sign-in; its `signIn()` resolves with `cancelled: true`. */
		cancelSignIn: method(nothing, nothing),
		/** Deletes the stored Anaconda API key. Never fails. */
		signOut: method(nothing, anacondaAccountResultSchema),
		/** The stored API key, or null. Only for {@link ANACONDA_API_KEY_READERS}. */
		apiKey: method(nothing, z.string().nullable()),
		/** The Anaconda site the key belongs to (e.g. `anaconda.com`). */
		siteDomain: method(nothing, z.string()),
	},
	events: {
		/** The session or the stored key changed, e.g. a key rotated without a new session. */
		changed: z.object({}),
	},
});

export const ANACONDA_ACCOUNT_DEFINITIONS: PluginDefinitions = { domains: [AnacondaAccount] };
