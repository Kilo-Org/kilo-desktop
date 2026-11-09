/**
 * Choose the Playwright `grep` for a pull request from its changed paths.
 *
 * PRs run only `@smoke`, so a plugin's non-smoke specs used to run for the
 * first time in the merge queue, where a failure ejects the PR. This widens
 * the PR run to the full specs of every area the PR touches:
 *
 * - `plugins/<id>/…` runs `plugins/<id>/e2e/**` when that plugin has specs.
 * - Plugins whose behavior is exercised by specs elsewhere map through
 *   `RELATED_SPECS` (e.g. kilo.agent's Kilo server is exercised by the chat specs).
 * - Harness changes (`e2e/`, the run-e2e and install-test-runtime actions,
 *   and `ci.yml`, which wires this selection into the e2e jobs) run
 *   everything, as do changes every plugin is built on: the kernel, the
 *   bundled plugin list, the shared UI primitives and the hosts (`apps/`).
 *
 * Playwright matches `grep` against the test's title path, which starts with
 * the spec file path, so directory patterns select whole areas. Separators
 * are matched as `[\\/]` because Windows reports backslash paths.
 *
 * Usage: `git diff --name-only BASE HEAD | node e2e/scripts/select-pr-e2e.ts`
 * Prints the grep pattern on stdout.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEPARATOR = String.raw`[\\/]`;
const EVERYTHING = ".";
const HARNESS_PATHS = [
	"e2e/",
	".github/actions/run-e2e/",
	".github/actions/install-test-runtime/",
	".github/workflows/ci.yml",
	"packages/kernel/",
	"packages/bundled-plugins/",
	"packages/ui/",
	"apps/",
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function specDirectory(...segments: string[]): string {
	return (
		segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(SEPARATOR) +
		SEPARATOR
	);
}

/**
 * Plugin directories (`plugins/<dir>`) → the spec paths under `e2e/specs`
 * that exercise them. A plugin with its own `plugins/<dir>/e2e/specs` runs
 * those too.
 */
const RELATED_SPECS: Readonly<Record<string, readonly string[]>> = {
	shell: [
		specDirectory("e2e", "specs", "shell"),
		specDirectory("e2e", "specs", "features", "settings"),
		specDirectory("e2e", "specs", "features", "theme"),
	],
	flags: [specDirectory("e2e", "specs", "features", "flags")],
	telemetry: [specDirectory("e2e", "specs", "features", "privacy")],
	updates: [specDirectory("e2e", "specs", "features", "settings") + "about"],
	chat: [specDirectory("e2e", "specs", "features", "chat")],
	agent: [
		specDirectory("e2e", "specs", "features", "agent"),
		specDirectory("e2e", "specs", "features", "settings") + "about-kilo-config",
		specDirectory("e2e", "specs", "features", "chat"),
	],
	account: [specDirectory("e2e", "specs", "features", "settings") + "account"],
	workspaces: [
		specDirectory("e2e", "specs", "features", "workspace"),
		specDirectory("e2e", "specs", "features", "sessions"),
	],
	sessions: [
		specDirectory("e2e", "specs", "features", "sessions"),
		specDirectory("e2e", "specs", "features", "board"),
		specDirectory("e2e", "specs", "features", "git") + "worktrees",
	],
	workbench: [
		specDirectory("e2e", "specs", "features", "sessions"),
		specDirectory("e2e", "specs", "features", "board"),
	],
	"workspace-board": [specDirectory("e2e", "specs", "features", "board")],
	developer: [
		specDirectory("e2e", "specs", "features", "developer"),
		specDirectory("e2e", "specs", "features", "agent") + "agent-server",
	],
	git: [specDirectory("e2e", "specs", "features", "git")],
	files: [specDirectory("e2e", "specs", "features", "files")],
	browser: [specDirectory("e2e", "specs", "features", "browser")],
	terminal: [
		specDirectory("e2e", "specs", "features", "terminal"),
		specDirectory("e2e", "specs", "features", "agent") + "external-ai-apps",
	],
	notebook: [specDirectory("e2e", "specs", "features", "notebook")],
	environments: [specDirectory("e2e", "specs", "features", "environments")],
	"anaconda-account": [specDirectory("e2e", "specs", "features", "settings") + "account"],
	"local-inference": [
		specDirectory("e2e", "specs", "features", "local-inference"),
		specDirectory("e2e", "specs", "features", "chat") + "chat-model-selector",
		specDirectory("e2e", "specs", "features", "settings") + "settings",
	],
};

/** Workspace packages owned by one plugin's behavior (`packages/<dir>` → `plugins/<dir>`). */
const PACKAGE_PLUGINS: Readonly<Record<string, string>> = {
	"git-client": "git",
	"pane-layout": "workbench",
};

function selectPrE2eGrep(
	changedPaths: readonly string[],
	pluginHasSpecs: (pluginId: string) => boolean,
): string {
	const normalized = changedPaths.map((changed) => changed.trim().replaceAll("\\", "/"));
	if (normalized.some((changed) => HARNESS_PATHS.some((prefix) => changed.startsWith(prefix)))) {
		return EVERYTHING;
	}
	const patterns = new Set(["@smoke"]);
	for (const changed of normalized) {
		const pluginMatch = /^plugins\/([^/]+)\//.exec(changed)?.[1];
		const packageMatch = /^packages\/([^/]+)\//.exec(changed)?.[1];
		const pluginId = pluginMatch ?? (packageMatch ? PACKAGE_PLUGINS[packageMatch] : undefined);
		if (!pluginId) continue;
		if (pluginHasSpecs(pluginId)) patterns.add(specDirectory("plugins", pluginId, "e2e"));
		for (const related of RELATED_SPECS[pluginId] ?? []) patterns.add(related);
	}
	return [...patterns].join("|");
}

const changedPaths = readFileSync(0, "utf8").split("\n").filter(Boolean);
process.stdout.write(
	selectPrE2eGrep(changedPaths, (pluginId) =>
		existsSync(path.join(repoRoot, "plugins", pluginId, "e2e", "specs")),
	),
);
