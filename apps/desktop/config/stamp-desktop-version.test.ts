import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withStampedDesktopPackageJson } from "./stamp-desktop-version.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function writeManifest(contents: { name: string; version: string }): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "anaconda-stamp-"));
	temporaryDirectories.push(directory);
	const file = path.join(directory, "package.json");
	await writeFile(file, `${JSON.stringify(contents, null, "\t")}\n`);
	return file;
}

describe("withStampedDesktopPackageJson", () => {
	it("writes the canary publish version so Forge makers name artifacts from it", async () => {
		const file = await writeManifest({ name: "desktop", version: "0.1.0" });

		await withStampedDesktopPackageJson(
			file,
			{ RELEASE_CHANNEL: "canary", CANARY_BUILD_TIME: "2026-08-18T14:30:52.000Z" },
			async () => {
				const stamped = JSON.parse(await readFile(file, "utf8")) as { version: string };
				expect(stamped.version).toBe("0.1.1-canary.20260818.143052");
			},
		);

		const restored = JSON.parse(await readFile(file, "utf8")) as { version: string };
		expect(restored.version).toBe("0.1.0");
	});

	it("restores the original manifest when packaging throws", async () => {
		const file = await writeManifest({ name: "desktop", version: "0.1.0" });

		await expect(
			withStampedDesktopPackageJson(
				file,
				{ RELEASE_CHANNEL: "canary", CANARY_BUILD_TIME: "2026-08-18T14:30:52.000Z" },
				async () => {
					throw new Error("forge failed");
				},
			),
		).rejects.toThrow("forge failed");

		const restored = JSON.parse(await readFile(file, "utf8")) as { version: string };
		expect(restored.version).toBe("0.1.0");
	});

	it("leaves staging and prod on the committed version", async () => {
		const file = await writeManifest({ name: "desktop", version: "0.1.0" });

		await withStampedDesktopPackageJson(file, { RELEASE_CHANNEL: "staging" }, async () => {
			const stamped = JSON.parse(await readFile(file, "utf8")) as { version: string };
			expect(stamped.version).toBe("0.1.0");
		});
	});

	it("rejects a package manifest without a version", async () => {
		const file = await writeManifest({ name: "desktop", version: "0.1.0" });
		await writeFile(file, `${JSON.stringify({ name: "desktop" }, null, "\t")}\n`);

		await expect(
			withStampedDesktopPackageJson(file, { RELEASE_CHANNEL: "canary" }, async () => undefined),
		).rejects.toThrow("Invalid package manifest");
	});
});
