import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	RELEASE_PACKAGE_FILES,
	withStampedReleasePackageVersions,
	writePublishPackageVersions,
	writeReleasePackageVersions,
} from "./desktop-version.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function createWorkspace(version = "0.1.0"): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "kilo-release-version-"));
	temporaryDirectories.push(root);
	await Promise.all(
		RELEASE_PACKAGE_FILES.map(async (relativePath) => {
			const file = path.join(root, relativePath);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, `${JSON.stringify({ name: relativePath, version }, null, "\t")}\n`);
		}),
	);
	return root;
}

async function readVersions(root: string): Promise<string[]> {
	return Promise.all(
		RELEASE_PACKAGE_FILES.map(async (relativePath) => {
			const manifest = JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as {
				version: string;
			};
			return manifest.version;
		}),
	);
}

describe("release package versioning", () => {
	it("stamps every release-coupled package with the Preview version and restores it", async () => {
		const root = await createWorkspace();

		await withStampedReleasePackageVersions(
			root,
			{ RELEASE_TRACK: "preview", PREVIEW_BUILD_TIME: "2026-08-18T14:30:52.000Z" },
			async () =>
				expect(await readVersions(root)).toEqual(
					RELEASE_PACKAGE_FILES.map(() => "0.1.1-preview-260818-14305"),
				),
		);

		expect(await readVersions(root)).toEqual(RELEASE_PACKAGE_FILES.map(() => "0.1.0"));
	});

	it("restores every manifest when packaging throws", async () => {
		const root = await createWorkspace();

		await expect(
			withStampedReleasePackageVersions(root, { RELEASE_TRACK: "preview" }, async () => {
				throw new Error("forge failed");
			}),
		).rejects.toThrow("forge failed");
		expect(await readVersions(root)).toEqual(RELEASE_PACKAGE_FILES.map(() => "0.1.0"));
	});

	it("persists a validated Stable version in every release-coupled package", async () => {
		const root = await createWorkspace();

		await writeReleasePackageVersions(root, "1.2.3-alpha.1");

		expect(await readVersions(root)).toEqual(RELEASE_PACKAGE_FILES.map(() => "1.2.3-alpha.1"));
		await expect(writeReleasePackageVersions(root, "latest")).rejects.toThrow(
			"Invalid Stable release version",
		);
	});

	it("aligns every release package to one Preview version before CI builds", async () => {
		const root = await createWorkspace();

		const version = await writePublishPackageVersions(root, {
			RELEASE_TRACK: "preview",
			PREVIEW_BUILD_TIME: "2026-08-18T14:30:52.000Z",
		});

		expect(version).toBe("0.1.1-preview-260818-14305");
		expect(await readVersions(root)).toEqual(RELEASE_PACKAGE_FILES.map(() => version));
	});

	it("rejects a release manifest without a version", async () => {
		const root = await createWorkspace();
		await writeFile(
			path.join(root, RELEASE_PACKAGE_FILES[1]),
			`${JSON.stringify({ name: "web" })}\n`,
		);

		await expect(
			withStampedReleasePackageVersions(root, { RELEASE_TRACK: "preview" }, async () => undefined),
		).rejects.toThrow("Invalid package manifest");
	});
});
