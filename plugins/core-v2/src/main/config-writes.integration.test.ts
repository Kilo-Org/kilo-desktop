import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KILO_V2_CONFIG_FILENAME, KiloConfigManager } from "./agent/KiloConfigManager";
import { ConfigWriteQueue } from "./config-writes";
import { serializedSettings, type GlobalSettings } from "./server-client";

describe("ConfigWriteQueue", () => {
	let directory: string;
	let file: string;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(tmpdir(), "kilo-config-writes-"));
		file = path.join(directory, KILO_V2_CONFIG_FILENAME);
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	const readConfig = async () =>
		parse(await readFile(file, "utf8").catch(() => "{}")) as Record<string, unknown>;

	/** The server's `kilocode.settings` write: it reads the file, edits it, then writes it back. */
	function serverSettings(): GlobalSettings {
		return {
			read: readConfig,
			async write(set) {
				const before = await readConfig();
				// The server checks and validates before it writes; other writers can run meanwhile.
				await readConfig();
				await readConfig();
				await writeFile(file, JSON.stringify({ ...before, ...set }, undefined, 2));
			},
		};
	}

	it("keeps an overlapping settings write and KiloConfigManager write apart, losing neither", async () => {
		const writes = new ConfigWriteQueue();
		const settings = serializedSettings(serverSettings(), writes);
		const config = new KiloConfigManager(directory, undefined, writes);

		await Promise.all([
			settings.write({ username: "desktop" }),
			config.setEntry("commands", "acme", "review", { template: "Review $ARGUMENTS" }),
		]);

		expect(await readConfig()).toEqual({
			username: "desktop",
			commands: { review: { template: "Review $ARGUMENTS" } },
		});
	});
});
