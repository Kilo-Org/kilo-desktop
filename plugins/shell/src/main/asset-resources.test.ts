import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { KernelError } from "@kilo-desktop/kernel";

import { assetResources } from "./asset-resources";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function packagedResourcesFolder(files: Record<string, string>): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-resources-"));
	directories.push(directory);
	for (const [name, text] of Object.entries(files))
		await writeFile(path.join(directory, name), text);
	return directory;
}

/** The desktop host's asset resolver in a packaged build: `resources/<file>` → Resources/<file>. */
const packagedAssets = (resources: string) => ({
	resolve: (subpath: string) => path.join(resources, subpath.replace(/^resources\//, "")),
});

describe("assetResources", () => {
	it("locates and reads documents shipped beside the app", async () => {
		const resources = await packagedResourcesFolder({ "THIRD_PARTY_NOTICES.txt": "notices" });
		const legal = assetResources(packagedAssets(resources));

		expect(legal.locate("THIRD_PARTY_NOTICES.txt")).toBe(
			path.join(resources, "THIRD_PARTY_NOTICES.txt"),
		);
		await expect(legal.read("THIRD_PARTY_NOTICES.txt")).resolves.toBe("notices");
	});

	it("answers null for documents that are not shipped", async () => {
		const legal = assetResources(packagedAssets(await packagedResourcesFolder({})));

		expect(legal.locate("THIRD_PARTY_NOTICES.txt")).toBeNull();
		await expect(legal.read("THIRD_PARTY_NOTICES.txt")).resolves.toBeNull();
	});

	it("answers null in development, where the plugin has no asset folder", async () => {
		const unavailable = {
			resolve: () => {
				throw new KernelError("UNAVAILABLE", '"kilo.shell" has no asset folder.');
			},
		};

		expect(assetResources(unavailable).locate("THIRD_PARTY_NOTICES.txt")).toBeNull();
		expect(assetResources(undefined).locate("THIRD_PARTY_NOTICES.txt")).toBeNull();
		await expect(assetResources(undefined).read("THIRD_PARTY_NOTICES.txt")).resolves.toBeNull();
	});
});
