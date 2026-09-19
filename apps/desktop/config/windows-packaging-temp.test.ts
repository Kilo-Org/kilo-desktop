import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	applyWindowsPackagingTemp,
	getWindowsPackagingTempDirectory,
	squirrelExtractFitsMaxPath,
	squirrelExtractPath,
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

describe("Squirrel nupkg extract path budget", () => {
	const temp = "D:\\t";
	// electron-winstaller nuspec: resources/** → lib\net45\resources\
	const nupkgResources = (...parts: string[]) => ["lib", "net45", "resources", ...parts].join("\\");
	const pnpmRelayFolder = "@mcp-b+webmcp-local-relay@5.1.0";
	const relayCli = ["node_modules", "@mcp-b", "webmcp-local-relay", "dist", "cli.mjs"];

	it("extracts nupkg entries under TEMP\\{guid}\\{entry}", () => {
		expect(squirrelExtractPath("D:\\t", "lib\\net45\\resources\\app.asar")).toBe(
			"D:\\t\\xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\\lib\\net45\\resources\\app.asar",
		);
	});

	it("keeps extra-resource and native-unpack entries under MAX_PATH after Squirrel extract", () => {
		expect(
			squirrelExtractFitsMaxPath(
				temp,
				nupkgResources("webmcp-relay", "node_modules", ".pnpm", pnpmRelayFolder, ...relayCli),
			),
		).toBe(true);
		expect(
			squirrelExtractFitsMaxPath(
				temp,
				nupkgResources(
					"app.asar.unpacked",
					"node_modules",
					".pnpm",
					"better-sqlite3@13.0.1",
					"node_modules",
					"better-sqlite3",
					"build",
					"Release",
					"obj",
					"better_sqlite3",
					"better_sqlite3.node",
				),
			),
		).toBe(true);
		expect(
			squirrelExtractFitsMaxPath(
				temp,
				nupkgResources("kilo", "windows-x64-baseline", "bin", "kilo.exe"),
			),
		).toBe(true);
		expect(
			squirrelExtractFitsMaxPath(
				temp,
				nupkgResources("nteract-mcp", "win32-x64", "nteract-mcp.exe"),
			),
		).toBe(true);
	});
});
