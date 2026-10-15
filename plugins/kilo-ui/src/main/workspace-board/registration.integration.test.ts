import { expect, it, vi } from "vitest";
import { createFakeMainSdk } from "@kilo-desktop/testing";

import { kiloUiBrowserRegister } from "../../web/browserRegister.js";

it("provides an in-memory board in browser mode without accessing desktop storage", async () => {
	const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
	const kv = vi.spyOn(sdk.storage, "kv").mockImplementation(() => {
		throw new Error("Desktop storage is unavailable");
	});
	try {
		kiloUiBrowserRegister(sdk);
		const state = await sdk.invoke("workspaceBoard.place", {
			sessionId: "ses_1",
			columnId: "backlog",
			index: 0,
		});
		await expect(sdk.invoke("workspaceBoard.get")).resolves.toEqual(state);
		expect(kv).not.toHaveBeenCalled();
	} finally {
		kv.mockRestore();
		await sdk.disposeAsync();
	}
});
