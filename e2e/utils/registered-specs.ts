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
	shell: "kilo.shell",
	"features/agent": "kilo.agent",
	"features/board": "kilo.workspace-board",
	"features/browser": "kilo.browser",
	"features/chat": "kilo.chat",
	"features/developer": "kilo.developer",
	"features/environments": "kilo.environments",
	"features/files": "kilo.files",
	"features/flags": "kilo.flags",
	"features/git": "kilo.git",
	"features/local-inference": "kilo.local-inference",
	"features/notebook": "kilo.notebook",
	"features/privacy": "kilo.telemetry",
	"features/sessions": "kilo.workbench",
	"features/sessions/work-sessions.spec.ts": "kilo.sessions",
	"features/settings": "kilo.shell",
	"features/settings/about.spec.ts": "kilo.updates",
	"features/settings/about-kilo-config.spec.ts": "kilo.agent",
	"features/settings/account.spec.ts": "kilo.account",
	"features/settings/account-signed-out.spec.ts": "kilo.account",
	"features/terminal": "kilo.terminal",
	"features/theme": "kilo.shell",
	"features/workspace": "kilo.workspaces",
};

/**
 * Plugins whose plugin.json is a v1 kernel manifest. This matches the bundled
 * list without importing it (plugins depend on @kilo-desktop/e2e, so a
 * package edge back would form a cycle).
 */
export function registeredPluginIds(repoRoot: string): Set<string> {
	const ids = new Set(["kernel"]);
	const pluginsDir = path.join(repoRoot, "plugins");
	for (const dir of readdirSync(pluginsDir)) {
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
	for (const dir of readdirSync(pluginsDir)) {
		const manifestPath = path.join(pluginsDir, dir, "plugin.json");
		if (!existsSync(path.join(pluginsDir, dir, "e2e")) || !existsSync(manifestPath)) continue;
		const id = (JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown }).id;
		if (typeof id !== "string" || !registered.has(id)) {
			ignored.push(path.join(pluginsDir, dir, "e2e", "**"));
		}
	}
	return ignored;
}
