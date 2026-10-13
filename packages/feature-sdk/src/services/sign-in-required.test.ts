import { describe, expect, it } from "vitest";

import {
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	isSignInDeclinedToolResult,
	isSignInRequiredToolResult,
	signInRequiredToolMessage,
} from "./sign-in-required.js";

describe("sign-in-required tool refusals", () => {
	it("tells the Kilo agent the tool did not run and to wait for the user's answer", () => {
		const message = signInRequiredToolMessage("kilo");

		expect(message.startsWith(SIGN_IN_REQUIRED_TOOL_ERROR_CODE)).toBe(true);
		expect(message).toMatch(/did not run/);
		expect(message).toMatch(/already asking them in the chat/);
		expect(message).toMatch(/do not ask them yourself/);
		expect(message).toMatch(/continue once they answer, then stop/);
		expect(message).toMatch(/call this tool again/);
		expect(message).toMatch(/reappear in your tool list: from then on, use them again instead of/);
	});

	it("tells an external AI app to have the user sign in to Kilo Desktop", () => {
		const message = signInRequiredToolMessage("external");

		expect(message.startsWith(SIGN_IN_REQUIRED_TOOL_ERROR_CODE)).toBe(true);
		expect(message).toMatch(/sign in.*Kilo Desktop/i);
		expect(message).not.toMatch(/in the chat/);
	});

	it("recognises the refusal however the agent runtime wraps it", () => {
		const message = signInRequiredToolMessage("kilo");

		expect(isSignInRequiredToolResult(message)).toBe(true);
		expect(isSignInRequiredToolResult(`Error: ${message}`)).toBe(true);
		expect(isSignInRequiredToolResult({ content: [{ type: "text", text: message }] })).toBe(true);
	});

	it("does not flag ordinary results", () => {
		expect(isSignInRequiredToolResult(undefined)).toBe(false);
		expect(isSignInRequiredToolResult("ENV_EXISTS: env already exists")).toBe(false);
		expect(isSignInRequiredToolResult({ environments: [] })).toBe(false);
	});
});

describe("sign-in-declined tool refusals", () => {
	it("tells the agent the tools come back after sign-in, and to switch back to them", () => {
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE.startsWith(SIGN_IN_DECLINED_TOOL_ERROR_CODE)).toBe(true);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).toMatch(/until they sign in/);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).toMatch(/reappear/);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).toMatch(/use them again instead of/);
	});

	it("is told apart from a sign-in-required refusal", () => {
		const required = signInRequiredToolMessage("kilo");

		expect(isSignInDeclinedToolResult(`Error: ${SIGN_IN_DECLINED_TOOL_MESSAGE}`)).toBe(true);
		expect(isSignInRequiredToolResult(SIGN_IN_DECLINED_TOOL_MESSAGE)).toBe(false);
		expect(isSignInDeclinedToolResult(required)).toBe(false);
	});
});
