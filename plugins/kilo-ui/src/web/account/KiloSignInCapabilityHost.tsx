import { useContext, useEffect, useRef } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { KiloAuthContext } from "./KiloAuthContext.js";

/**
 * Structural shape other plugins resolve via `sdk.plugins.get("kilo-ui").signIn`.
 * Lets gated pages trigger the Kilo device-auth flow from their own surface.
 */
export interface KiloSignInCapability extends Record<string, unknown> {
	signIn: {
		/** Start (or no-op if already in flight) the Kilo device-auth flow. */
		signIn(): Promise<boolean>;
	};
}

/**
 * Exposes kilo-ui's `signIn` capability so gated plugins (environments,
 * local-inference) can trigger Kilo sign-in from their gate surface. Mounts
 * alongside KiloAuthProvider (which owns the login state machine); registers
 * on mount and unregisters on unmount. Renders nothing.
 */
export function KiloSignInCapabilityHost() {
	const sdk = useSdk("kilo-ui");
	const auth = useContext(KiloAuthContext);

	// The in-flight signIn() call: its promise, its settle fn, and whether the
	// device flow has actually begun (left "idle") during this call. Settling
	// reacts to the auth context (a fresh value each render, so transitions are
	// visible) rather than a stale closure.
	const inFlight = useRef<{
		promise: Promise<boolean>;
		resolve(ok: boolean): void;
		began: boolean;
	} | null>(null);

	// Settle the in-flight signIn() when the device flow lands: success when the
	// session flips to authenticated; failure when it errors, or returns to idle
	// after having started (a cancel). Watching `began` (not the start snapshot)
	// means a stale "error"/"idle" left over from a *previous* attempt can't
	// settle this one — only a transition observed after this flow began does.
	useEffect(() => {
		const entry = inFlight.current;
		if (!auth || !entry) return;
		const status = auth.deviceAuth.status;
		if (status === "initiating" || status === "waiting" || status === "finishing") {
			entry.began = true;
			return;
		}
		if (auth.authenticated === true) {
			entry.resolve(true);
			inFlight.current = null;
		} else if (entry.began && (status === "error" || status === "idle")) {
			entry.resolve(false);
			inFlight.current = null;
		}
	}, [auth]);

	useEffect(() => {
		if (!auth) return;
		// expose auto-unregisters when this scope disposes.
		sdk.plugins.expose("signIn", {
			signIn: () => {
				if (inFlight.current) return inFlight.current.promise;
				// login() silently no-ops while the chat connection can't start a flow
				// (pending boot/reconnect, or failed) — the device flow would never
				// start, so the promise would hang and wedge the capability (every
				// later call returns the same never-settling promise). canSignIn mirrors
				// login()'s own !client/!directory guard; settle false immediately so
				// the caller can surface it / retry once the connection is ready.
				if (auth.canSignIn === false) return Promise.resolve(false);
				// login() is fire-and-forget (browser open + oauth.callback poll). The
				// settle happens in the auth-context effect above — success on a fresh
				// authenticated session, failure on a deviceAuth error/cancel after the
				// flow began — so nothing here awaits a point-in-time read.
				auth.login();
				let resolve!: (ok: boolean) => void;
				const promise = new Promise<boolean>((res) => {
					resolve = res;
				});
				inFlight.current = { promise, resolve, began: false };
				return promise;
			},
		} satisfies KiloSignInCapability["signIn"]);
	}, [sdk, auth]);

	return null;
}
