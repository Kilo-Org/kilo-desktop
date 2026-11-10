import type { AccountInput } from "@kilo-desktop/kernel";

import type { AccountState } from "../../contracts";

export function isAnacondaEmployee(email: string): boolean {
	return email.split("@")[1]?.toLowerCase() === "anaconda.com";
}

/**
 * The signed-in Kilo account as the kernel's primary identity. The profile
 * has no separate user id, so the account is keyed on its email (as flags
 * and analytics always were). Like origin, the person's display name is
 * deliberately left out: flags and analytics get the email, the current
 * organisation and whether this is an Anaconda employee.
 */
export function kernelAccountFor(state: AccountState): AccountInput | null {
	const profile = state.signedIn ? state.profile : null;
	if (!profile) return null;
	const { email, organizations } = profile.profile;
	const organization = organizations?.find((org) => org.id === profile.currentOrgId);
	return {
		id: email,
		email,
		...(organization ? { organization: { id: organization.id, name: organization.name } } : {}),
		attributes: { isEmployee: isAnacondaEmployee(email) },
	};
}
