import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { notebookBrowserRegister } from "./browserRegister";

describe("notebookBrowserRegister", () => {
	it("reports no daemon rather than leaving the channel unregistered", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });

		notebookBrowserRegister(mainSdk);

		expect(mainSdk.has("status")).toBe(true);
		await expect(mainSdk.invoke("status")).resolves.toEqual({
			availability: { status: "unavailable" },
			daemon: null,
		});
	});
});
