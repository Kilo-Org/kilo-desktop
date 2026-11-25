import { describe, expect, it } from "vitest";

import { chatErrorHint, displayChatError, isKiloSignInError, messageErrorText } from "./chat-error";

describe("displayChatError", () => {
	it("is empty without a message", () => {
		expect(displayChatError(undefined)).toBe("");
	});

	it("names Kilo Gateway's sign-in and sign-up errors", () => {
		expect(displayChatError('Error: {"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}')).toBe(
			"You need to connect to Kilo to use this model",
		);
		expect(displayChatError('{"error_type":"promotion_model_limit_reached"}')).toBe(
			"You need to sign up for Kilo to keep going",
		);
		expect(displayChatError("You need to sign in to use this model")).toBe(
			"You need to connect to Kilo to use this model",
		);
		expect(displayChatError("PROMOTION_MODEL_LIMIT_REACHED: wait")).toBe(
			"You need to sign up for Kilo to keep going",
		);
	});

	it("says the person was signed out when Kilo no longer accepts the sign-in", () => {
		expect(displayChatError("Your authentication token is invalid. Please sign in again.")).toBe(
			"You've been signed out of Kilo",
		);
		expect(
			displayChatError('{"error":{"code":"INVALID_TOKEN","message":"Please sign in again."}}'),
		).toBe("You've been signed out of Kilo");
		// Not a sign-in prompt to retry: until the account notices, it still reads signed in.
		expect(isKiloSignInError("Your authentication token is invalid. Please sign in again.")).toBe(
			false,
		);
	});

	it("tells a signed-out person to resend once signed in again, and nobody else", () => {
		expect(chatErrorHint("Your authentication token is invalid. Please sign in again.")).toBe(
			"Sign in again, then resend your message.",
		);
		expect(chatErrorHint('{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}')).toBeUndefined();
		expect(chatErrorHint("Rate limited")).toBeUndefined();
		expect(chatErrorHint(undefined)).toBeUndefined();
	});

	it("unwraps an embedded JSON message", () => {
		expect(displayChatError('Request failed {"error":{"message":"Rate limited"}}')).toBe(
			"Rate limited",
		);
		expect(displayChatError('{"message":"Bad request"}')).toBe("Bad request");
	});

	it("keeps any other message as it is", () => {
		expect(displayChatError("Something broke")).toBe("Something broke");
		expect(displayChatError("Not { json }")).toBe("Not { json }");
		expect(displayChatError("[1, 2]{")).toBe("[1, 2]{");
	});
});

describe("messageErrorText", () => {
	it("reads only messages that ended in an error", () => {
		expect(messageErrorText(undefined)).toBeUndefined();
		expect(messageErrorText({ type: "incomplete", reason: "cancelled" })).toBeUndefined();
		expect(messageErrorText({ type: "incomplete", reason: "error" })).toBeUndefined();
	});

	it("turns the error into text", () => {
		expect(messageErrorText({ type: "incomplete", reason: "error", error: "Boom" })).toBe("Boom");
		expect(
			messageErrorText({ type: "incomplete", reason: "error", error: { message: "Oops" } }),
		).toBe("Oops");
		expect(messageErrorText({ type: "incomplete", reason: "error", error: 42 })).toBe("42");
	});
});
