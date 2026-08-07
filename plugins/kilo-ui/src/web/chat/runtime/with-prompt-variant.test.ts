import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { withPromptVariant } from "./with-prompt-variant.js";

describe("withPromptVariant", () => {
	it("injects variant into promptAsync when unset", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		const wrapped = withPromptVariant(client, () => "high");
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "s1",
				variant: "high",
			}),
		);
	});

	it("does not override an explicit variant", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		const wrapped = withPromptVariant(client, () => "high");
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
			variant: "max",
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				variant: "max",
			}),
		);
	});
});
