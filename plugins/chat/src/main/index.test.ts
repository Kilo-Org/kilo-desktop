import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { CHAT_DEFINITIONS, ModelPreferences } from "../contracts";
import { chatMainEntry } from "./index";

async function boot(origin?: string) {
	const root = await mkdtemp(path.join(tmpdir(), "chat-main-"));
	if (origin !== undefined) {
		await mkdir(path.join(root, "kilo-ui"));
		await writeFile(path.join(root, "kilo-ui", "model-preferences.json"), origin);
	}
	const storage = createMemoryStorage(path.join(root, "kilo.chat"));
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [{ manifest, definitions: CHAT_DEFINITIONS, entry: chatMainEntry }],
		hostServices: () => ({ storage }),
	});
	await kernel.start();
	return kernel.kernelSdk.domains.get(ModelPreferences)!;
}

describe("chatMainEntry", () => {
	it("adopts origin's model preferences from kilo-ui's storage folder", async () => {
		const preferences = await boot(
			JSON.stringify({ recentModels: [{ providerID: "acme", modelID: "fast" }] }),
		);
		expect(preferences.getState().recentModels).toEqual([{ providerID: "acme", modelID: "fast" }]);
	});

	it("starts empty without origin's file, or with an unreadable one", async () => {
		for (const origin of [undefined, "{not json"]) {
			const preferences = await boot(origin);
			expect(preferences.getState().recentModels).toEqual([]);
		}
	});
});
