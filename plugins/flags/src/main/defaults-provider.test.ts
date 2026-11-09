import { describe, expect, it } from "vitest";

import { DefaultsOnlyProvider } from "./defaults-provider";

describe("DefaultsOnlyProvider", () => {
	it("answers every flag with its default", async () => {
		const provider = new DefaultsOnlyProvider();

		await provider.identify();

		expect(await provider.start()).toBe("complete");
		expect(provider.getFlag("anything", true)).toBe(true);
		expect(provider.getAllFlags()).toEqual({});
		await expect(provider.dispose()).resolves.toBeUndefined();
	});
});
