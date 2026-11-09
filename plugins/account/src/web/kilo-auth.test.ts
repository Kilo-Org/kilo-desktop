import { describe, expect, it } from "vitest";

import {
	buildOrgOptions,
	errorMessage,
	formatBalance,
	formatPassShort,
	formatRenewalDate,
	initialsFor,
	isPersonalAccount,
	KILO_ACCOUNT_PATH,
	organizationIdFromValue,
	passUsagePercent,
	PERSONAL_ORG_VALUE,
	resolveCurrentOrgValue,
	startKiloDeviceAuth,
	type KiloProfileData,
} from "./kilo-auth";

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
