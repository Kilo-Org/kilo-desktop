import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertNoShippedSource } from "$config/assert-no-shipped-source.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeBuildPath(files: string[]): string {
	const buildPath = mkdtempSync(path.join(tmpdir(), "shipped-source-"));
	tempDirs.push(buildPath);
	for (const file of files) {
		const target = path.join(buildPath, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, "");
	}
	return buildPath;
}

const cleanBuild = [
	"package.json",
	".vite/build/main.js",
	".vite/build/preload.cjs",
	".vite/renderer/main_window/index.html",
	".vite/renderer/main_window/assets/index.js",
	"node_modules/@kilo-desktop/plugin-workspaces/package.json",
	"node_modules/@kilo-desktop/plugin-workspaces/plugin.json",
	"node_modules/@kilo-desktop/plugin-workspaces/drizzle/0000_init.sql",
	"node_modules/@kilo-desktop/plugin-terminal/plugin.json",
	"node_modules/@kilo-desktop/plugin-notebook/build/notebook/index.js",
];

const workspacePackageNames = [
	"@kilo-desktop/e2e",
	"@kilo-desktop/kernel",
	"@kilo-desktop/plugin-agent",
	"@kilo-desktop/plugin-notebook",
	"@kilo-desktop/plugin-terminal",
	"@kilo-desktop/plugin-workspaces",
	"@kilo-desktop/ui",
	"@third-party/shim",
];

function check(buildPath: string): Promise<void> {
	return assertNoShippedSource(buildPath, workspacePackageNames);
}

describe("assertNoShippedSource", () => {
	it("accepts a build with only compiled output and runtime assets", async () => {
		const buildPath = makeBuildPath(cleanBuild);

		await expect(check(buildPath)).resolves.toBeUndefined();
	});

	it("rejects sourcemaps in the main-process build", async () => {
		// A map embeds the original source verbatim in `sourcesContent`.
		const buildPath = makeBuildPath([...cleanBuild, ".vite/build/main.js.map"]);

		await expect(check(buildPath)).rejects.toThrow(path.join(".vite", "build", "main.js.map"));
	});

	it("rejects sourcemaps in the renderer build", async () => {
		const buildPath = makeBuildPath([
			...cleanBuild,
			".vite/renderer/main_window/assets/index.js.map",
		]);

		await expect(check(buildPath)).rejects.toThrow(
			path.join(".vite", "renderer", "main_window", "assets", "index.js.map"),
		);
	});

	it("rejects TypeScript source and sourcemaps in workspace packages", async () => {
		const buildPath = makeBuildPath([
			...cleanBuild,
			"node_modules/@kilo-desktop/plugin-agent/src/main/KiloServerManager.ts",
			"node_modules/@kilo-desktop/ui/src/button.tsx",
			"node_modules/@kilo-desktop/plugin-notebook/build/notebook/index.js.map",
		]);

		const failure = check(buildPath);

		await expect(failure).rejects.toThrow(
			path.join("@kilo-desktop", "plugin-agent", "src", "main", "KiloServerManager.ts"),
		);
		await expect(failure).rejects.toThrow(path.join("@kilo-desktop", "ui", "src", "button.tsx"));
		await expect(failure).rejects.toThrow(
			path.join("@kilo-desktop", "plugin-notebook", "build", "notebook", "index.js.map"),
		);
	});

	it("rejects source in workspace packages deployed under a non-workspace scope", async () => {
		const buildPath = makeBuildPath([
			...cleanBuild,
			"node_modules/@third-party/shim/package.json",
			"node_modules/@third-party/shim/src/v2/client.ts",
		]);

		await expect(check(buildPath)).rejects.toThrow(
			path.join("@third-party", "shim", "src", "v2", "client.ts"),
		);
	});

	it("ignores third-party packages, including those nested in workspace packages", async () => {
		const buildPath = makeBuildPath([
			...cleanBuild,
			"node_modules/zod/src/index.ts",
			"node_modules/@sentry/core/build/esm/index.js.map",
			"node_modules/@kilo-desktop/kernel/node_modules/picomatch/index.d.ts",
			"node_modules/@kilo-desktop/kernel/node_modules/picomatch/index.js.map",
		]);

		await expect(check(buildPath)).resolves.toBeUndefined();
	});

	it("summarises long offender lists instead of listing every file", async () => {
		const offenders = Array.from(
			{ length: 25 },
			(_, index) => `node_modules/@kilo-desktop/ui/src/file-${String(index).padStart(2, "0")}.ts`,
		);
		const buildPath = makeBuildPath([...cleanBuild, ...offenders]);

		const message = await check(buildPath).then(
			() => "",
			(error: Error) => error.message,
		);

		expect(message).toContain("(25 files)");
		expect(message).toContain("… and 5 more");
		expect(message.split("\n").filter((line) => line.endsWith(".ts"))).toHaveLength(20);
	});

	it("passes when no workspace packages are staged", async () => {
		const buildPath = makeBuildPath(["package.json", ".vite/build/main.js"]);

		await expect(check(buildPath)).resolves.toBeUndefined();
	});
});
