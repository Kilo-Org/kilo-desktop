import type { OpenCodePermissionRequest } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

import type { PermissionRequest } from "@kilo-desktop/plugin-core/contracts";

import { PERMISSION_AUTO_ANSWER_TIMEOUT_MS } from "@kilo-desktop/plugin-work-sessions/contracts";

import { autoAnswers, hiddenPermissions, type AutoAnswerRules } from "./visible-permissions";

/** A pending Kilo v2 request, as the cards hold it. */
const request = (
	id: string,
	patch: Partial<OpenCodePermissionRequest> = {},
): OpenCodePermissionRequest => ({
	id,
	sessionID: "ses_1",
	action: "shell",
	resources: [],
	metadata: {},
	askedAt: 1_000,
	...patch,
});

/** A request as kilo.core describes it to main's auto-approver. */
const described = (patch: Partial<PermissionRequest> = {}): PermissionRequest => ({
	id: "p",
	chatId: "ses_1",
	permission: "shell",
	patterns: [],
	metadata: {},
	...patch,
});

const MANUAL: AutoAnswerRules = { mode: "manual", signedIn: true, signInTools: new Set() };
const AUTO: AutoAnswerRules = { ...MANUAL, mode: "auto" };

describe("autoAnswers", () => {
	it("in Auto, takes everything a person needn't see", () => {
		expect(autoAnswers(described(), AUTO)).toBe(true);
		expect(autoAnswers(described({ metadata: { sandboxEscalation: true } }), AUTO)).toBe(false);
		expect(autoAnswers(described({ metadata: { interactive: true } }), AUTO)).toBe(false);
	});

	it("in Manual, takes only signed-out calls to sign-in tools", () => {
		const signedOut = { ...MANUAL, signedIn: false, signInTools: new Set(["desktop_x"]) };
		expect(autoAnswers(described(), MANUAL)).toBe(false);
		expect(autoAnswers(described({ permission: "desktop_x" }), signedOut)).toBe(true);
		expect(
			autoAnswers(described({ permission: "desktop_x" }), { ...signedOut, signedIn: true }),
		).toBe(false);
		expect(
			autoAnswers(
				described({ permission: "desktop_x", metadata: { interactive: true } }),
				signedOut,
			),
		).toBe(false);
	});
});

describe("hiddenPermissions", () => {
	const state = { holding: [], released: new Set<string>(), now: 1_500, rules: AUTO };

	it("hides what main is holding", () => {
		const pending = [request("a"), request("b")];
		expect(hiddenPermissions(pending, { ...state, rules: MANUAL, holding: ["b"] })).toEqual([
			pending[1],
		]);
	});

	it("hides what main will answer until it reveals it", () => {
		const pending = [request("a")];
		expect(hiddenPermissions(pending, state)).toEqual(pending);
		expect(
			hiddenPermissions(pending, { ...state, now: 1_000 + PERMISSION_AUTO_ANSWER_TIMEOUT_MS }),
		).toEqual([]);
	});

	it("reads a Kilo v2 request's action as its permission", () => {
		const signedOut = { ...MANUAL, signedIn: false, signInTools: new Set(["desktop_x"]) };
		const pending = [request("a", { action: "desktop_x" }), request("b")];
		expect(hiddenPermissions(pending, { ...state, rules: signedOut })).toEqual([pending[0]]);
	});

	it("shows what main held and let go", () => {
		const pending = [request("a")];
		expect(hiddenPermissions(pending, { ...state, released: new Set(["a"]) })).toEqual([]);
	});
});
