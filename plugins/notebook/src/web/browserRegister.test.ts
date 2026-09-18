import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { notebookBrowserRegister } from "./browserRegister.js";

describe("notebookBrowserRegister", () => {
	it("reports no daemon rather than leaving the channel unregistered", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });

		notebookBrowserRegister(mainSdk);

		expect(mainSdk.has("status")).toBe(true);
		await expect(mainSdk.invoke("status")).resolves.toEqual({
			availability: { status: "unavailable" },
			process: {
				status: "failed",
				reason: "The notebook runtime daemon is unavailable in browser mode.",
			},
			daemon: null,
		});
	});

	it("rejects file open, save, and save-directory changes in browser mode", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });
		notebookBrowserRegister(mainSdk);

		await expect(mainSdk.invoke("openFile", { path: "/tmp/analysis.ipynb" })).rejects.toMatchObject(
			{
				name: "FeatureError",
				code: "BUSINESS",
				message: "Opening notebook files is unavailable in browser mode.",
			},
		);
		await expect(
			mainSdk.invoke("save", { notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d" }),
		).resolves.toEqual({
			outcome: "failed",
			reason: "Saving notebooks is unavailable in browser mode.",
		});
		await expect(
			mainSdk.invoke("setDefaultSaveDirectory", {
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				directory: null,
			}),
		).resolves.toBeUndefined();
	});
});
