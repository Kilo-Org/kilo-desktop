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
	it("reverts the user turn then appends the prompt", async () => {
		const revert = vi.fn(async () => undefined);
		const append = vi.fn();

		await expect(
			retryFailedPrompt({
				messages: [user, assistant],
				assistantId: "asst-1",
				revert,
				append,
			}),
		).resolves.toBe(true);

		expect(revert).toHaveBeenCalledWith("user-1");
		expect(append).toHaveBeenCalledWith("Fix the banner");
	});

	it("still appends when revert is missing or fails", async () => {
		const append = vi.fn();
		await retryFailedPrompt({
			messages: [user, assistant],
			assistantId: "asst-1",
			append,
		});
		expect(append).toHaveBeenCalledWith("Fix the banner");

		const revert = vi.fn(async () => {
			throw new Error("busy");
		});
		append.mockClear();
		await expect(
			retryFailedPrompt({
				messages: [user, assistant],
				assistantId: "asst-1",
				revert,
				append,
			}),
		).resolves.toBe(true);
		expect(append).toHaveBeenCalledWith("Fix the banner");
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
