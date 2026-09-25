import { useCallback, useSyncExternalStore, useState } from "react";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";

export interface AnacondaSignIn {
	/** Latest auth session; resolves lazily so anonymous may briefly show first. */
	session: AuthSession;
	/** True when `session.status` is `"authenticated"`. */
	authenticated: boolean;
	/** True while the OAuth login round-trip is in flight. */
	signingIn: boolean;
	/** Reason string from a failed login attempt, cleared on retry. */
	error: string | undefined;
	/**
	 * Run the Anaconda OAuth login. Resolves `true` only when the session
	 * ended up authenticated; failures populate `error` instead of throwing.
	 */
	signIn(): Promise<boolean>;
}

/**
 * Drive the Anaconda sign-in flow for a feature renderer. Reads the auth
 * session delegate off the feature's own SDK (`sdk.auth`) so the component
 * re-renders when the OAuth loopback completes, and tracks the `Logged In`
 * telemetry event on success.
 */
export function useAnacondaSignIn(sdk: Pick<SDK, "auth" | "telemetry">): AnacondaSignIn {
	const session = useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
	const [signingIn, setSigningIn] = useState(false);
	const [error, setError] = useState<string>();

	const signIn = useCallback(async (): Promise<boolean> => {
		setError(undefined);
		setSigningIn(true);
		try {
			const next = await sdk.auth.login();
			if (next.status === "error") {
				setError(next.reason);
				return false;
			}
			if (next.status === "authenticated") {
				void sdk.telemetry.track({ event: "Logged In" });
				return true;
			}
			return false;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		} finally {
			setSigningIn(false);
		}
	}, [sdk]);

	return { session, authenticated: session.status === "authenticated", signingIn, error, signIn };
}
