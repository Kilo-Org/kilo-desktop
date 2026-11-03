import type { DeviceAuthState, KiloProfileData } from "../contracts";

/** Sentinel value for the personal (non-org) account in org selectors. */
export const PERSONAL_ORG_VALUE = "personal";

export const KILO_PROFILE_URL = "https://app.kilo.ai/profile";
export const KILO_CREDITS_URL = "https://app.kilo.ai/credits";
export const KILO_PASS_URL = "https://kilo.ai/pricing/kilo-pass";
export { KILO_TERMS_URL } from "../contracts";
/** In-app settings section that hosts the Kilo Gateway account panel. */
export const KILO_ACCOUNT_PATH = "/settings/account";

/** Start device OAuth and open Account settings so the user sees the Kilo panel. */
export function startKiloDeviceAuth(login: () => void, navigate: (path: string) => void): void {
	login();
	navigate(KILO_ACCOUNT_PATH);
}

export type { DeviceAuthState, KiloOrganization, KiloProfileData } from "../contracts";

export type DeviceAuthStatus = DeviceAuthState["status"];

export type OrgOption = {
	value: string;
	label: string;
	description?: string;
};

function formatOrganizationRole(role: string): string {
	return role
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
		.join(" ");
}

export function formatBalance(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

export function formatPassShort(amount: number): string {
	return `$${Math.round(amount)}`;
}

/** Clamp pass usage to a 0–100 progress percentage. */
export function passUsagePercent(usageUsd: number, baseCreditsUsd: number): number {
	const base = Math.max(1, baseCreditsUsd);
	return Math.min(100, (usageUsd / base) * 100);
}

/** Two-letter avatar initials from a display name, falling back to the email. */
export function initialsFor(name: string | undefined, email: string): string {
	const source = name?.trim() || email;
	const parts = source.split(/\s+/).filter(Boolean);
	const first = parts[0];
	const last = parts[parts.length - 1];
	if (first && last && parts.length >= 2) {
		return `${first[0]}${last[0]}`.toUpperCase();
	}
	return source.slice(0, 2).toUpperCase();
}

/** Short renewal date ("Sep 1") for the Kilo Pass usage row. UTC keeps the ISO date part stable. */
export function formatRenewalDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function buildOrgOptions(
	profile: KiloProfileData["profile"],
	personalLabel = "Personal",
): OrgOption[] {
	const orgs = profile.organizations ?? [];
	if (orgs.length === 0) return [];
	const personal = profile.hasPersonalAccount !== false;
	return [
		...(personal ? [{ value: PERSONAL_ORG_VALUE, label: personalLabel }] : []),
		...orgs.map((org) => ({
			value: org.id,
			label: org.name,
			description: formatOrganizationRole(org.role),
		})),
	];
}

export function resolveCurrentOrgValue(
	profile: KiloProfileData,
	options: readonly OrgOption[],
): string | undefined {
	if (profile.currentOrgId) return profile.currentOrgId;
	if (profile.profile.hasPersonalAccount !== false) return PERSONAL_ORG_VALUE;
	return options[0]?.value;
}

export function organizationIdFromValue(value: string): string | null {
	return value === PERSONAL_ORG_VALUE ? null : value;
}

export function isPersonalAccount(profile: KiloProfileData): boolean {
	return (profile.currentOrgId ?? null) === null && profile.profile.hasPersonalAccount !== false;
}

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}
