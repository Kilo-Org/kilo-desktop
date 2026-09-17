import { describe, expect, it, vi } from "vitest";

import { previousUserMessage, retryFailedPrompt, userPromptText } from "./retry-failed-prompt.js";

const user = {
	id: "user-1",
	role: "user",
	content: [{ type: "text", text: "Fix the banner" }],
};

const assistant = {
	id: "asst-1",
	role: "assistant",
	content: [{ type: "text", text: "" }],
};

describe("previousUserMessage", () => {
	it("returns the message immediately before the assistant turn", () => {
		expect(previousUserMessage([user, assistant], "asst-1")).toEqual(user);
	});

	it("returns undefined without a preceding user turn", () => {
		expect(previousUserMessage([assistant], "asst-1")).toBeUndefined();
		expect(previousUserMessage([user, assistant], "missing")).toBeUndefined();
	});
});

describe("userPromptText", () => {
	it("joins text parts and ignores empty content", () => {
		expect(userPromptText(user)).toBe("Fix the banner");
		expect(userPromptText({ content: [{ type: "image" }] })).toBeUndefined();
	});
});

describe("retryFailedPrompt", () => {
	it("retries in place through the previous user message id without appending", async () => {
		const retry = vi.fn(async () => undefined);
		const append = vi.fn();

		await expect(
			retryFailedPrompt({
				messages: [user, assistant],
				assistantId: "asst-1",
				retry,
				append,
			}),
		).resolves.toBe(true);

		expect(retry).toHaveBeenCalledWith("user-1");
		expect(append).not.toHaveBeenCalled();
	});

	it("returns false when the failed assistant is not the last message", async () => {
		const retry = vi.fn(async () => undefined);
		const append = vi.fn();
		const laterUser = {
			id: "user-2",
			role: "user",
			content: [{ type: "text", text: "later" }],
		};

		await expect(
			retryFailedPrompt({
				messages: [user, assistant, laterUser],
				assistantId: "asst-1",
				retry,
				append,
			}),
		).resolves.toBe(false);

		expect(retry).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it("falls back to appending the prompt when retry is absent", async () => {
		const append = vi.fn();

		await expect(
			retryFailedPrompt({
				messages: [user, assistant],
				assistantId: "asst-1",
				append,
			}),
		).resolves.toBe(true);

		expect(append).toHaveBeenCalledWith("Fix the banner");
	});

	it("propagates retry errors instead of appending", async () => {
		const retry = vi.fn(async () => {
			throw new Error("refused");
		});
		const append = vi.fn();

		await expect(
			retryFailedPrompt({
				messages: [user, assistant],
				assistantId: "asst-1",
				retry,
				append,
			}),
		).rejects.toThrow("refused");

		expect(append).not.toHaveBeenCalled();
	});

	it("does nothing without a user prompt", async () => {
		const append = vi.fn();
		await expect(
			retryFailedPrompt({
				messages: [assistant],
				assistantId: "asst-1",
				append,
			}),
		).resolves.toBe(false);
		expect(append).not.toHaveBeenCalled();
	});
});
