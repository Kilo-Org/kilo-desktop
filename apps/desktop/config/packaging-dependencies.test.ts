import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { pruneProductionDependencies } from "./prune-production-dependencies.js";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("packaged production dependencies", () => {
	const manifest = JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const dependencies = manifest.dependencies ?? {};
	const devDependencies = manifest.devDependencies ?? {};

	it("declares ws on desktop so the Vite-external main import resolves after pnpm deploy", () => {
		expect(dependencies.ws).toEqual(expect.stringMatching(/\S/));
	});

	it("declares koffi on desktop so the Vite-external main import resolves after pnpm deploy", () => {
		// koffi is externalized in the main bundle and only a transitive notebook
		// dep; without a desktop declaration pnpm deploy would not hoist it (or its
		// prebuilt @koromix sibling), and packaged builds would silently deny every
		// daemon. Keep the version in lockstep with the notebook plugin.
		const notebookManifest = JSON.parse(
			readFileSync(path.join(workspaceRoot, "plugins/notebook/package.json"), "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(dependencies.koffi).toEqual(expect.stringMatching(/\S/));
		expect(dependencies.koffi).toBe(notebookManifest.dependencies?.koffi);
	});

	it("installs the published @runtimed/node package in production", () => {
		expect(dependencies["@runtimed/node"]).toBe("0.6.6-nightly.39227923380");
	});

	it("does not shadow the production @runtimed/node package with a development link", () => {
		expect(devDependencies["@runtimed/node"]).toBeUndefined();
	});

	it("lets the lockfile-backed production deploy stage @runtimed/node", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).not.toContain('packageName: "@runtimed/node"');
		expect(forge).not.toContain("packages/runtimed-node");
	});

	it("uses the published package for notebook development and peer compatibility", () => {
		const notebookManifest = JSON.parse(
			readFileSync(path.join(workspaceRoot, "plugins/notebook/package.json"), "utf8"),
		) as {
			peerDependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		expect(notebookManifest.peerDependencies?.["@runtimed/node"]).toBe("0.6.6-nightly.39227923380");
		expect(notebookManifest.devDependencies?.["@runtimed/node"]).toBe("0.6.6-nightly.39227923380");
	});

	it("keeps the WebMCP relay out of the desktop dependency graph", () => {
		expect(dependencies["@mcp-b/webmcp-local-relay"]).toBeUndefined();
	});

	it("keeps the RunAsNode fuse off so nothing can run the app binary as Node", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toMatch(/\[FuseV1Options\.RunAsNode\]:\s*false/);
		expect(forge).not.toContain("webmcp-relay-runtime");
	});

	it("uses frozen lockfile-backed deploys", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain('"--frozen-lockfile"');
		expect(forge).toContain('"--offline"');
		expect(forge).not.toContain('"--legacy"');
	});

	it("moves the staged production dependency tree into the package", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain(
			"await pruneProductionDependencies(stagedNodeModules, workspacePackageNames)",
		);
		expect(forge).toContain("await moveDirectory(stagedNodeModules, packagedNodeModules)");
	});

	it("removes development artifacts and externally staged native payloads", async () => {
		const nodeModules = await mkdtemp(path.join(os.tmpdir(), "kilo-production-dependencies-"));
		temporaryDirectories.push(nodeModules);
		const packageRoot = path.join(nodeModules, "@kilo-desktop", "plugin-example");
		const bridgePayload = path.join(
			nodeModules,
			"@anaconda",
			"desktop-bridge-payload-darwin-arm64",
		);
		const windowsBridgePayload = path.join(
			nodeModules,
			"@anaconda",
			"desktop-bridge-payload-win32-arm64",
		);
		const kiloCli = path.join(nodeModules, "@kilocode", "cli-darwin-arm64");
		await Promise.all(
			[".turbo", ".vitest", "coverage", "e2e", "dist"].map((directory) =>
				mkdir(path.join(packageRoot, directory), { recursive: true }),
			),
		);
		await mkdir(bridgePayload, { recursive: true });
		await mkdir(windowsBridgePayload, { recursive: true });
		await mkdir(kiloCli, { recursive: true });

		await pruneProductionDependencies(nodeModules, ["@kilo-desktop/plugin-example"]);

		for (const directory of [".turbo", ".vitest", "coverage", "e2e"]) {
			expect(existsSync(path.join(packageRoot, directory))).toBe(false);
		}
		expect(existsSync(path.join(packageRoot, "dist"))).toBe(true);
		expect(existsSync(bridgePayload)).toBe(false);
		expect(existsSync(windowsBridgePayload)).toBe(false);
		expect(existsSync(kiloCli)).toBe(false);
	});

	it("removes the bridge payload when no workspace package scope is staged", async () => {
		const nodeModules = await mkdtemp(path.join(os.tmpdir(), "kilo-production-dependencies-"));
		temporaryDirectories.push(nodeModules);
		const bridgePayload = path.join(
			nodeModules,
			"@anaconda",
			"desktop-bridge-payload-darwin-arm64",
		);
		await mkdir(bridgePayload, { recursive: true });

		await pruneProductionDependencies(nodeModules, []);

		expect(existsSync(bridgePayload)).toBe(false);
	});

	it("pins zod to one major so pnpm 12 deploy is unambiguous", () => {
		const workspace = readFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
		expect(workspace).toContain("zod: ^4.4.3");
	});

	it("only unpacks native modules from ASAR", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).not.toMatch(/unpack:\s*"\*\*\/node_modules\/\*\*"/);
		expect(forge).not.toContain("webMcpRelayRuntimeSubpath");
	});

	it("uses a single-level asar unpack glob so native addons leave the archive", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		// Nested `{**/node_modules/{a,b}/**}` does not expand in @electron/asar.
		// Signed Preview then ships .node files inside app.asar and dies at boot
		// requiring @runtimed/node (#163).
		expect(forge).not.toMatch(/unpack:\s*`\{/);
		expect(forge).toContain('unpack: `**/node_modules/{${asarUnpackPackages.join(",")}}/**`');
	});

	it("unpacks Parcel Watcher's platform binding for macOS code signing", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain('"@parcel/watcher-darwin-arm64"');
		expect(forge).toContain('"@parcel/watcher-darwin-x64"');
		expect(forge).toContain("...parcelWatcherBindingPackages");
	});

	it("smoke-tests updater payloads before either release channel is published", () => {
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		const runPackaging = readFileSync(path.join(desktopRoot, "config/run-packaging.ts"), "utf8");
		expect(publish).toContain("pnpm --filter @kilo-desktop/desktop run publish -- --dry-run");
		expect(publish).toContain("pnpm --filter @kilo-desktop/desktop run release:smoke");
		expect(publish).toContain(
			"pnpm --filter @kilo-desktop/desktop exec tsx config/run-packaging.ts publish --from-dry-run",
		);
		expect(publish).toContain("target: windows-arm64");
		expect(publish).toContain("windows-11-vs2026-arm");
		expect(publish.indexOf("run release:smoke")).toBeLessThan(
			publish.indexOf("publish --from-dry-run"),
		);
		// pnpm re-inserts `--` before extra script args; Forge must still see --dry-run.
		expect(runPackaging).toContain("toForgeArgs(forgeArgs)");
	});

	it("shares one Preview build time across artifact and release-note publication", () => {
		const release = readFileSync(path.join(workspaceRoot, ".github/workflows/release.yml"), "utf8");
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);

		expect(release).toContain(
			"preview_build_time: ${{ steps.release.outputs.preview_build_time }}",
		);
		expect(release).toContain(
			"preview_build_time: ${{ needs.preflight.outputs.preview_build_time }}",
		);
		expect(release).toContain("actions: read");
		expect(release).toContain('actions/runs/$GITHUB_RUN_ID" --jq .created_at');
		expect(publish).toContain("PREVIEW_BUILD_TIME: ${{ inputs.preview_build_time }}");
		expect(publish).not.toContain("github.run_started_at");
	});

	it("releases the committed Stable version without writing back to main", () => {
		const release = readFileSync(path.join(workspaceRoot, ".github/workflows/release.yml"), "utf8");

		expect(release).toContain("jq -r .version apps/desktop/package.json");
		expect(release).not.toContain("inputs.version");
		expect(release).not.toContain("create-github-app-token");
		expect(release).not.toContain("git push");
	});

	it("finishes staging application content before ASAR integrity is sealed", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const beforeAsar = forge.slice(forge.indexOf("beforeAsar:"), forge.indexOf("win32metadata:"));
		expect(beforeAsar).toContain("stageWebRenderer");
		expect(beforeAsar).toContain("stageProductionDependencies");
		expect(forge).not.toContain("packageAfterCopy:");
	});

	it("checks for shipped source after every staging step, before ASAR is sealed", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const beforeAsar = forge.slice(forge.indexOf("beforeAsar:"), forge.indexOf("win32metadata:"));
		const guard = beforeAsar.indexOf(
			"await assertNoShippedSource(buildPath, workspacePackageNames)",
		);
		expect(guard).toBeGreaterThan(-1);
		for (const step of [
			"stageWebRenderer",
			"stageProductionDependencies",
			"ensureNodePtySpawnHelpersExecutable",
		]) {
			expect(beforeAsar.indexOf(step)).toBeLessThan(guard);
		}
	});

	it("stages and unpacks the terminal plugin's node-pty native runtime", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const viteMain = readFileSync(path.join(desktopRoot, "vite.main.config.ts"), "utf8");
		const terminalManifest = JSON.parse(
			readFileSync(path.join(workspaceRoot, "plugins/terminal/package.json"), "utf8"),
		) as { dependencies?: Record<string, string>; scripts?: Record<string, string> };

		expect(terminalManifest.dependencies?.["node-pty"]).toBe("1.2.0-beta.15");
		expect(terminalManifest.dependencies?.["ghostty-web"]).toBe("0.4.0-next.20.g1858a59");
		expect(terminalManifest.scripts?.["prepare-assets"]).toContain("build-terminal-app");
		expect(forge).toContain('"node-pty"');
		expect(forge).toContain('packageName: "@kilo-desktop/plugin-terminal"');
		expect(forge).toContain("ensureNodePtySpawnHelpersExecutable");
		expect(forge).toContain("beforeAsar");
		expect(viteMain).toContain('"node-pty"');
	});

	it("quotes plugin prepare-assets filters so Windows cmd.exe can match packages", () => {
		const scripts = (
			JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		const preparePlugins = scripts?.["prepare:plugins"] ?? "";
		// cmd.exe treats single quotes as literals, so a filter like
		// `'@kilo-desktop/plugin-*'` matches no workspace packages.
		expect(preparePlugins).toContain("run prepare-assets");
		expect(preparePlugins).not.toMatch(/--filter\s+'/);
		expect(preparePlugins).toMatch(/--filter\s+"@kilo-desktop\/plugin-\*"/);
	});

	it("does not source-build nteract artifacts on packaging hosts", () => {
		const setupNative = readFileSync(
			path.join(workspaceRoot, "plugins/notebook/actions/setup-native/action.yml"),
			"utf8",
		);
		const runE2e = readFileSync(
			path.join(workspaceRoot, ".github/actions/run-e2e/action.yml"),
			"utf8",
		);
		const build = readFileSync(path.join(workspaceRoot, ".github/workflows/build.yml"), "utf8");
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		expect(setupNative).not.toContain("runtimed-node");
		expect(setupNative).not.toContain("1.94.0");
		expect(setupNative).toContain("runner.arch");
		expect(setupNative).toContain("plugins/notebook/build/notebook");
		expect(runE2e).toContain("./plugins/notebook/actions/setup-native");
		expect(build).toContain("./plugins/notebook/actions/setup-native");
		expect(build).toContain("windows-11-vs2026-arm");
		expect(build).toContain("windows-arm64");
		expect(publish).toContain("./plugins/notebook/actions/setup-native");
	});

	it("stages the notebook UI through packaging hooks without a workflow fan-out job", () => {
		const desktopPackage = JSON.parse(
			readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };
		const notebookPackage = JSON.parse(
			readFileSync(path.join(workspaceRoot, "plugins/notebook/package.json"), "utf8"),
		) as { scripts?: Record<string, string> };
		const workflowPaths = [
			".github/workflows/build.yml",
			".github/workflows/ci.yml",
			".github/workflows/nightly.yml",
			".github/workflows/publish_helper.yml",
		];

		expect(desktopPackage.scripts?.["prepare:build"]).toContain("prepare:plugins");
		expect(desktopPackage.scripts?.["prepare:plugins"]).toContain("run prepare-assets");
		expect(notebookPackage.scripts?.["prepare-assets"]).toContain("fetch-notebook-ui");
		expect(notebookPackage.scripts).not.toHaveProperty("build-ui");
		for (const workflowPath of workflowPaths) {
			const workflow = readFileSync(path.join(workspaceRoot, workflowPath), "utf8");
			expect(workflow).not.toContain("./plugins/notebook/actions/build-ui");
			expect(workflow).not.toContain("notebook-ui-${{ github.sha }}");
		}
	});

	it("points Windows Forge temp at a short path before Squirrel runs", () => {
		const runPackaging = readFileSync(path.join(desktopRoot, "config/run-packaging.ts"), "utf8");
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(runPackaging).toContain("applyWindowsPackagingTemp");
		expect(forge).toContain("tmpdir: windowsPackagingTemp");
	});

	it("stamps the desktop package version before Forge makers run", () => {
		const scripts = (
			JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		expect(scripts?.make).toBe("tsx config/run-packaging.ts make");
		expect(scripts?.package).toBe("tsx config/run-packaging.ts package");
		expect(scripts?.publish).toBe("tsx config/run-packaging.ts publish");
	});

	it("persists Electron native rebuilds in a workspace cache Forge can reuse", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain("useCache: true");
		expect(forge).toContain('.electron-rebuild-cache"');
	});

	it("skips native addon rebuilds for e2e packages", () => {
		const scripts = (
			JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");

		expect(scripts?.["package:e2e"]).toContain("ELECTRON_SKIP_NATIVE_REBUILD=true");
		expect(scripts?.["package:e2e"]).toContain("VITE_FEATURE_FLAG_OVERRIDES=chat-layouts");
		expect(forge).toContain('process.env.ELECTRON_SKIP_NATIVE_REBUILD === "true"');
		expect(forge).toContain("types: []");
	});

	it("restores the Electron rebuild cache on release packaging hosts only", () => {
		const cacheElectronRebuild = readFileSync(
			path.join(workspaceRoot, ".github/actions/cache-electron-rebuild/action.yml"),
			"utf8",
		);
		const runE2e = readFileSync(
			path.join(workspaceRoot, ".github/actions/run-e2e/action.yml"),
			"utf8",
		);
		const build = readFileSync(path.join(workspaceRoot, ".github/workflows/build.yml"), "utf8");
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		expect(cacheElectronRebuild).toContain("apps/desktop/.electron-rebuild-cache");
		expect(cacheElectronRebuild).toContain("runner.os");
		expect(cacheElectronRebuild).toContain("runner.arch");
		expect(cacheElectronRebuild).toContain("pnpm-lock.yaml");
		expect(cacheElectronRebuild).toContain("pnpm-workspace.yaml");
		expect(runE2e).not.toContain("./.github/actions/cache-electron-rebuild");
		expect(runE2e).not.toContain("build-essential");
		expect(runE2e).not.toContain("libsecret-1-dev");
		expect(runE2e).not.toContain("pkg-config");
		expect(build).toContain("./.github/actions/cache-electron-rebuild");
		expect(publish).toContain("./.github/actions/cache-electron-rebuild");
	});

	it("caches the Kilo CLI the same way notebook binaries are cached", () => {
		const setupCli = readFileSync(
			path.join(workspaceRoot, "plugins/kilo-server/actions/setup-cli/action.yml"),
			"utf8",
		);
		const runE2e = readFileSync(
			path.join(workspaceRoot, ".github/actions/run-e2e/action.yml"),
			"utf8",
		);
		const build = readFileSync(path.join(workspaceRoot, ".github/workflows/build.yml"), "utf8");
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		expect(setupCli).toContain("plugins/kilo-server/resources/kilo");
		expect(setupCli).toContain("runner.os");
		expect(setupCli).toContain("runner.arch");
		expect(setupCli).toContain("plugins/kilo-server/package.json");
		expect(setupCli).toContain("pnpm-lock.yaml");
		expect(runE2e).toContain("./plugins/kilo-server/actions/setup-cli");
		expect(build).toContain("./plugins/kilo-server/actions/setup-cli");
		expect(publish).toContain("./plugins/kilo-server/actions/setup-cli");
	});
});
