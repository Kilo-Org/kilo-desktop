/**
 * Choose the Playwright `grep` for a pull request from its changed paths.
 *
 * PRs run only `@smoke`, so a plugin's non-smoke specs used to run for the
 * first time in the merge queue, where a failure ejects the PR. This widens
 * the PR run to the full specs of every area the PR touches:
 *
 * - `plugins/<id>/…` runs `plugins/<id>/e2e/**` when that plugin has specs.
 * - Plugins whose behavior is exercised by specs elsewhere map through
 *   `RELATED_SPECS`: kilo.shell's specs live in `e2e/specs/shell` and kilo.core's
 *   in `e2e/specs/core`; each runs the other's too, since kilo.shell draws
 *   everything the user sees of kilo.core. kilo.developer's live in
 *   `e2e/specs/developer` and kilo.work-sessions' (also run by
 *   `packages/pane-layout`, `PACKAGE_PLUGINS`) in `e2e/specs/work-sessions`.
 *   kilo.chat's live in `e2e/specs/chat`; they drive the New Session page and
 *   kilo.core's chats end to end, so kilo.work-sessions and kilo.core run them
 *   too, and kilo.chat runs kilo.work-sessions' (layouts hold its Agent pane).
 *   kilo.git's live in `e2e/specs/git` (also run by `packages/git-client`);
 *   they start work sessions in worktrees through kilo.work-sessions' `vcs`
 *   isolation, so the two run each other's. kilo.files' live in
 *   `e2e/specs/files`. kilo.terminal's live in `e2e/specs/terminal`; it also
 *   runs kilo.shell's external AI apps spec (apps open in a terminal).
 *   kilo.browser's live in `e2e/specs/browser`, kilo.notebook's in
 *   `e2e/specs/notebook` and kilo.marketplace's in `e2e/specs/marketplace`.
 *   kilo.local-inference's live in `e2e/specs/local-inference`; it also runs
 *   the chat model selector spec (its model source) and the settings overview
 *   (its sign-in gated section).
 *   kilo.environments' live in `e2e/specs/environments`.
 *   kilo.anaconda's live in `e2e/specs/anaconda`; it also runs kilo.shell's
 *   account specs (its Anaconda row is in Settings → Account).
 *   kilo.workspace-board's live in `e2e/specs/workspace-board`; the board is a
 *   view of kilo.work-sessions, so kilo.work-sessions (and `packages/pane-layout`)
 *   runs them too.
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
	core: [
		specDirectory("e2e", "specs", "core"),
		specDirectory("e2e", "specs", "shell"),
		specDirectory("e2e", "specs", "chat"),
	],
	shell: [
		specDirectory("e2e", "specs", "shell"),
		specDirectory("e2e", "specs", "core"),
		// The side menu specs assert kilo.shell's sidebar chrome (its rail,
		// titlebar, Settings entry and account dock) around the session list.
		specDirectory("e2e", "specs", "work-sessions"),
	],
	developer: [specDirectory("e2e", "specs", "developer")],
	"work-sessions": [
		specDirectory("e2e", "specs", "work-sessions"),
		specDirectory("e2e", "specs", "chat"),
		specDirectory("e2e", "specs", "git"),
		specDirectory("e2e", "specs", "workspace-board"),
	],
	chat: [specDirectory("e2e", "specs", "chat"), specDirectory("e2e", "specs", "work-sessions")],
	git: [specDirectory("e2e", "specs", "git"), specDirectory("e2e", "specs", "work-sessions")],
	files: [
		specDirectory("e2e", "specs", "files"),
		specDirectory("e2e", "specs", "chat") + "welcome-shortcuts",
	],
	terminal: [
		specDirectory("e2e", "specs", "terminal"),
		specDirectory("e2e", "specs", "shell") + "external-ai-apps",
		specDirectory("e2e", "specs", "chat") + "welcome-shortcuts",
	],
	browser: [
		specDirectory("e2e", "specs", "browser"),
		specDirectory("e2e", "specs", "chat") + "welcome-shortcuts",
	],
	notebook: [
		specDirectory("e2e", "specs", "notebook"),
		specDirectory("e2e", "specs", "chat") + "welcome-shortcuts",
	],
	marketplace: [specDirectory("e2e", "specs", "marketplace")],
	"local-inference": [
		specDirectory("e2e", "specs", "local-inference"),
		specDirectory("e2e", "specs", "chat") + "chat-model-selector",
		specDirectory("e2e", "specs", "shell") + "settings-overview",
	],
	environments: [specDirectory("e2e", "specs", "environments")],
	anaconda: [
		specDirectory("e2e", "specs", "anaconda"),
		specDirectory("e2e", "specs", "shell") + "account",
	],
	"workspace-board": [specDirectory("e2e", "specs", "workspace-board")],
};

/** Workspace packages owned by one plugin's behavior (`packages/<dir>` → `plugins/<dir>`). */
const PACKAGE_PLUGINS: Readonly<Record<string, string>> = {
	"pane-layout": "work-sessions",
	"git-client": "git",
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
