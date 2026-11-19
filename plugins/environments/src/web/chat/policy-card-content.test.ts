import { describe, expect, it } from "vitest";

import type { PolicyBlockedPackage } from "../../contracts/common";
import type { FriendlyEnvironmentsError } from "../providers/conda/environments-error-message";
import { channelLabel, plainText, policyCardContent } from "./policy-card-content";

const entry = (overrides: Partial<PolicyBlockedPackage> = {}): PolicyBlockedPackage => ({
	package: "pillow",
	version: "8.4.0",
	channel: "defaults",
	org: "acme",
	policy: "organization_policy",
	policyId: null,
	reason: "CVE score of 9.1 is greater than 9",
	...overrides,
});

const blocked = (
	entries: PolicyBlockedPackage[],
	message = "summary",
): FriendlyEnvironmentsError => ({
	code: "POLICY_BLOCKED",
	message,
	policy: { blocked: entries },
});

describe("policyCardContent", () => {
	it("leads a single block with the package, then who blocked it and why", () => {
		const content = policyCardContent(blocked([entry()]));

		expect(content).toEqual({
			kind: "blocked",
			headline: [{ text: "pillow 8.4.0", code: true }, { text: " is blocked" }],
			by: { org: "acme", policy: "organization_policy" },
			rows: [
				{
					key: "pillow@8.4.0#0",
					label: "pillow 8.4.0",
					reason: "CVE score of 9.1 is greater than 9",
					org: null,
					policy: null,
				},
			],
			nextStep:
				"Ask your organization's administrator for an exception, or use a version the policy allows.",
		});
		expect(plainText(content!.headline)).toBe("pillow 8.4.0 is blocked");
	});

	it("names only the package without a version, and keeps the unknown fields null", () => {
		const content = policyCardContent(
			blocked([entry({ version: null, org: null, policy: null, reason: null })]),
		);

		expect(content).toMatchObject({
			headline: [{ text: "pillow", code: true }, { text: " is blocked" }],
			by: { org: null, policy: null },
			rows: [{ label: "pillow", reason: null, org: null, policy: null }],
		});
	});

	it("counts several blocks and puts a shared org and policy in the subline only", () => {
		const content = policyCardContent(
			blocked([entry(), entry({ package: "numpy", version: "1.0" }), entry({ package: "scipy" })]),
		);

		expect(content).toMatchObject({
			headline: [{ text: "3 packages are blocked" }],
			by: { org: "acme", policy: "organization_policy" },
			rows: [
				{ label: "pillow 8.4.0", org: null, policy: null },
				{ label: "numpy 1.0", org: null, policy: null },
				{ label: "scipy 8.4.0", org: null, policy: null },
			],
			nextStep:
				"Ask your organization's administrator for an exception, or use versions the policy allows.",
		});
	});

	it("moves what the blocks do not share from the subline to each row", () => {
		const content = policyCardContent(
			blocked([
				entry(),
				entry({ package: "numpy", policy: "strict_policy" }),
				entry({ package: "scipy", policy: null }),
			]),
		);

		expect(content).toMatchObject({
			by: { org: "acme", policy: null },
			rows: [
				{ label: "pillow 8.4.0", org: null, policy: "organization_policy" },
				{ label: "numpy 8.4.0", org: null, policy: "strict_policy" },
				{ label: "scipy 8.4.0", org: null, policy: null },
			],
		});

		const mixedOrgs = policyCardContent(
			blocked([entry(), entry({ package: "numpy", org: "globex" }), entry({ org: null })]),
		);
		expect(mixedOrgs).toMatchObject({
			by: { org: null, policy: null },
			rows: [
				{ org: "acme", policy: "organization_policy" },
				{ org: "globex", policy: "organization_policy" },
				{ org: null, policy: "organization_policy" },
			],
		});
	});

	it("falls back to the bridge's summary when a block carries no packages", () => {
		const content = policyCardContent(
			blocked([], "pillow 8.4.0 is blocked by organization_policy"),
		);

		expect(content).toMatchObject({
			kind: "blocked",
			headline: [{ text: "Blocked by your organization's package policy" }],
			rows: [],
			summary: "pillow 8.4.0 is blocked by organization_policy",
		});
		expect(content).not.toHaveProperty("by");
	});

	it("explains a solve failure the policy may be behind", () => {
		expect(
			policyCardContent({ code: "SOLVE_FAILED", message: "m", policy: { policyNote: true } }),
		).toEqual({
			kind: "policy-note",
			headline: [{ text: "Couldn't resolve the packages" }],
			subline: "Your organization's package policy may have removed a dependency.",
			nextStep: "Ask your organization's administrator, or try different versions.",
		});
	});

	it("asks to sign in, naming the refused channel when known", () => {
		expect(
			policyCardContent({
				code: "NOT_SIGNED_IN",
				message: "m",
				policy: { refused: { org: null, channel: "https://repo.anaconda.cloud/repo/acme/main" } },
			}),
		).toEqual({
			kind: "sign-in",
			code: "NOT_SIGNED_IN",
			headline: [{ text: "Sign in to Anaconda to use " }, { text: "acme/main", code: true }],
			subline: "Anaconda didn't accept the request because you're not signed in.",
		});
		expect(policyCardContent({ code: "NOT_SIGNED_IN", message: "m" })).toMatchObject({
			headline: [{ text: "Sign in to Anaconda to continue" }],
		});
	});

	it("says the account cannot use the channel when Anaconda refused access", () => {
		expect(
			policyCardContent({
				code: "CHANNEL_ACCESS_DENIED",
				message: "m",
				policy: { refused: { org: "acme", channel: "acme/main" } },
			}),
		).toEqual({
			kind: "sign-in",
			code: "CHANNEL_ACCESS_DENIED",
			headline: [{ text: "Your Anaconda account can't use " }, { text: "acme/main", code: true }],
			subline: "Ask your organization's administrator for access, or sign in with another account.",
		});
		expect(policyCardContent({ code: "CHANNEL_ACCESS_DENIED", message: "m" })).toMatchObject({
			headline: [{ text: "Your Anaconda account can't use this channel" }],
		});
	});

	it("has no card for other failures", () => {
		expect(policyCardContent({ code: "SOLVE_FAILED", message: "m" })).toBeNull();
		expect(policyCardContent({ code: "PACKAGE_NOT_FOUND", message: "m" })).toBeNull();
		expect(policyCardContent({ code: null, message: "m" })).toBeNull();
	});
});

describe("channelLabel", () => {
	it("shortens an Anaconda org channel URL to its org/channel name", () => {
		expect(channelLabel("https://repo.anaconda.cloud/repo/acme/main")).toBe("acme/main");
		expect(channelLabel("https://repo.anaconda.cloud/repo/acme/main/")).toBe("acme/main");
	});

	it("keeps a URL whose short name could be mistaken for another channel", () => {
		expect(channelLabel("https://repo.anaconda.cloud/repo/main")).toBe(
			"https://repo.anaconda.cloud/repo/main",
		);
		expect(channelLabel("https://conda.example.com/repo/acme/main")).toBe(
			"https://conda.example.com/repo/acme/main",
		);
		expect(channelLabel("acme/main")).toBe("acme/main");
	});
});
