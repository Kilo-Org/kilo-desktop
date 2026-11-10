/**
 * Settings > Account copy. Packaged e2e builds report a fixed signed-in Kilo account
 * (kilo.core's e2e identity) unless launched with `SIGNED_OUT_LAUNCH_ENV`; every e2e
 * profile's Kilo CLI itself has no credentials.
 */
export const accountData = {
	pageTitle: "Account",
	pageDescription: "See where you are signed in and manage your accounts.",
	accountsRegionLabel: "Accounts",
	kiloTitle: "Kilo",
	signedOutStatus: "Not signed in.",
	signedInStatus: "Signed in as e2e@kilo.dev",
	signInLabel: "Sign in",
	rowSummaryState: "summary",
	/** kilo.core reads the account through the Kilo server, whose cold start on CI can take over a minute. */
	settledTimeoutMs: 120_000,
} as const;

/** Launch env for a signed-out app: kilo.core reads the profile's real (empty) account. */
export const SIGNED_OUT_LAUNCH_ENV = { KILO_E2E_SIGNED_OUT: "1" };
