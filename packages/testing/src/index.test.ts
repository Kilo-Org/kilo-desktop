import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineMethod } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { createFakeMainSdk, createFakeSdk } from "./index.js";

const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

const todosChannels = {
	list: defineMethod(z.undefined(), z.array(todoSchema)),
	add: defineMethod(z.object({ title: z.string().min(1) }), todoSchema),
} as const;

describe("createFakeMainSdk", () => {
	it("invoke validates input and output like the real router", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		mainSdk.channels(todosChannels).handle("add", ({ title }) => ({
			id: "1",
			title,
			completed: false,
		}));

		await expect(mainSdk.invoke("add", { title: "Milk" })).resolves.toEqual({
			id: "1",
			title: "Milk",
			completed: false,
		});
		await expect(mainSdk.invoke("add", { title: 42 })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
	});

	it("dispose runs onDispose callbacks in reverse order and clears handlers", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "todos" });
		const order: string[] = [];

		// A realistic mainRegister: handlers plus cleanup.
		function mainRegister(sdk: MainSdk) {
			sdk.channels(todosChannels).handleAll({
				list: () => [],
				add: ({ title }) => ({ id: "1", title, completed: false }),
			});
			sdk.onDispose(() => order.push("first"));
			sdk.onDispose(() => order.push("second"));
		}

		mainRegister(mainSdk);
		expect(mainSdk.has("list")).toBe(true);

		mainSdk.dispose();

		expect(order).toEqual(["second", "first"]);
		expect(mainSdk.has("list")).toBe(false);
		await expect(mainSdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("createFakeSdk", () => {
	it("serves typed invoke through handlers registered on the fake router", async () => {
		const sdk = createFakeSdk({
			featureId: "todos",
			channels: todosChannels,
			handlers: {
				list: () => [{ id: "1", title: "Milk", completed: false }],
			},
		});

		await expect(sdk.invoke("list")).resolves.toEqual([
			{ id: "1", title: "Milk", completed: false },
		]);
	});
});
