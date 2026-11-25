import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// Mirrors the real workspace: scoped plugins, a package published under a
// third-party name, and one that is never deployed.
const workspacePackageNames = [
	"@kilo-desktop/kernel",
	"@kilo-desktop/e2e",
	"@kilo-desktop/plugin-notebook",
	"@kilo-desktop/plugin-workspaces",
	"@third-party/shim",
];

function prune(nodeModules: string): Promise<void> {
	return pruneProductionDependencies(nodeModules, workspacePackageNames);
}

describe("pruneProductionDependencies", () => {
	it("removes the bridge payload for whichever platform was installed", async () => {
		// The payload is an os/cpu-gated optionalDependency, so the package name
		// differs per build host. All of them are already staged as
		// Resources/bridge and must not ship a second time inside node_modules.
		for (const payload of [
			"desktop-bridge-payload-darwin-arm64",
			"desktop-bridge-payload-linux-arm64",
			"desktop-bridge-payload-linux-x64",
			"desktop-bridge-payload-win32-x64",
		]) {
			const nodeModules = makeNodeModules();
			const payloadDirectory = makePackage(nodeModules, `@anaconda/${payload}`, [
				"python/bin/python3.11",
				"manifest.json",
			]);

			await prune(nodeModules);

			expect(existsSync(payloadDirectory)).toBe(false);
		}
	});

	it("keeps other @anaconda packages", async () => {
		const nodeModules = makeNodeModules();
		const unrelated = makePackage(nodeModules, "@anaconda/some-runtime-dependency");
		const payload = makePackage(nodeModules, "@anaconda/desktop-bridge-payload-linux-x64");

		await prune(nodeModules);

		expect(existsSync(unrelated)).toBe(true);
		expect(existsSync(payload)).toBe(false);
	});

	it("removes staged kilo CLI packages", async () => {
		const nodeModules = makeNodeModules();
		const staged = [
			"cli-darwin-arm64",
			"cli-linux-arm64",
			"cli-linux-x64-baseline",
			"cli-windows-x64-baseline",
		].map((packageName) => makePackage(nodeModules, `@kilocode/${packageName}`));
		const kept = makePackage(nodeModules, "@kilocode/cli");

		await prune(nodeModules);

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

		await prune(nodeModules);

		expect(existsSync(store)).toBe(false);
		expect(existsSync(modulesManifest)).toBe(false);
		expect(existsSync(path.join(hoisted, "dist", "index.js"))).toBe(true);
	});

	it("strips source, tests, configs and docs from workspace packages", async () => {
		// Workspace packages are bundled into main.js, so their TypeScript is
		// dead weight that only discloses source when app.asar is extracted.
		const nodeModules = makeNodeModules();
		const packageDirectory = makePackage(nodeModules, "@kilo-desktop/plugin-notebook", [
			".gitignore",
			".turbo/log.txt",
			".vitest/results.json",
			"actions/setup-native/action.yml",
			"coverage/index.html",
			"docs/handoff.md",
			"e2e/spec.ts",
			"README.md",
			"scripts/fetch.ts",
			"src/main/index.ts",
			"src/main/index.test.ts",
			"tsconfig.json",
			"vitest.config.ts",
		]);

		await prune(nodeModules);

		expect(readdirSync(packageDirectory)).toEqual(["package.json"]);
	});

	it("keeps the runtime assets workspace packages resolve at runtime", async () => {
		const nodeModules = makeNodeModules();
		const runtimeEntries = [
			"build/notebook/index.html",
			"dist/index.js",
			"drizzle/0000_init.sql",
			"drizzle/meta/_journal.json",
			"LICENSE",
			"node_modules/picomatch/index.js",
			"plugin.json",
			"THIRD_PARTY_NOTICES.md",
		];
		const packageDirectory = makePackage(nodeModules, "@kilo-desktop/plugin-workspaces", [
			...runtimeEntries,
			"src/main/db.ts",
		]);

		await prune(nodeModules);

		for (const entry of ["package.json", ...runtimeEntries]) {
			expect(existsSync(path.join(packageDirectory, entry))).toBe(true);
		}
		expect(existsSync(path.join(packageDirectory, "src"))).toBe(false);
	});

	it("prunes workspace packages deployed under a non-workspace scope", async () => {
		// A workspace package published as `@third-party/shim`: scope alone
		// cannot identify our packages.
		const nodeModules = makeNodeModules();
		const shim = makePackage(nodeModules, "@third-party/shim", [
			"src/v2/client.ts",
			"tsconfig.json",
		]);

		await prune(nodeModules);

		expect(readdirSync(shim)).toEqual(["package.json"]);
	});

	it("skips workspace packages that were not deployed and stray scope files", async () => {
		const nodeModules = makeNodeModules();
		const packageDirectory = makePackage(nodeModules, "@kilo-desktop/kernel", ["src/index.ts"]);
		writeFileSync(path.join(nodeModules, "@kilo-desktop", ".DS_Store"), "");

		await prune(nodeModules);

		expect(readdirSync(packageDirectory)).toEqual(["package.json"]);
	});

	it("leaves third-party package contents untouched", async () => {
		const nodeModules = makeNodeModules();
		const thirdParty = makePackage(nodeModules, "zod", ["src/index.ts", "README.md"]);

		await prune(nodeModules);

		expect(existsSync(path.join(thirdParty, "src", "index.ts"))).toBe(true);
		expect(existsSync(path.join(thirdParty, "README.md"))).toBe(true);
	});

	it("is a no-op when the scopes are absent", async () => {
		const nodeModules = makeNodeModules();
		mkdirSync(nodeModules, { recursive: true });

		await expect(prune(nodeModules)).resolves.toBeUndefined();
	});
});
