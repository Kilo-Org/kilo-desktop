import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Only the specs of registered plugins run. Suite areas under `e2e/specs` map
 * to the plugin that owns them (`kernel` always runs); `plugins/<dir>/e2e`
 * belongs to the id in that plugin's manifest. A plugin without a v1 kernel
 * manifest is not registered, so its specs are skipped.
 */
const AREA_OWNERS: Readonly<Record<string, string>> = {
	kernel: "kernel",
	core: "kilo.core",
	shell: "kilo.shell",
	developer: "kilo.developer",
	"work-sessions": "kilo.work-sessions",
	chat: "kilo.chat",
	git: "kilo.git",
	files: "kilo.files",
	terminal: "kilo.terminal",
	browser: "kilo.browser",
	notebook: "kilo.notebook",
	marketplace: "kilo.marketplace",
	"local-inference": "kilo.local-inference",
	environments: "kilo.environments",
	anaconda: "kilo.anaconda",
	"workspace-board": "kilo.workspace-board",
	workbooks: "kilo.workbooks",
};

/** Folders under `plugins/` (none when the folder is missing). */
function pluginDirectories(pluginsDir: string): string[] {
	return existsSync(pluginsDir) ? readdirSync(pluginsDir) : [];
}

/**
 * Plugins whose plugin.json is a v1 kernel manifest. This matches the bundled
 * list without importing it (plugins depend on @kilo-desktop/e2e, so a
 * package edge back would form a cycle).
 */
export function registeredPluginIds(repoRoot: string): Set<string> {
	const ids = new Set(["kernel"]);
	const pluginsDir = path.join(repoRoot, "plugins");
	for (const dir of pluginDirectories(pluginsDir)) {
		const manifestPath = path.join(pluginsDir, dir, "plugin.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			manifestVersion?: unknown;
			id?: unknown;
		};
		if (manifest.manifestVersion === 1 && typeof manifest.id === "string") ids.add(manifest.id);
	}
	return ids;
}

/** Absolute globs for spec directories whose owning plugin is not registered. */
export function unregisteredSpecGlobs(
	repoRoot: string,
	registered = registeredPluginIds(repoRoot),
): string[] {
	const ignored: string[] = [];
	for (const [area, owner] of Object.entries(AREA_OWNERS)) {
		if (registered.has(owner)) continue;
		const target = path.join(repoRoot, "e2e", "specs", area);
		ignored.push(area.endsWith(".spec.ts") ? target : path.join(target, "**"));
	}
	const pluginsDir = path.join(repoRoot, "plugins");
	for (const dir of pluginDirectories(pluginsDir)) {
		const manifestPath = path.join(pluginsDir, dir, "plugin.json");
		if (!existsSync(path.join(pluginsDir, dir, "e2e")) || !existsSync(manifestPath)) continue;
		const id = (JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown }).id;
		if (typeof id !== "string" || !registered.has(id)) {
			ignored.push(path.join(pluginsDir, dir, "e2e", "**"));
		}
	}
	return ignored;
}
