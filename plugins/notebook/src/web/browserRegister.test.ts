import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { notebookBrowserRegister } from "./browserRegister";

describe("notebookBrowserRegister", () => {
	it("reports no relay and no daemon rather than leaving the channel unregistered", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });

		notebookBrowserRegister(mainSdk);

		expect(mainSdk.has("status")).toBe(true);
		// `idle`, not `failed`: browser mode never attempts a spawn, so there is no
		// failure to report — just an absence.
		await expect(mainSdk.invoke("status")).resolves.toEqual({
			relayPort: 0,
			availability: { status: "unavailable" },
			daemon: null,
		});
	});
});
