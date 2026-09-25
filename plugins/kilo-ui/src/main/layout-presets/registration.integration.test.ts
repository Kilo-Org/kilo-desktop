import { expect, it, vi } from "vitest";
import { createFakeMainSdk } from "@kilo-desktop/testing";

import { kiloUiBrowserRegister } from "../../web/browserRegister.js";

it("provides browser test handlers without accessing desktop storage", async () => {
	const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
	const kv = vi.spyOn(sdk.storage, "kv").mockImplementation(() => {
		throw new Error("Desktop storage is unavailable");
	});
	try {
		kiloUiBrowserRegister(sdk);
		const state = await sdk.invoke("layoutPresets.save", {
			name: "Test layout",
			makeDefault: true,
			template: { version: 1, arrangement: "tiles", slots: [], groups: [] },
		});
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual(state);
		expect(kv).not.toHaveBeenCalled();
	} finally {
		kv.mockRestore();
		await sdk.disposeAsync();
	}
});
