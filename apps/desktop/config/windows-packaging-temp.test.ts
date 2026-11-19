import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	applyWindowsPackagingTemp,
	getWindowsPackagingTempDirectory,
} from "./windows-packaging-temp.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("windows packaging temp", () => {
	it("uses a drive-root temp directory on Windows so nuget.exe stays under MAX_PATH", () => {
		expect(
			getWindowsPackagingTempDirectory({
				platform: "win32",
				driveRoot: "D:\\",
			}),
		).toBe("D:\\t");
		expect(
			getWindowsPackagingTempDirectory({
				platform: "darwin",
				driveRoot: "D:\\",
			}),
		).toBeUndefined();
	});

	it("honors WINDOWS_PACKAGING_TEMP when set", () => {
		expect(
			getWindowsPackagingTempDirectory({
				platform: "win32",
				driveRoot: "D:\\",
				override: "E:\\pack",
			}),
		).toBe("E:\\pack");
	});

	it("creates the directory and points TEMP/TMP at it for Squirrel", async () => {
		const parent = await mkdtemp(path.join(os.tmpdir(), "kilo-win-temp-"));
		temporaryDirectories.push(parent);
		const override = path.join(parent, "t");
		const environment: NodeJS.ProcessEnv = { WINDOWS_PACKAGING_TEMP: override };

		await expect(
			applyWindowsPackagingTemp(environment, { platform: "win32", driveRoot: "D:\\" }),
		).resolves.toBe(override);
		expect(environment.TEMP).toBe(override);
		expect(environment.TMP).toBe(override);
		expect((await stat(override)).isDirectory()).toBe(true);
	});
});
