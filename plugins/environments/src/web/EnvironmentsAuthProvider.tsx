import { useEffect, type ReactNode } from "react";

import { useAnacondaSignInPrompt, useSdk } from "@kilo-desktop/sdk-react";

import type { EnvironmentsAuthCapabilities } from "../shared/auth-capabilities.js";

/**
 * Owns the app-lifetime sign-in prompt used by model-facing environment tools.
 * Tool handlers can pause on the exposed capability while this provider owns
 * React state and renders the shared Anaconda dialog above any current page.
 */
export function EnvironmentsAuthProvider({ children }: { readonly children: ReactNode }) {
	const sdk = useSdk("environments");
	const prompt = useAnacondaSignInPrompt(sdk);

	useEffect(() => {
		sdk.plugins.expose("authGate", {
			requireSignIn: prompt.requireSignIn,
			signIn: prompt.submit,
			cancel: prompt.cancel,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
	}, [prompt.cancel, prompt.requireSignIn, prompt.submit, sdk]);

	return children;
}
