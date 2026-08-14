import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { FEATURE_FLAG_KEY, mainRegister } from "./index.js";

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

	function bootedSdk(options: { flagEnabled?: boolean | null } = {}) {
		const { flagEnabled = true } = options;
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "todos-feature-"));
		directories.push(storageDir);
		// Linked SDKs so a fake `feature-flag` plugin can expose the
		// `featureFlag` capability the todos handlers read via
		// `mainSdk.plugins.get<...>("feature-flag")`. `flagEnabled: null`
		// simulates a boot where the capability is not registered at all,
		// which must still resolve as disabled.
		const linked = createLinkedFakeSdkPair({ featureId: "todos" });
		const mainSdk = createFakeMainSdk({
			featureId: "todos",
			storageDir,
			pluginDir: PLUGIN_DIR,
			services: linked.rendererSdk.services,
		});
		if (flagEnabled !== null) {
			const flagSdk = linked.createMainSdk("feature-flag");
			flagSdk.plugins.expose("featureFlag", {
				getFlag: <T>(key: string, defaultValue: T): T =>
					(key === FEATURE_FLAG_KEY ? flagEnabled : defaultValue) as T,
			});
		}
		mainRegister(mainSdk);
		return { mainSdk, storageDir };
	}

	it("registers all contract channels and persists into storageDir/data.db when the flag is on", async () => {
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

	describe("feature flag gate (todo-feature)", () => {
		it("short-circuits every handler with FEATURE_DISABLED when the flag is off", async () => {
			const { mainSdk } = bootedSdk({ flagEnabled: false });

			// Channels are still registered — the surface stays stable so the
			// renderer can call them without a "channel not found" race — but
			// each handler answers with a business-level FeatureError.
			expect(mainSdk.has("list")).toBe(true);
			expect(mainSdk.has("add")).toBe(true);
			expect(mainSdk.has("toggle")).toBe(true);

			const disabledMatcher = {
				name: "FeatureError",
				code: "BUSINESS",
				message: "Todos feature is disabled.",
			};
			await expect(mainSdk.invoke("list")).rejects.toMatchObject(disabledMatcher);
			await expect(mainSdk.invoke("add", { title: "Buy milk" })).rejects.toMatchObject(
				disabledMatcher,
			);
			await expect(mainSdk.invoke("toggle", { id: "1" })).rejects.toMatchObject(disabledMatcher);

			mainSdk.dispose();
		});

		it("treats a missing feature-flag capability as disabled", async () => {
			const { mainSdk } = bootedSdk({ flagEnabled: null });

			await expect(mainSdk.invoke("list")).rejects.toMatchObject({
				name: "FeatureError",
				code: "BUSINESS",
				message: "Todos feature is disabled.",
			});

			mainSdk.dispose();
		});
	});
});
