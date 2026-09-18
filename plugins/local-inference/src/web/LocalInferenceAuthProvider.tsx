import { useEffect, type ReactNode } from "react";

import { useAnacondaSignInPrompt, useSdk } from "@kilo-desktop/sdk-react";

import type { LocalInferenceAuthCapabilities } from "./auth-capabilities.js";

/** Owns sign-in UI for chat-triggered Local Model Server navigation. */
export function LocalInferenceAuthProvider({ children }: { readonly children: ReactNode }) {
	const sdk = useSdk("local-inference");
	const prompt = useAnacondaSignInPrompt(sdk);

	useEffect(() => {
		sdk.plugins.expose("authGate", {
			requireSignIn: prompt.requireSignIn,
			signIn: prompt.submit,
			cancel: prompt.cancel,
		} satisfies LocalInferenceAuthCapabilities["authGate"]);
	}, [prompt.cancel, prompt.requireSignIn, prompt.submit, sdk]);

	return children;
}
