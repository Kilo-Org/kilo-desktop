import { describe, expect, it } from "vitest";

import {
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
} from "@kilo-desktop/plugin-core/contracts";

import { isSignInRefusal, signInRefusalKind } from "./tool-sign-in";

const SIGN_IN_DECLINED_TOOL_MESSAGE = `${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in.`;
const refusal = `${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The user is not signed in to Kilo.`;

describe("signInRefusalKind", () => {
	it("tells a sign-in refusal from a call refused because the person declined", () => {
		const call = { toolName: "desktop_notebook_open", isError: true };
		expect(signInRefusalKind({ ...call, result: refusal })).toBe("required");
		expect(signInRefusalKind({ ...call, result: SIGN_IN_DECLINED_TOOL_MESSAGE })).toBe("declined");
		expect(signInRefusalKind({ ...call, result: "boom" })).toBeUndefined();
	});

	it("counts a declined refusal as a sign-in refusal", () => {
		expect(
			isSignInRefusal({
				toolName: "desktop_notebook_open",
				result: SIGN_IN_DECLINED_TOOL_MESSAGE,
				isError: true,
			}),
		).toBe(true);
	});
});

describe("isSignInRefusal", () => {
	it("is true for a failed desktop tool call carrying the gateway's marker", () => {
		expect(
			isSignInRefusal({ toolName: "desktop_notebook_open", result: refusal, isError: true }),
		).toBe(true);
		expect(
			isSignInRefusal({
				toolName: "desktop_notebook_open",
				result: { content: [{ type: "text", text: refusal }] },
				isError: true,
			}),
		).toBe(true);
	});

	it("ignores successful calls, other tools and other errors", () => {
		expect(isSignInRefusal({ toolName: "desktop_notebook_open", result: refusal })).toBe(false);
		expect(isSignInRefusal({ toolName: "bash", result: refusal, isError: true })).toBe(false);
		expect(
			isSignInRefusal({ toolName: "desktop_notebook_open", result: "boom", isError: true }),
		).toBe(false);
		expect(
			isSignInRefusal({ toolName: "desktop_notebook_open", result: undefined, isError: true }),
		).toBe(false);
	});
});
