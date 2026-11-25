import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";

import { kilo2Executable, startKilo2, type Kilo2 } from "../../testing/kilo2.js";
import { applyWorkStyle } from "./apply-work-style.js";
import { createKiloWorkStyleClient } from "./production.js";
import { REVIEW_FIRST_PERMISSIONS } from "./work-style-presets.js";

describe.skipIf(!kilo2Executable)("work style in the bundled kilo2", () => {
	let kilo: Kilo2 | undefined;

	afterEach(async () => {
		await kilo?.stop();
		kilo = undefined;
	});

	it("writes review first after the user's rules in their global config, and restores them", async () => {
		kilo = await startKilo2();
		const file = path.join(kilo.home, ".config", "kilo2", "kilo2.jsonc");
		const own = [{ action: "shell", resource: "*", effect: "allow" }];
		await writeFile(file, JSON.stringify({ permissions: own, theme: "dark" }));
		const client = createKiloWorkStyleClient(kilo.connection);
		const saved = async () => parse(await readFile(file, "utf8")) as Record<string, unknown>;

		const { applied } = await applyWorkStyle(client, "human-in-the-loop", null);
		expect(await saved()).toEqual({
			permissions: [...own, ...REVIEW_FIRST_PERMISSIONS],
			theme: "dark",
		});

		await applyWorkStyle(client, "autonomous", applied);
		expect(await saved()).toEqual({ permissions: own, theme: "dark" });
	});
});
