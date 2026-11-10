import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

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
		expect(dependencies["@runtimed/node"]).toBe("0.7.0-nightly.40958541191");
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
		expect(notebookManifest.peerDependencies?.["@runtimed/node"]).toBe("0.7.0-nightly.40958541191");
		expect(notebookManifest.devDependencies?.["@runtimed/node"]).toBe("0.7.0-nightly.40958541191");
	});

	it("keeps the Sentry CLI out of the packaged production dependencies", () => {
		// `sentry` (the FSL-licensed Sentry CLI) is a build-time source-map
		// uploader. @sentry/node lists @sentry/bundler-plugins for its bundler
		// subpath exports, which nothing in the app loads.
		const shipped = lockfileClosure("apps/desktop", ["dependencies", "optionalDependencies"]);

		expect(shipped).toContain("@sentry/electron");
		expect(shipped).toContain("@sentry/node");
		expect(shipped).not.toContain("@sentry/bundler-plugins");
		expect(shipped).not.toContain("sentry");
	});

	it("keeps the Sentry CLI available to the Vite source-map upload", () => {
		const tooling = lockfileClosure("apps/desktop", ["devDependencies"]);

		expect(tooling).toContain("@sentry/vite-plugin");
		expect(tooling).toContain("@sentry/bundler-plugins");
		expect(tooling).toContain("sentry");
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
		const overrides = workspace.slice(workspace.indexOf("\noverrides:")).split(/\n(?=\S)/)[1];
		expect(overrides).toMatch(/^\s+zod: \^4\.\d+\.\d+$/m);
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
		// requiring @runtimed/node.
		expect(forge).not.toMatch(/unpack:\s*`\{/);
		expect(forge).toContain('unpack: `**/node_modules/{${asarUnpackPackages.join(",")}}/**`');
	});

	it("unpacks Parcel Watcher's platform binding for macOS code signing", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain('"@parcel/watcher-darwin-arm64"');
		expect(forge).toContain('"@parcel/watcher-darwin-x64"');
		expect(forge).toContain("...parcelWatcherBindingPackages");
	});

	it("declares @parcel/watcher on desktop so kilo.work-sessions' watcher resolves after pnpm deploy", () => {
		const workSessionsManifest = JSON.parse(
			readFileSync(path.join(workspaceRoot, "plugins/work-sessions/package.json"), "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(dependencies["@parcel/watcher"]).toEqual(expect.stringMatching(/\S/));
		expect(dependencies["@parcel/watcher"]).toBe(
			workSessionsManifest.dependencies?.["@parcel/watcher"],
		);
	});

	it("keeps better-sqlite3 (kilo.work-sessions' origin import) external and unpacked", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const viteMain = readFileSync(path.join(desktopRoot, "vite.main.config.ts"), "utf8");
		expect(forge).toContain('"better-sqlite3"');
		expect(viteMain).toContain('"better-sqlite3"');
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

	it("writes the app's legal files from every shipped bundle once production deps are staged", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const beforeAsar = forge.slice(forge.indexOf("beforeAsar:"), forge.indexOf("win32metadata:"));
		const legal = beforeAsar.indexOf("await writeAppLegalFiles(");
		expect(legal).toBeGreaterThan(beforeAsar.indexOf("stageProductionDependencies"));
		expect(legal).toBeGreaterThan(beforeAsar.indexOf("stageWebRenderer"));
		for (const bundle of [
			".vite/renderer/main_window/.vite/licenses.json",
			".vite/build/.vite/licenses.main.json",
			".vite/build/.vite/licenses.preload.json",
			"plugins/terminal/resources/terminal/.vite/licenses.json",
			"plugins/notebook/resources/kilo-plugin/.vite/licenses.json",
		]) {
			expect(forge).toContain(`"${bundle}"`);
		}
		expect(forge).toContain("bridgePackaging.notices");
	});

	// The AWS publish roles trust only `environment:<env>:ref:refs/heads/main`
	// OIDC subjects; a tag push or branch dispatch would present another subject.
	it("only releases from main", () => {
		const release = readFileSync(path.join(workspaceRoot, ".github/workflows/release.yml"), "utf8");
		const triggers = release.slice(release.indexOf("on:"), release.indexOf("permissions:"));

		expect(triggers).not.toContain("push:");
		expect(triggers).not.toContain("tags:");
		expect(release).toContain('if [[ "$GITHUB_REF" != "refs/heads/main" ]]; then');
	});

	it("assumes the AWS publish role only after dependency install and build", () => {
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		const jobs = publish.split(/\n {2}(?=[a-z_-]+:\n)/);
		const publishJob = jobs.find((job) => job.startsWith("publish:")) ?? "";
		const releaseJob = jobs.find((job) => job.startsWith("release:")) ?? "";

		for (const job of [publishJob, releaseJob]) {
			const assumeRole = job.indexOf("aws-actions/configure-aws-credentials");
			expect(assumeRole).toBeGreaterThan(-1);
			expect(job.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(assumeRole);
		}
		expect(publishJob.indexOf("run release:smoke")).toBeLessThan(
			publishJob.indexOf("aws-actions/configure-aws-credentials"),
		);
		expect(publishJob.indexOf("aws-actions/configure-aws-credentials")).toBeLessThan(
			publishJob.indexOf("publish --from-dry-run"),
		);
	});

	it("never assumes the AWS publish role from manual builds", () => {
		const build = readFileSync(path.join(workspaceRoot, ".github/workflows/build.yml"), "utf8");

		expect(build).not.toContain("aws-actions/configure-aws-credentials");
	});

	// Package install scripts run arbitrary dependency code; signing material and
	// the Sentry upload token must not exist in the job until after install.
	it("loads signing credentials only after dependency install", () => {
		for (const workflowPath of [
			".github/workflows/build.yml",
			".github/workflows/publish_helper.yml",
		]) {
			const workflow = readFileSync(path.join(workspaceRoot, workflowPath), "utf8");
			const install = workflow.indexOf("pnpm install --frozen-lockfile");
			expect(install).toBeGreaterThan(-1);
			for (const step of [
				"./.github/actions/setup-macos-codesign",
				"./.github/actions/setup-windows-codesign",
			]) {
				const setup = workflow.indexOf(step);
				expect(setup).toBeGreaterThan(install);
			}
		}
		const publish = readFileSync(
			path.join(workspaceRoot, ".github/workflows/publish_helper.yml"),
			"utf8",
		);
		expect(publish.indexOf("SENTRY_AUTH_TOKEN")).toBeGreaterThan(
			publish.indexOf("pnpm install --frozen-lockfile"),
		);
	});

	it("never hands signing secrets to PR builds", () => {
		const prBuild = readFileSync(
			path.join(workspaceRoot, ".github/workflows/pr_macos_build.yml"),
			"utf8",
		);

		expect(prBuild).not.toContain("setup-macos-codesign");
		expect(prBuild).not.toMatch(/secrets\.(OSX|AZURE|APPLE)_/);
	});

	it("pins AzureSignTool, which runs with the Key Vault signing token", () => {
		const setup = readFileSync(
			path.join(workspaceRoot, ".github/actions/setup-windows-codesign/action.yml"),
			"utf8",
		);

		expect(setup).toMatch(/dotnet tool install --global AzureSignTool --version \d+\.\d+\.\d+/);
	});

	it("gives CI and nightly workflows a read-only token", () => {
		for (const workflowPath of [".github/workflows/ci.yml", ".github/workflows/nightly.yml"]) {
			const workflow = readFileSync(path.join(workspaceRoot, workflowPath), "utf8");
			expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
		}
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
		) as { scripts?: Record<string, string> };

		expect(terminalManifest.scripts?.["prepare-assets"]).toContain("build-terminal-app");
		expect(dependencies["@kilo-desktop/plugin-terminal"]).toBe("workspace:*");
		expect(forge).toContain('"node-pty"');
		expect(forge).toContain("ensureNodePtySpawnHelpersExecutable");
		expect(forge).toContain("beforeAsar");
		expect(viteMain).toContain('"node-pty"');
	});

	it("ships the terminal frame as an app resource rather than inside the staged package", async () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const frameConfig = readFileSync(
			path.join(workspaceRoot, "plugins/terminal/src/frame/vite.config.ts"),
			"utf8",
		);
		const extraResources = forge.slice(
			forge.indexOf("const extraResources"),
			forge.indexOf("const shippedBundleLicenseFiles"),
		);
		const nodeModules = await mkdtemp(path.join(os.tmpdir(), "kilo-production-dependencies-"));
		temporaryDirectories.push(nodeModules);
		const stagedTerminal = path.join(nodeModules, "@kilo-desktop", "plugin-terminal");
		await mkdir(path.join(stagedTerminal, "resources", "terminal"), { recursive: true });

		await pruneProductionDependencies(nodeModules, ["@kilo-desktop/plugin-terminal"]);

		expect(frameConfig).toContain('"../../resources/terminal"');
		expect(extraResources).toContain('"plugins/terminal/resources/terminal"');
		expect(existsSync(path.join(stagedTerminal, "resources"))).toBe(false);
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
		expect(setupNative).toContain("plugins/notebook/resources/notebook");
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

	it("ships kilo.core's Kilo CLI as an app resource outside ASAR", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		const extraResources = forge.slice(
			forge.indexOf("const extraResources"),
			forge.indexOf("const shippedBundleLicenseFiles"),
		);

		expect(extraResources).toContain('"plugins/core/resources/kilo"');
	});

	it("packs kilo.core's THIRD_PARTY_NOTICES.md (the Kilo CLI's licence) for the app notices", () => {
		// writeAppLegalFiles reproduces the notices of workspace packages that
		// `pnpm deploy` packs; a `files` allowlist without it would drop them.
		const coreRoot = path.join(workspaceRoot, "plugins/core");
		const corePackage = JSON.parse(readFileSync(path.join(coreRoot, "package.json"), "utf8")) as {
			files?: string[];
		};

		expect(dependencies["@kilo-desktop/plugin-core"]).toBe("workspace:*");
		expect(readFileSync(path.join(coreRoot, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain(
			"Kilo CLI",
		);
		expect(corePackage.files ?? ["THIRD_PARTY_NOTICES.md"]).toContain("THIRD_PARTY_NOTICES.md");
	});

	it("stages plugin resources before packaging and dev starts", () => {
		const scripts = (
			JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		const coreScripts = (
			JSON.parse(readFileSync(path.join(workspaceRoot, "plugins/core/package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;

		expect(scripts?.["prepare:build"]).toContain("prepare:plugins");
		expect(scripts?.prestart).toContain("prepare:plugins");
		expect(coreScripts?.["prepare-assets"]).toContain("fetch-cli");
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

	it("caches the Kilo CLI on every packaging host", () => {
		const setupCli = readFileSync(
			path.join(workspaceRoot, "plugins/core/actions/setup-cli/action.yml"),
			"utf8",
		);
		const workflows = [
			".github/actions/run-e2e/action.yml",
			".github/workflows/build.yml",
			".github/workflows/pr_macos_build.yml",
			".github/workflows/publish_helper.yml",
			".github/workflows/sbom.yml",
		].map((file) => readFileSync(path.join(workspaceRoot, file), "utf8"));

		expect(setupCli).toContain("plugins/core/resources/kilo");
		expect(setupCli).toContain("runner.os");
		expect(setupCli).toContain("runner.arch");
		expect(setupCli).toContain("plugins/core/package.json");
		expect(setupCli).toContain("pnpm-lock.yaml");
		for (const workflow of workflows) {
			expect(workflow).toContain("./plugins/core/actions/setup-cli");
		}
	});
});

type LockfileDependencies = Record<string, string | { version: string }>;
type LockfileEntry = Partial<Record<DependencyField, LockfileDependencies>>;
type DependencyField = "dependencies" | "optionalDependencies" | "devDependencies";
interface Lockfile {
	importers: Record<string, LockfileEntry>;
	snapshots: Record<string, LockfileEntry>;
}

/**
 * Names of every package reachable from `importer` through `fields`, read from
 * the lockfile that `pnpm deploy --frozen-lockfile` stages from. Workspace
 * links are followed into their own importer's production dependencies.
 */
function lockfileClosure(importer: string, fields: readonly DependencyField[]): Set<string> {
	// pnpm 12 writes the package-manager pins as a separate leading document.
	const lockfile = parseAllDocuments(
		readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8"),
	)
		.map((document) => document.toJS() as Lockfile)
		.find((document) => document.importers?.[importer]);
	if (!lockfile) throw new Error(`pnpm-lock.yaml has no importer ${importer}`);
	const productionFields: readonly DependencyField[] = ["dependencies", "optionalDependencies"];
	const names = new Set<string>();
	const visited = new Set<string>();

	const visit = (entry: LockfileEntry, entryFields: readonly DependencyField[], from: string) => {
		for (const field of entryFields) {
			for (const [name, resolved] of Object.entries(entry[field] ?? {})) {
				const version = typeof resolved === "string" ? resolved : resolved.version;
				if (version.startsWith("link:")) {
					const linked = path.posix.join(from, version.slice("link:".length));
					if (visited.has(linked)) continue;
					visited.add(linked);
					visit(lockfile.importers[linked] ?? {}, productionFields, linked);
					continue;
				}
				names.add(name);
				const key = `${name}@${version}` in lockfile.snapshots ? `${name}@${version}` : version;
				if (visited.has(key)) continue;
				visited.add(key);
				visit(lockfile.snapshots[key] ?? {}, productionFields, from);
			}
		}
	};

	visit(lockfile.importers[importer] ?? {}, fields, importer);
	return names;
}
