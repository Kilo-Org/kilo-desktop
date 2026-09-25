import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pruneProductionDependencies } from "$config/prune-production-dependencies.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeNodeModules(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "prune-prod-"));
	tempDirs.push(dir);
	return path.join(dir, "node_modules");
}

function makePackage(nodeModules: string, packageName: string, files: string[] = []): string {
	const packageDirectory = path.join(nodeModules, packageName);
	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify({ name: packageName }));
	for (const file of files) {
		const target = path.join(packageDirectory, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, "");
	}
	return packageDirectory;
}

describe("pruneProductionDependencies", () => {
	it("removes the bridge payload for whichever platform was installed", async () => {
		// The payload is an os/cpu-gated optionalDependency, so the package name
		// differs per build host. All of them are already staged as
		// Resources/bridge and must not ship a second time inside node_modules.
		for (const payload of [
			"desktop-bridge-payload-darwin-arm64",
			"desktop-bridge-payload-linux-x64",
			"desktop-bridge-payload-win32-x64",
		]) {
			const nodeModules = makeNodeModules();
			const payloadDirectory = makePackage(nodeModules, `@anaconda/${payload}`, [
				"python/bin/python3.11",
				"manifest.json",
			]);

			await pruneProductionDependencies(nodeModules);

			expect(existsSync(payloadDirectory)).toBe(false);
		}
	});

	it("keeps other @anaconda packages", async () => {
		const nodeModules = makeNodeModules();
		const unrelated = makePackage(nodeModules, "@anaconda/some-runtime-dependency");
		const payload = makePackage(nodeModules, "@anaconda/desktop-bridge-payload-linux-x64");

		await pruneProductionDependencies(nodeModules);

		expect(existsSync(unrelated)).toBe(true);
		expect(existsSync(payload)).toBe(false);
	});

	it("removes staged kilo CLI packages", async () => {
		const nodeModules = makeNodeModules();
		const staged = ["cli-darwin-arm64", "cli-linux-x64-baseline", "cli-windows-x64-baseline"].map(
			(packageName) => makePackage(nodeModules, `@kilocode/${packageName}`),
		);
		const kept = makePackage(nodeModules, "@kilocode/cli");

		await pruneProductionDependencies(nodeModules);

		for (const directory of staged) {
			expect(existsSync(directory)).toBe(false);
		}
		expect(existsSync(kept)).toBe(true);
	});

	it("removes the pnpm virtual store and keeps the hoisted tree", async () => {
		// pnpm 12 `deploy` with nodeLinker: hoisted writes a full
		// `.pnpm/<name>/<version>/<hash>/` store of real copies beside the
		// hoisted packages. Nothing resolves through it, so it only doubles
		// app.asar (and re-ships the bridge payload and kilo CLI).
		const nodeModules = makeNodeModules();
		const hoisted = makePackage(nodeModules, "lucide-react", ["dist/index.js"]);
		const store = path.join(nodeModules, ".pnpm");
		makePackage(
			path.join(store, "@anaconda/desktop-bridge-payload-darwin-arm64/0.1.11/hash/node_modules"),
			"@anaconda/desktop-bridge-payload-darwin-arm64",
			["python/bin/python3.11"],
		);
		makePackage(path.join(store, "@/lucide-react/1.27.0/hash/node_modules"), "lucide-react", [
			"dist/index.js",
		]);
		const modulesManifest = path.join(nodeModules, ".modules.yaml");
		writeFileSync(modulesManifest, "{}");

		await pruneProductionDependencies(nodeModules);

		expect(existsSync(store)).toBe(false);
		expect(existsSync(modulesManifest)).toBe(false);
		expect(existsSync(path.join(hoisted, "dist", "index.js"))).toBe(true);
	});

	it("strips non-runtime directories from workspace packages", async () => {
		const nodeModules = makeNodeModules();
		const packageDirectory = makePackage(nodeModules, "@kilo-desktop/plugin-environments", [
			".turbo/log.txt",
			".vitest/results.json",
			"coverage/index.html",
			"e2e/spec.ts",
			"dist/index.js",
		]);

		await pruneProductionDependencies(nodeModules);

		for (const directory of [".turbo", ".vitest", "coverage", "e2e"]) {
			expect(existsSync(path.join(packageDirectory, directory))).toBe(false);
		}
		expect(existsSync(path.join(packageDirectory, "dist", "index.js"))).toBe(true);
	});

	it("is a no-op when the scopes are absent", async () => {
		const nodeModules = makeNodeModules();
		mkdirSync(nodeModules, { recursive: true });

		await expect(pruneProductionDependencies(nodeModules)).resolves.toBeUndefined();
	});
});
