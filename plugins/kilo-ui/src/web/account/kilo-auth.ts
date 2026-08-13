/** Sentinel value for the personal (non-org) account in org selectors. */
export const PERSONAL_ORG_VALUE = "personal";

export const KILO_PROFILE_URL = "https://app.kilo.ai/profile";
export const KILO_CREDITS_URL = "https://app.kilo.ai/credits";
export const KILO_PASS_URL = "https://kilo.ai/pricing/kilo-pass";

export type KiloOrganization = {
	id: string;
	name: string;
	role: string;
};

export type KiloProfileData = {
	profile: {
		email: string;
		name?: string;
		organizations?: readonly KiloOrganization[];
		selectedOrganizationId?: string;
		hasPersonalAccount?: boolean;
	};
	balance: { balance: number } | null;
	kiloPass: {
		currentPeriodBaseCreditsUsd: number;
		currentPeriodUsageUsd: number;
		currentPeriodBonusCreditsUsd: number;
		nextBillingAt?: string | null;
	} | null;
	currentOrgId: string | null;
};

export type KiloAuthStatus = {
	authenticated: boolean;
	type?: "api" | "oauth";
};

export type DeviceAuthStatus = "idle" | "initiating" | "waiting" | "success" | "error";

export type DeviceAuthState = {
	status: DeviceAuthStatus;
	code?: string;
	verificationUrl?: string;
	expiresIn?: number;
	error?: string;
};

export type OrgOption = {
	value: string;
	label: string;
	description?: string;
};

/** Parse the user-enterable device code from OAuth authorize instructions. */
export function parseDeviceCode(instructions: string | undefined): string | undefined {
	if (!instructions) return undefined;
	const match = instructions.match(/code:\s*(\S+)/i);
	return match?.[1];
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
			description: org.role,
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
