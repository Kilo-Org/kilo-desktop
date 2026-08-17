import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");

describe("packaged production dependencies", () => {
	const manifest = JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	const dependencies = manifest.dependencies ?? {};

	it("declares ws on desktop so the Vite-external main import resolves after pnpm deploy", () => {
		expect(dependencies.ws).toEqual(expect.stringMatching(/\S/));
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

	it("installs Rust 1.94.0 on packaging hosts so @runtimed/node can be built after the UI artifact lands", () => {
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
		expect(setupNative).toContain("1.94.0");
		expect(runE2e).toContain("./plugins/notebook/actions/setup-native");
		expect(build).toContain("./plugins/notebook/actions/setup-native");
		expect(publish).toContain("./plugins/notebook/actions/setup-native");
	});
});
