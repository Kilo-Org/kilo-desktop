import { describe, expect, it } from "vitest";

import {
	buildOrgOptions,
	errorMessage,
	formatBalance,
	formatPassShort,
	formatRenewalDate,
	initialsFor,
	displayChatError,
	isKiloSignInError,
	isPersonalAccount,
	KILO_ACCOUNT_PATH,
	needsKiloSignIn,
	offerKiloSignIn,
	organizationIdFromValue,
	parseDeviceCode,
	passUsagePercent,
	PERSONAL_ORG_VALUE,
	resolveCurrentOrgValue,
	startKiloDeviceAuth,
	type KiloProfileData,
} from "./kilo-auth.js";

const baseProfile = (overrides: Partial<KiloProfileData> = {}): KiloProfileData => ({
	profile: {
		email: "user@example.com",
		name: "User",
		organizations: [
			{ id: "org-1", name: "Acme", role: "admin" },
			{ id: "org-2", name: "Beta", role: "member" },
		],
		hasPersonalAccount: true,
	},
	balance: { balance: 12.5 },
	kiloPass: {
		currentPeriodBaseCreditsUsd: 20,
		currentPeriodUsageUsd: 5,
		currentPeriodBonusCreditsUsd: 1,
		nextBillingAt: "2026-09-01T00:00:00.000Z",
	},
	currentOrgId: null,
	...overrides,
});

describe("parseDeviceCode", () => {
	it("extracts the code from authorize instructions", () => {
		expect(parseDeviceCode("Open URL and enter code: ABCD-1234")).toBe("ABCD-1234");
		expect(parseDeviceCode("CODE: xyz")).toBe("xyz");
	});

	it("returns undefined when instructions lack a code", () => {
		expect(parseDeviceCode(undefined)).toBeUndefined();
		expect(parseDeviceCode("Open the URL")).toBeUndefined();
	});
});

describe("org helpers", () => {
	it("builds personal + org options", () => {
		const options = buildOrgOptions(baseProfile().profile);
		expect(options).toEqual([
			{ value: PERSONAL_ORG_VALUE, label: "Personal" },
			{ value: "org-1", label: "Acme", description: "Admin" },
			{ value: "org-2", label: "Beta", description: "Member" },
		]);
	});

	it("omits personal when hasPersonalAccount is false", () => {
		const options = buildOrgOptions({
			...baseProfile().profile,
			hasPersonalAccount: false,
		});
		expect(options.map((o) => o.value)).toEqual(["org-1", "org-2"]);
	});

	it("returns no options when there are no organizations", () => {
		expect(buildOrgOptions({ email: "a@b.c", organizations: [] })).toEqual([]);
	});

	it("resolves the current org value", () => {
		const profile = baseProfile({ currentOrgId: "org-2" });
		const options = buildOrgOptions(profile.profile);
		expect(resolveCurrentOrgValue(profile, options)).toBe("org-2");
		expect(resolveCurrentOrgValue(baseProfile(), options)).toBe(PERSONAL_ORG_VALUE);
	});

	it("maps selector values to organization ids", () => {
		expect(organizationIdFromValue(PERSONAL_ORG_VALUE)).toBeNull();
		expect(organizationIdFromValue("org-1")).toBe("org-1");
	});

	it("detects the personal account", () => {
		expect(isPersonalAccount(baseProfile())).toBe(true);
		expect(isPersonalAccount(baseProfile({ currentOrgId: "org-1" }))).toBe(false);
	});
});

describe("balance and pass formatting", () => {
	it("formats currency helpers", () => {
		expect(formatBalance(12.5)).toBe("$12.50");
		expect(formatPassShort(12.4)).toBe("$12");
	});

	it("clamps pass usage percent", () => {
		expect(passUsagePercent(5, 20)).toBe(25);
		expect(passUsagePercent(50, 20)).toBe(100);
		expect(passUsagePercent(1, 0)).toBe(100);
	});

	it("derives avatar initials", () => {
		expect(initialsFor("Dev User", "dev@anaconda.com")).toBe("DU");
		expect(initialsFor(" Madonna ", "m@example.com")).toBe("MA");
		expect(initialsFor(undefined, "dev@anaconda.com")).toBe("DE");
	});

	it("formats the pass renewal date", () => {
		expect(formatRenewalDate("2026-09-01T00:00:00.000Z")).toMatch(/Sep 1|1 Sep/);
		expect(formatRenewalDate("not-a-date")).toBe("");
	});
});

describe("errorMessage", () => {
	it("prefers Error messages and string throws", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
		expect(errorMessage("nope")).toBe("nope");
		expect(errorMessage(null, "fallback")).toBe("fallback");
	});
});

describe("startKiloDeviceAuth", () => {
	it("starts login then opens the account settings page", () => {
		const calls: string[] = [];
		startKiloDeviceAuth(
			() => {
				calls.push("login");
			},
			(path) => {
				calls.push(path);
			},
		);
		expect(calls).toEqual(["login", KILO_ACCOUNT_PATH]);
	});
});

describe("needsKiloSignIn", () => {
	const signedOut = {
		connectionUnavailable: false,
		isLoading: false,
		authenticated: false as boolean | null,
		deviceAuth: { status: "idle" as const },
	};

	it("is true only when Gateway credentials are missing and idle", () => {
		expect(needsKiloSignIn(signedOut)).toBe(true);
	});

	it("is false while loading, unavailable, authenticated, or in a device-auth flow", () => {
		expect(needsKiloSignIn({ ...signedOut, isLoading: true })).toBe(false);
		expect(needsKiloSignIn({ ...signedOut, connectionUnavailable: true })).toBe(false);
		expect(needsKiloSignIn({ ...signedOut, authenticated: true })).toBe(false);
		expect(needsKiloSignIn({ ...signedOut, authenticated: null })).toBe(false);
		expect(needsKiloSignIn({ ...signedOut, deviceAuth: { status: "waiting" } })).toBe(false);
	});
});

describe("offerKiloSignIn", () => {
	it("is true only for a Kilo model while signed out", () => {
		expect(offerKiloSignIn({ authenticated: false, connectionUnavailable: false }, true)).toBe(
			true,
		);
		expect(offerKiloSignIn({ authenticated: false, connectionUnavailable: false }, false)).toBe(
			false,
		);
		expect(offerKiloSignIn({ authenticated: true, connectionUnavailable: false }, true)).toBe(
			false,
		);
		expect(offerKiloSignIn({ authenticated: false, connectionUnavailable: true }, true)).toBe(
			false,
		);
		expect(offerKiloSignIn({ authenticated: null, connectionUnavailable: false }, true)).toBe(
			false,
		);
	});
});

const gatewayAuthDump =
	'Unauthorized: {"error":{"code":"PAID_MODEL_AUTH_REQUIRED","message":"You need to sign in to use this model."},"error_type":"paid_model_auth_required"}';

describe("isKiloSignInError", () => {
	it("matches Gateway sign-in and sign-up errors", () => {
		expect(isKiloSignInError("You need to sign in to use this model")).toBe(true);
		expect(isKiloSignInError("You need to sign up to keep going")).toBe(true);
		expect(isKiloSignInError("APIError PAID_MODEL_AUTH_REQUIRED")).toBe(true);
		expect(isKiloSignInError("PROMOTION_MODEL_LIMIT_REACHED")).toBe(true);
		expect(isKiloSignInError(gatewayAuthDump)).toBe(true);
		expect(isKiloSignInError("Provider rate limit exceeded")).toBe(false);
		expect(isKiloSignInError(undefined)).toBe(false);
	});
});

describe("displayChatError", () => {
	it("unwraps Gateway JSON dumps into tidy titles", () => {
		expect(displayChatError(gatewayAuthDump)).toBe("You need to connect to Kilo to use this model");
		expect(
			displayChatError(
				'Unauthorized: {"error":{"code":"PROMOTION_MODEL_LIMIT_REACHED","message":"limit"}}',
			),
		).toBe("You need to sign up for Kilo to keep going");
	});

	it("keeps already-tidy titles and unwraps other JSON messages", () => {
		expect(displayChatError("You need to sign in to use this model")).toBe(
			"You need to connect to Kilo to use this model",
		);
		expect(
			displayChatError('Unauthorized: {"error":{"message":"Provider rate limit exceeded"}}'),
		).toBe("Provider rate limit exceeded");
		expect(displayChatError("Provider rate limit exceeded")).toBe("Provider rate limit exceeded");
		expect(displayChatError(undefined)).toBe("");
	});
});
