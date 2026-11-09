import type { IdentityState } from "@kilo-desktop/plugin-account/contracts";

import type { FeatureFlagContext } from "./types";

export const ANONYMOUS_CONTEXT: FeatureFlagContext = { isEmployee: false };

export function isAnacondaEmployee(email: string | undefined): boolean {
	return email?.split("@")[1]?.toLowerCase() === "anaconda.com";
}

/**
 * The LaunchDarkly context for the signed-in Kilo account. The profile has no
 * separate user id, so the context is keyed on email — otherwise every
 * signed-in user collapses into "anonymous" and per-user targeting breaks.
 * Like origin, only the email, that key and the organization are sent; the
 * person's display name is not.
 */
export function contextFor(identity: IdentityState | undefined): FeatureFlagContext {
	const profile = identity?.authenticated ? identity.profile : null;
	if (!profile) return ANONYMOUS_CONTEXT;
	const { email, organizations } = profile.profile;
	const organization = organizations?.find((org) => org.id === profile.currentOrgId);
	return {
		isEmployee: isAnacondaEmployee(email),
		email,
		userId: email,
		...(organization ? { organization: { id: organization.id, name: organization.name } } : {}),
	};
}
