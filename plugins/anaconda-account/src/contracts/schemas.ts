import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const ANACONDA_ACCOUNT_FEATURE_ID = "anaconda-account";

/** Event (`anaconda-account.changed`) emitted with the new session after any transition. */
export const ANACONDA_ACCOUNT_CHANGED_EVENT = "changed";

export const anacondaAccountUserSchema = z.object({
	userId: z.string().optional(),
	username: z.string().optional(),
	email: z.string().optional(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
});

/**
 * The Anaconda account state. `authenticated` means a valid Anaconda API key is
 * stored (however it got there); `anonymous` means no usable key; `error` is a
 * failed resolve or sign-in/out, with a user-facing reason.
 */
export const anacondaAccountSessionSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("anonymous") }),
	z.object({ status: z.literal("authenticated"), user: anacondaAccountUserSchema }),
	z.object({ status: z.literal("error"), reason: z.string() }),
]);

export type AnacondaAccountUser = z.infer<typeof anacondaAccountUserSchema>;
export type AnacondaAccountSession = z.infer<typeof anacondaAccountSessionSchema>;

export const anacondaAccountContract = defineContract({
	"session.get": defineMethod(z.undefined(), anacondaAccountSessionSchema),
	"session.refresh": defineMethod(z.undefined(), anacondaAccountSessionSchema),
	login: defineMethod(z.undefined(), anacondaAccountSessionSchema),
	"login.cancel": defineMethod(z.undefined(), z.undefined()),
	logout: defineMethod(z.undefined(), anacondaAccountSessionSchema),
});

export type AnacondaAccountService = InferContract<typeof anacondaAccountContract>;

/** `cancelled` marks a sign-in the user cancelled — not an error worth reporting. */
export type AnacondaAccountResult =
	| { ok: true }
	| { ok: false; reason: string; cancelled?: boolean };

/**
 * Renderer capability other plugins resolve with
 * `sdk.plugins.get<AnacondaAccountCapabilities>("anaconda-account")?.account`.
 * Consumers import these types from `@kilo-desktop/plugin-anaconda-account/contracts`
 * (type-only, so there is no runtime dependency) and must treat a `null`
 * lookup as "Anaconda sign-in unavailable".
 */
export interface AnacondaAccountCapabilities extends Record<string, unknown> {
	account: AnacondaAccountCapability;
}

// A type alias (not an interface) so it is assignable to the
// `Record<string, unknown>` that `sdk.plugins.expose` accepts.
export type AnacondaAccountCapability = {
	/** Subscribe to session changes; fires synchronously with the current value. */
	subscribe(listener: (session: AnacondaAccountSession) => void): () => void;
	/** The cached session (referentially stable between changes). */
	peek(): AnacondaAccountSession;
	/** Resolve the session (cached in main after the first resolve). */
	getSession(): Promise<AnacondaAccountSession>;
	/** Re-check the stored key (picks up keys added/removed by other tools). */
	refresh(): Promise<AnacondaAccountSession>;
	/**
	 * Run the browser sign-in that stores an Anaconda API key. While one is
	 * pending, calling it again reopens the authorization page. Never throws.
	 */
	signIn(): Promise<AnacondaAccountResult>;
	/** Cancel a pending sign-in; its `signIn()` resolves with `cancelled: true`. */
	cancelSignIn(): Promise<void>;
	/** Delete the stored Anaconda API key. Never throws. */
	signOut(): Promise<AnacondaAccountResult>;
};
