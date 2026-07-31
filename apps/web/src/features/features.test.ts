import { describe, expect, it } from "vitest";

import type { Note } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createFeatureSystem } from "@/platform/sdk";

import { WEB_FEATURES } from "./features";

describe("WEB_FEATURES browserRegister", () => {
	it("boots sdk-producer CRUD including delete and clear", async () => {
		const system = createFeatureSystem(createBrowserLocalApi(), WEB_FEATURES);
		const sdk = system.getSdk("sdk-producer");

		const note = (await sdk.invoke("add", { text: "keep" })) as Note;
		const other = (await sdk.invoke("add", { text: "drop" })) as Note;
		expect((await sdk.invoke("list")) as Note[]).toHaveLength(2);

		await expect(sdk.invoke("delete", { id: other.id })).resolves.toEqual({ deleted: true });
		await expect(sdk.invoke("delete", { id: "missing" })).resolves.toEqual({ deleted: false });
		expect((await sdk.invoke("list")) as Note[]).toEqual([note]);

		await expect(sdk.invoke("clear")).resolves.toEqual({ count: 1 });
		expect((await sdk.invoke("list")) as Note[]).toEqual([]);

		const echo = (await sdk.invoke("echo", { message: "hi" })) as {
			echoed: string;
			timestamp: number;
		};
		expect(echo.echoed).toBe("[sdk-producer] hi");
		expect(typeof echo.timestamp).toBe("number");
	});

	it("boots sdk-consumer ping", async () => {
		const system = createFeatureSystem(createBrowserLocalApi(), WEB_FEATURES);
		const sdk = system.getSdk("sdk-consumer");
		await expect(sdk.invoke("ping")).resolves.toEqual({
			pong: true,
			from: "sdk-consumer",
		});
	});
});
