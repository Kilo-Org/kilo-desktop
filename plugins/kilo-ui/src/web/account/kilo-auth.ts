/** Sentinel value for the personal (non-org) account in org selectors. */
export const PERSONAL_ORG_VALUE = "personal";

export const KILO_PROFILE_URL = "https://app.kilo.ai/profile";
export const KILO_CREDITS_URL = "https://app.kilo.ai/credits";
export const KILO_PASS_URL = "https://kilo.ai/pricing/kilo-pass";
/** In-app settings section that hosts the Kilo Gateway account panel. */
export const KILO_ACCOUNT_PATH = "/settings/kilo-providers";

/** Start device OAuth and open AI Providers so the user sees the Kilo panel. */
export function startKiloDeviceAuth(login: () => void, navigate: (path: string) => void): void {
	login();
	navigate(KILO_ACCOUNT_PATH);
}

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

export type KiloOrgError = {
	message: string;
	organizationId: string | null;
};

export type KiloAuthStatus = {
	authenticated: boolean;
	type?: "api" | "oauth";
};

export type DeviceAuthStatus = "idle" | "initiating" | "waiting" | "finishing" | "error";

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

/** True when Gateway credentials are missing and the UI should prompt sign-in. */
export function needsKiloSignIn(auth: {
	connectionUnavailable: boolean;
	isLoading: boolean;
	authenticated: boolean | null;
	deviceAuth: Pick<DeviceAuthState, "status">;
}): boolean {
	return (
		!auth.connectionUnavailable &&
		!auth.isLoading &&
		auth.authenticated === false &&
		auth.deviceAuth.status === "idle"
	);
}

/** True when a Kilo Gateway model error can be resolved by signing in. */
export function offerKiloSignIn(
	auth: {
		authenticated: boolean | null;
		connectionUnavailable: boolean;
	},
	isKiloModel: boolean,
): boolean {
	return isKiloModel && !auth.connectionUnavailable && auth.authenticated === false;
}

const KILO_SIGN_IN_ERROR = "You need to sign in to use this model";
const KILO_SIGN_UP_ERROR = "You need to sign up to keep going";
const KILO_SIGN_IN_TITLE = "You need to connect to Kilo to use this model";
const KILO_SIGN_UP_TITLE = "You need to sign up for Kilo to keep going";

const KILO_ERROR_TITLES: Record<string, string> = {
	PAID_MODEL_AUTH_REQUIRED: KILO_SIGN_IN_TITLE,
	PROMOTION_MODEL_LIMIT_REACHED: KILO_SIGN_UP_TITLE,
	paid_model_auth_required: KILO_SIGN_IN_TITLE,
	promotion_model_limit_reached: KILO_SIGN_UP_TITLE,
};

function parseEmbeddedJson(message: string): Record<string, unknown> | undefined {
	const start = message.indexOf("{");
	const end = message.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		const parsed: unknown = JSON.parse(message.slice(start, end + 1));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function nestedError(body: Record<string, unknown>): Record<string, unknown> | undefined {
	const error = body.error;
	if (error && typeof error === "object" && !Array.isArray(error)) {
		return error as Record<string, unknown>;
	}
	return undefined;
}

function kiloErrorTitle(message: string): string | undefined {
	const body = parseEmbeddedJson(message);
	const nested = body ? nestedError(body) : undefined;
	const code = nested?.code ?? body?.code ?? body?.error_type;
	if (typeof code === "string" && KILO_ERROR_TITLES[code]) {
		return KILO_ERROR_TITLES[code];
	}
	if (
		message.includes("PROMOTION_MODEL_LIMIT_REACHED") ||
		message.includes(KILO_SIGN_UP_ERROR) ||
		message.includes(KILO_SIGN_UP_TITLE)
	) {
		return KILO_SIGN_UP_TITLE;
	}
	if (
		message.includes("PAID_MODEL_AUTH_REQUIRED") ||
		message.includes(KILO_SIGN_IN_ERROR) ||
		message.includes(KILO_SIGN_IN_TITLE)
	) {
		return KILO_SIGN_IN_TITLE;
	}
	return undefined;
}

function unwrapEmbeddedErrorMessage(message: string): string | undefined {
	const body = parseEmbeddedJson(message);
	if (!body) return undefined;
	const nested = nestedError(body);
	if (typeof nested?.message === "string" && nested.message.trim()) return nested.message;
	if (typeof body.message === "string" && body.message.trim()) return body.message;
	return undefined;
}

/** True when the assistant error is Kilo Gateway asking the user to sign in. */
export function isKiloSignInError(message: string | undefined): boolean {
	return kiloErrorTitle(message ?? "") !== undefined;
}

/** User-facing chat error text. Unwraps Gateway JSON dumps into tidy titles. */
export function displayChatError(message: string | undefined): string {
	if (!message) return "";
	return kiloErrorTitle(message) ?? unwrapEmbeddedErrorMessage(message) ?? message;
}
