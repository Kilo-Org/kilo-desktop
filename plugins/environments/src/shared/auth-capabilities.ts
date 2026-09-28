/**
 * Require an Anaconda API key before running a channel-backed conda tool.
 *
 * The key comes from the credential store (`auth` capability → keyring), not a
 * login session — a user with a stored key (from a prior Anaconda install or a
 * config-supplied key) passes without any in-app sign-in. With no key, the tool
 * fails fast with a clear error instead of a network 401.
 *
 * Structural mirror of `AuthMainCapability` from `@kilo-desktop/contracts`
 * (kept local — this plugin does not depend on contracts directly).
 */
interface AuthCapability extends Record<string, unknown> {
	session: {
		getApiKey(): Promise<string | null>;
		getSiteDomain(): Promise<string>;
	};
}

export async function requireEnvironmentApiKey(sdk: {
	plugins: { get<T extends Record<string, unknown>>(featureId: string): T | null };
}): Promise<void> {
	const apiKey = await sdk.plugins.get<AuthCapability>("auth")?.session.getApiKey();
	if (!apiKey) {
		throw new Error(
			"An Anaconda API key is required to use channels. Add one to your conda config or keyring.",
		);
	}
}
