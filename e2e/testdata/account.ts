/**
 * Settings > Account copy. Every e2e profile has an empty Kilo CLI profile, so the Account page
 * always settles signed out — even in the build-time signed-in app, whose test identity only
 * satisfies `KiloAuthGate`.
 */
export const accountData = {
	pageTitle: "Account",
	pageDescription: "See where you are signed in and manage your accounts.",
	accountsRegionLabel: "Accounts",
	kiloTitle: "Kilo",
	signedOutStatus: "Not signed in.",
	signInLabel: "Sign in",
	pageReadyState: "ready",
	rowSummaryState: "summary",
} as const;
