import { describe, expect, it } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

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

	it("reports external AI apps as unavailable and refuses to change them", async () => {
		const { mainSdk, rendererSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		kiloServerBrowserRegister(mainSdk);

		await expect(rendererSdk.invoke("externalClients.getState")).resolves.toMatchObject({
			enabled: false,
			status: { status: "error", message: "Kilo Server requires the desktop app." },
			clients: [],
		});
		await expect(
			rendererSdk.invoke("externalClients.setEnabled", { enabled: true }),
		).rejects.toMatchObject({ code: "BUSINESS" });
		await expect(
			rendererSdk.invoke("externalClients.createClient", { name: "Cursor" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
		rendererSdk.destroy();
		mainSdk.dispose();
	});
});
