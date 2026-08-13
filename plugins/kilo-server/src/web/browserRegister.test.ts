import { describe, expect, it } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { kiloServerBrowserRegister } from "./browserRegister.js";

describe("kiloServerBrowserRegister", () => {
	it("rejects process lifecycle operations with a desktop-required error", async () => {
		const { mainSdk, rendererSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		kiloServerBrowserRegister(mainSdk);

		await expect(rendererSdk.invoke("server.status")).resolves.toMatchObject({
			status: "unavailable",
			message: "Kilo Server requires the desktop app.",
		});
		await expect(rendererSdk.invoke("server.getConnection")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Server requires the desktop app.",
		});
		await expect(rendererSdk.invoke("server.restart")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Server requires the desktop app.",
		});
		rendererSdk.destroy();
		mainSdk.dispose();
	});
});
