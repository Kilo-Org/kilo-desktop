import type { OpenCodePermissionRequest } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

import { PERMISSION_AUTO_ANSWER_TIMEOUT_MS } from "@kilo-desktop/plugin-work-sessions/contracts";

import { autoAnswers, hiddenPermissions, type AutoAnswerRules } from "./visible-permissions";

const request = (
	id: string,
	patch: Partial<OpenCodePermissionRequest> = {},
): OpenCodePermissionRequest => ({
	id,
	sessionId: "ses_1",
	permission: "bash",
	patterns: [],
	metadata: {},
	always: [],
	toolName: "bash",
	askedAt: 1_000,
	raw: {} as OpenCodePermissionRequest["raw"],
	...patch,
});

const MANUAL: AutoAnswerRules = { mode: "manual", signedIn: true, signInTools: new Set() };
const AUTO: AutoAnswerRules = { ...MANUAL, mode: "auto" };

describe("autoAnswers", () => {
	it("in Auto, takes everything a person needn't see", () => {
		expect(autoAnswers(request("p"), AUTO)).toBe(true);
		expect(autoAnswers(request("p", { metadata: { sandboxEscalation: true } }), AUTO)).toBe(false);
		expect(autoAnswers(request("p", { metadata: { skillShell: true } }), AUTO)).toBe(false);
		expect(autoAnswers(request("p", { metadata: { interactive: true } }), AUTO)).toBe(false);
	});

	it("in Manual, takes only signed-out calls to sign-in tools", () => {
		const signedOut = { ...MANUAL, signedIn: false, signInTools: new Set(["desktop_x"]) };
		expect(autoAnswers(request("p"), MANUAL)).toBe(false);
		expect(autoAnswers(request("p", { permission: "desktop_x" }), signedOut)).toBe(true);
		expect(
			autoAnswers(request("p", { permission: "desktop_x" }), { ...signedOut, signedIn: true }),
		).toBe(false);
		expect(
			autoAnswers(
				request("p", { permission: "desktop_x", metadata: { configProtected: true } }),
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

	it("shows what main held and let go", () => {
		const pending = [request("a")];
		expect(hiddenPermissions(pending, { ...state, released: new Set(["a"]) })).toEqual([]);
	});
});
