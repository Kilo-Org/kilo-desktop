import { describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { webRegister } from "./index.js";

describe("local-inference web entry", () => {
	it("opens Local Model Server settings from chat", async () => {
		const navigate = vi.fn();
		const sdk = createFakeSdk({ featureId: "local-inference", navigation: { navigate } });
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("local-inference", "settings.open", {});

		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});
});
