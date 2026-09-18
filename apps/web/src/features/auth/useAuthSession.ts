import { useSyncExternalStore } from "react";

import type { AuthSession } from "@kilo-desktop/feature-sdk";

import { useSdk } from "@kilo-desktop/sdk-react";

/**
 * Read the current Anaconda session, re-rendering on transitions.
 *
 * Backed by `sdk.auth` (a shell delegate). Resolves lazily on first use; a
 * logged-in user may briefly see `{ status: "anonymous" }` before the first
 * async resolution lands.
 */
export function useAuthSession(): AuthSession {
	const sdk = useSdk("auth");
	return useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
}
