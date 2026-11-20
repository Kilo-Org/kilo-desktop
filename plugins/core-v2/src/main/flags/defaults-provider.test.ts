import { describe, expect, it } from "vitest";

import { DefaultsOnlyProvider } from "./defaults-provider";

describe("DefaultsOnlyProvider", () => {
	it("starts complete, reports no flags and disposes", async () => {
		const provider = new DefaultsOnlyProvider();

		await provider.identify();

		expect(await provider.start()).toBe("complete");
		expect(provider.getAllFlags()).toEqual({});
		await expect(provider.dispose()).resolves.toBeUndefined();
	});
});
