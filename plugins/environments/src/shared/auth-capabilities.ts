export interface EnvironmentsAuthCapabilities extends Record<string, unknown> {
	authGate: {
		requireSignIn(): Promise<boolean>;
		signIn(): Promise<boolean>;
		cancel(): void;
	};
}

// TEMPORARY test flag, mirroring FORCE_ANACONDA_SIGN_IN_GATE_FLAG in
// sdk-react — this module is main-bundle-reachable, so it cannot import
// sdk-react. Remove both once the inline sign-in experience ships.
const FORCE_SIGN_IN_GATE_FLAG = "force-anaconda-sign-in-gate";

export async function requireEnvironmentToolSignIn(sdk: {
	auth: { peek(): { status: string } };
	featureFlags: { peek(): Record<string, unknown> };
	plugins: { get<T extends Record<string, unknown>>(featureId: string): T | null };
}): Promise<void> {
	if (
		sdk.featureFlags.peek()[FORCE_SIGN_IN_GATE_FLAG] !== true &&
		sdk.auth.peek().status === "authenticated"
	) {
		return;
	}
	const authenticated = await sdk.plugins
		.get<EnvironmentsAuthCapabilities>("environments")
		?.authGate.requireSignIn();
	if (!authenticated) throw new Error("Anaconda sign-in is required to use channels from chat.");
}
