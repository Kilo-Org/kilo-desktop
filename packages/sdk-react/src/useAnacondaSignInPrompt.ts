import { useCallback, useEffect, useRef } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";

import { useAnacondaSignIn } from "./useAnacondaSignIn.js";
import { isAnacondaSignInGateForced } from "./forceAnacondaSignInGate.js";

export interface AnacondaSignInPrompt {
	pending: boolean;
	error: string | undefined;
	requireSignIn(): Promise<boolean>;
	cancel(): void;
	submit(): Promise<boolean>;
}

/**
 * Coordinates imperative feature/tool requests with the shared sign-in modal.
 * Concurrent requests share one prompt and all resume with the same outcome.
 */
export function useAnacondaSignInPrompt(
	sdk: Pick<SDK, "auth" | "telemetry" | "featureFlags">,
): AnacondaSignInPrompt {
	const { signingIn, error, signIn } = useAnacondaSignIn(sdk);
	const waiters = useRef(new Set<(authenticated: boolean) => void>());

	const settle = useCallback((result: boolean) => {
		for (const resolve of waiters.current) resolve(result);
		waiters.current.clear();
	}, []);

	const requireSignIn = useCallback((): Promise<boolean> => {
		if (!isAnacondaSignInGateForced(sdk) && sdk.auth.peek().status === "authenticated") {
			return Promise.resolve(true);
		}
		return new Promise<boolean>((resolve) => waiters.current.add(resolve));
	}, [sdk]);

	const cancel = useCallback(() => settle(false), [settle]);

	const submit = useCallback(async () => {
		const success = await signIn();
		if (success) settle(true);
		return success;
	}, [settle, signIn]);

	useEffect(() => () => settle(false), [settle]);

	return { pending: signingIn, error, requireSignIn, cancel, submit };
}
