import { describe, expect, it } from "vitest";

import { displayChatError, messageErrorText, turnErrorText } from "./chat-error";

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

describe("turnErrorText", () => {
	it("reads Kilo's named errors, plain errors and refused requests", () => {
		expect(turnErrorText({ name: "UnknownError", data: { message: "Database is busy" } })).toBe(
			"Database is busy",
		);
		expect(turnErrorText(new Error("The model is overloaded"))).toBe("The model is overloaded");
		expect(turnErrorText({ message: "Session not found" })).toBe("Session not found");
		expect(turnErrorText("Boom")).toBe("Boom");
	});

	it("drops the stack trace Kilo appends to an unexpected failure", () => {
		expect(
			turnErrorText({
				name: "UnknownError",
				data: { message: "Error: Model not found: acme/gone\n    at getModel (prompt.ts:812)" },
			}),
		).toBe("Error: Model not found: acme/gone");
	});

	it("explains a prompt Kilo had no model for", () => {
		const noModel = "No model is available. Connect a provider in Settings to send messages.";
		expect(
			turnErrorText({
				name: "UnknownError",
				data: { message: "ProviderNoProvidersError: No providers are available\n    at x" },
			}),
		).toBe(noModel);
		expect(
			turnErrorText({
				name: "UnknownError",
				data: { message: "ProviderNoModelsError: No models are available for provider: kilo" },
			}),
		).toBe(noModel);
	});
});
