import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

// The plugin package root — `drizzle/` sits next to `plugin.json` here,
// exactly the layout mainSdk.resolvePluginAsset resolves against in production.
const PLUGIN_DIR = path.resolve(import.meta.dirname, "../..");

describe("todos mainRegister", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function bootedSdk() {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "todos-feature-"));
		directories.push(storageDir);
		const mainSdk = createFakeMainSdk({
			featureId: "todos",
			storageDir,
			pluginDir: PLUGIN_DIR,
		});
		mainRegister(mainSdk);
		return { mainSdk, storageDir };
	}

	it("registers all contract channels and persists into storageDir/data.db", async () => {
		const { mainSdk, storageDir } = bootedSdk();

		expect(mainSdk.has("list")).toBe(true);
		expect(mainSdk.has("add")).toBe(true);
		expect(mainSdk.has("toggle")).toBe(true);

		const created = (await mainSdk.invoke("add", { title: "Buy milk" })) as { id: string };
		await expect(mainSdk.invoke("list")).resolves.toEqual([
			{ id: created.id, title: "Buy milk", completed: false },
		]);
		await expect(mainSdk.invoke("toggle", { id: created.id })).resolves.toMatchObject({
			completed: true,
		});

		expect(fs.existsSync(path.join(storageDir, "data.db"))).toBe(true);

		mainSdk.dispose();
	});

	it("validates input at the routing boundary and reports NOT_FOUND as FeatureError", async () => {
		const { mainSdk } = bootedSdk();

		await expect(mainSdk.invoke("add", { title: "   " })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		await expect(mainSdk.invoke("toggle", { id: "missing" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "NOT_FOUND",
			message: "Todo not found.",
		});

		mainSdk.dispose();
	});

	it("closes the database on dispose", async () => {
		const { mainSdk } = bootedSdk();
		await mainSdk.invoke("add", { title: "Buy milk" });

		mainSdk.dispose();

		// Handlers are gone and the DB handle is closed — a new invoke cannot resurrect it.
		await expect(mainSdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
