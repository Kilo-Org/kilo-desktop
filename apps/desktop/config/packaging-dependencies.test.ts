import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");

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

	it("installs the published @runtimed/node package in production", () => {
		expect(dependencies["@runtimed/node"]).toBe("0.5.0");
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
		expect(notebookManifest.peerDependencies?.["@runtimed/node"]).toBe("0.5.0");
		expect(notebookManifest.devDependencies?.["@runtimed/node"]).toBe("0.5.0");
	});

	it("keeps the WebMCP relay out of the desktop dependency graph", () => {
		expect(dependencies["@mcp-b/webmcp-local-relay"]).toBeUndefined();
	});

	it("pins the isolated WebMCP runtime to the reviewed relay version", () => {
		const runtimeManifest = JSON.parse(
			readFileSync(
				path.join(workspaceRoot, "plugins/kilo-server/relay-runtime/package.json"),
				"utf8",
			),
		) as { dependencies?: Record<string, string> };
		expect(runtimeManifest.dependencies?.["@mcp-b/webmcp-local-relay"]).toBe("4.0.0");
	});

	it("uses frozen lockfile-backed deploys", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain('"--frozen-lockfile"');
		expect(forge).toContain('"--offline"');
		expect(forge).not.toContain('"--legacy"');
	});

	it("stages the isolated WebMCP runtime from a workspace-local deploy", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		// Electron-packager dest is outside the repo. `pnpm deploy --offline`
		// against that path uses a different empty store on Windows and fails
		// looking up @mcp-b/webmcp-local-relay. Stage inside the workspace
		// first, then copy — same pattern as production node_modules.
		expect(forge).toContain(".anaconda-agentic-desktop-webmcp-relay-");
		expect(forge).toMatch(
			/mkdtemp\(\s*path\.join\(\s*workspaceRoot,\s*"\.anaconda-agentic-desktop-webmcp-relay-"/,
		);
	});

	it("only unpacks native modules and the isolated WebMCP runtime", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).not.toMatch(/unpack:\s*"\*\*\/node_modules\/\*\*"/);
		expect(forge).toContain("webMcpRelayRuntimeSubpath");
	});

	it("quotes plugin prepare-assets filters so Windows cmd.exe can match packages", () => {
		const scripts = (
			JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		const preparePlugins = scripts?.["prepare:plugins"] ?? "";
		// cmd.exe treats single quotes as literals, so a filter like
		// `'@anaconda-agentic-desktop/plugin-*'` matches no workspace packages.
		expect(preparePlugins).toContain("run prepare-assets");
		expect(preparePlugins).not.toMatch(/--filter\s+'/);
		expect(preparePlugins).toMatch(/--filter\s+"@anaconda-agentic-desktop\/plugin-\*"/);
	});

	it("runs PR and merge-queue e2e on a larger Windows hosted runner", () => {
		const ci = readFileSync(path.join(workspaceRoot, ".github/workflows/ci.yml"), "utf8");
		const e2ePr = ci.split("e2e-pr:")[1]?.split("e2e-merge:")[0] ?? "";
		const e2eMerge = ci.split("e2e-merge:")[1]?.split("e2e-gate:")[0] ?? "";
		expect(e2ePr).toContain("runs-on: windows-latest-8-cores");
		expect(e2ePr).not.toMatch(/runs-on:\s*windows-latest\s*$/m);
		expect(e2eMerge).toContain("windows-latest-8-cores");
		expect(e2eMerge).not.toMatch(/os:\s*\[macos-latest,\s*windows-latest\]/);
	});

	it("does not prepare a source-built @runtimed/node on packaging hosts", () => {
		const setupNative = readFileSync(
			path.join(workspaceRoot, "plugins/notebook/actions/setup-native/action.yml"),
			"utf8",
		);
		const buildUi = readFileSync(
			path.join(workspaceRoot, "plugins/notebook/actions/build-ui/action.yml"),
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
		expect(buildUi).toContain("1.94.0");
		expect(buildUi).not.toContain("./plugins/notebook/actions/setup-native");
		expect(buildUi).not.toContain("NOTEBOOK_SKIP_NATIVE_BINDING");
		expect(runE2e).toContain("./plugins/notebook/actions/setup-native");
		expect(build).toContain("./plugins/notebook/actions/setup-native");
		expect(publish).toContain("./plugins/notebook/actions/setup-native");
	});

	it("persists Electron native rebuilds in a workspace cache Forge can reuse", () => {
		const forge = readFileSync(path.join(desktopRoot, "forge.config.ts"), "utf8");
		expect(forge).toContain("useCache: true");
		expect(forge).toContain('.electron-rebuild-cache"');
	});

	it("restores the Electron rebuild cache on every packaging host", () => {
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
		expect(cacheElectronRebuild).toContain("pnpm-lock.yaml");
		expect(cacheElectronRebuild).toContain("pnpm-workspace.yaml");
		expect(runE2e).toContain("./.github/actions/cache-electron-rebuild");
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
		expect(setupCli).toContain("plugins/kilo-server/src/main/cli-distribution/artifacts.ts");
		expect(runE2e).toContain("./plugins/kilo-server/actions/setup-cli");
		expect(build).toContain("./plugins/kilo-server/actions/setup-cli");
		expect(publish).toContain("./plugins/kilo-server/actions/setup-cli");
	});
});
