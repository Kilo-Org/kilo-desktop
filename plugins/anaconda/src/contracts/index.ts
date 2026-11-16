import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.anaconda's public surface: the Anaconda account, a credential source
 * for features that call Anaconda services (its own model catalog for the
 * Local Model Server). It is not the app's identity — that is the Kilo
 * account (kilo.core); the Anaconda account is a linked account. The API key
 * lives in the Anaconda keyring shared with the Anaconda CLI and conda, and
 * only the plugins allowed to read it get it, from main.
 */
export const ANACONDA_PLUGIN_ID = "kilo.anaconda";

/** Plugins whose calls to `apiKey()` are answered; everyone else gets PERMISSION_DENIED. */
export const ANACONDA_API_KEY_READERS: readonly string[] = [ANACONDA_PLUGIN_ID];

/** True while an Anaconda account is signed in, once its session has been resolved. */
export const ANACONDA_SIGNED_IN_KEY = "kilo.anaconda/anacondaSignedIn";

/** The `kernel/linked-account` and `kilo.shell/account-panel` contribution ids. */
export const ANACONDA_LINKED_ACCOUNT = "anaconda";
export const ANACONDA_ACCOUNT_PANEL = "anaconda";

/** The `kilo.local-inference/model-catalog` contribution: Anaconda's model catalog. */
export const ANACONDA_MODEL_CATALOG = "anaconda-models";

/** The flag the account panel is behind (kilo.local-inference's, as origin). */
export const LOCAL_MODEL_CATALOG_FLAG = "local-model-catalog";

/** Declared `kernel/telemetry-event` ids; the kernel sends origin's names. */
export const ANACONDA_TELEMETRY_EVENTS = {
	loggedIn: "anaconda-logged-in",
	loggedOut: "anaconda-logged-out",
} as const;

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
export const AnacondaAccount = defineDomainObject({
	id: "kilo.anaconda/account",
	home: "main",
	description: "The Anaconda account: its session, the browser sign-in and the stored API key.",
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
		/**
		 * The stored API key, or null. Only for {@link ANACONDA_API_KEY_READERS}
		 * calling from main (checked per call: the rest of this domain object is
		 * called from windows, so it can't be `homeCallersOnly`).
		 */
		apiKey: method(nothing, z.string().nullable()),
		/** The Anaconda site the key belongs to (e.g. `anaconda.com`). */
		siteDomain: method(nothing, z.string()),
	},
	events: {
		/** The session or the stored key changed, e.g. a key rotated without a new session. */
		changed: z.object({}),
	},
});

export const ANACONDA_DEFINITIONS: PluginDefinitions = { domainObjects: [AnacondaAccount] };
