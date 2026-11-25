import type { PermissionRequest } from "@kilo-desktop/react-opencode";
import { describe, expect, it } from "vitest";

import { PERMISSION_AUTO_ANSWER_TIMEOUT_MS } from "@kilo-desktop/plugin-work-sessions/contracts";

import { autoAnswers, hiddenPermissions, type AutoAnswerRules } from "./visible-permissions";

const request = (id: string, patch: Partial<PermissionRequest> = {}): PermissionRequest => ({
	id,
	sessionID: "ses_1",
	action: "shell",
	resources: [],
	metadata: {},
	...patch,
});

const MANUAL: AutoAnswerRules = { mode: "manual", signedIn: true, signInTools: new Set() };
const AUTO: AutoAnswerRules = { ...MANUAL, mode: "auto" };

const candidate = (action: string, metadata: Record<string, unknown> = {}) => ({
	action,
	metadata,
});

describe("autoAnswers", () => {
	it("in Auto, takes everything a person needn't see", () => {
		expect(autoAnswers(candidate("shell"), AUTO)).toBe(true);
		expect(autoAnswers(candidate("shell", { sandboxEscalation: true }), AUTO)).toBe(false);
		expect(autoAnswers(candidate("shell", { interactive: true }), AUTO)).toBe(false);
	});

	it("in Manual, takes only signed-out calls to sign-in tools", () => {
		const signedOut = { ...MANUAL, signedIn: false, signInTools: new Set(["desktop_x"]) };
		expect(autoAnswers(candidate("shell"), MANUAL)).toBe(false);
		expect(autoAnswers(candidate("desktop_x"), signedOut)).toBe(true);
		expect(autoAnswers(candidate("desktop_x"), { ...signedOut, signedIn: true })).toBe(false);
		expect(autoAnswers(candidate("desktop_x", { interactive: true }), signedOut)).toBe(false);
	});
});

describe("hiddenPermissions", () => {
	const state = {
		holding: [],
		released: new Set<string>(),
		seenAt: new Map([["a", 1_000]]),
		now: 1_500,
		rules: AUTO,
	};

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

	it("hides a request it has not seen yet as just asked", () => {
		const pending = [request("unseen")];
		expect(
			hiddenPermissions(pending, { ...state, now: 1_000 + PERMISSION_AUTO_ANSWER_TIMEOUT_MS }),
		).toEqual(pending);
	});

	it("shows what main held and let go", () => {
		const pending = [request("a")];
		expect(hiddenPermissions(pending, { ...state, released: new Set(["a"]) })).toEqual([]);
	});
});
