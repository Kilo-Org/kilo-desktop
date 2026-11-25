/**
 * Choose the Playwright `grep` for a pull request from its changed paths.
 *
 * A PR runs the full specs of every area it touches, and nothing else: the
 * merge queue runs the whole suite, so a break elsewhere is still caught
 * before main. Keeping the PR run to what the diff can reach is what keeps
 * PR CI fast.
 *
 * - Files that cannot change the packaged app run nothing on their own:
 *   docs and markdown, unit/browser/integration test files, and workflows
 *   and actions other than the e2e harness (`IGNORED`).
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
 *   `ci.yml`, which wires this selection into the e2e jobs, and the shard
 *   planner) run everything, as do changes every plugin is built on: the
 *   kernel, the bundled plugin list, the shared UI primitives and the hosts
 *   (`apps/`).
 * - Any other change (root manifests and lockfile, shared configs, packages
 *   without a mapped plugin) runs `@smoke`, a cross-area safety net.
 * - No remaining change: an empty pattern, and the PR runs no e2e at all.
 *
 * Playwright matches `grep` against the test's title path, which starts with
 * the spec file path, so directory patterns select whole areas. Separators
 * are matched as `[\\/]` because Windows reports backslash paths.
 *
 * Usage: `git diff --name-only BASE HEAD | node e2e/scripts/select-pr-e2e.ts`
 * Prints the grep pattern on stdout (empty: no e2e). CI uses plan-pr-e2e.ts,
 * which also sizes the shards.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEPARATOR = String.raw`[\\/]`;
export const EVERYTHING = ".";
const SMOKE = "@smoke";
const HARNESS_PATHS = [
	"scripts/shard-plan.mjs",
	"e2e/",
	".github/actions/run-e2e/",
	".github/actions/install-test-runtime/",
	".github/workflows/ci.yml",
	"packages/kernel/",
	"packages/bundled-plugins/",
	"packages/ui/",
	"apps/",
];

/** Paths that cannot change the packaged app or how e2e runs. */
const IGNORED: readonly RegExp[] = [
	/\.mdx?$/,
	/(^|\/)(LICENSE|NOTICE)[^/]*$/,
	/^docs\//,
	/^\.(agents|kilo|husky|vscode)\//,
	/\.(test|browser\.test|integration\.test|app\.test)\.[cm]?[jt]sx?$/,
	/(^|\/)__snapshots__\//,
	/^scripts\/test-durations\//,
	/^scripts\/[^/]+\.test\.mjs$/,
	// Workflows and actions outside the e2e harness (see HARNESS_PATHS).
	/^\.github\/(?!workflows\/ci\.yml$|actions\/(run-e2e|install-test-runtime)\/)/,
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
		specDirectory("e2e", "specs", "chat") + "file-mentions",
		specDirectory("e2e", "specs", "chat") + "menu-keyboard",
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

const isHarness = (changed: string) => HARNESS_PATHS.some((prefix) => changed.startsWith(prefix));
const isIgnored = (changed: string) => IGNORED.some((pattern) => pattern.test(changed));

export function selectPrE2eGrep(
	changedPaths: readonly string[],
	pluginHasSpecs: (pluginId: string) => boolean = pluginHasOwnSpecs,
): string {
	const normalized = changedPaths
		.map((changed) => changed.trim().replaceAll("\\", "/"))
		.filter(Boolean)
		.filter((changed) => !isIgnored(changed));
	if (normalized.some(isHarness)) return EVERYTHING;
	const patterns = new Set<string>();
	for (const changed of normalized) {
		const pluginMatch = /^plugins\/([^/]+)\//.exec(changed)?.[1];
		const packageMatch = /^packages\/([^/]+)\//.exec(changed)?.[1];
		const pluginId = pluginMatch ?? (packageMatch ? PACKAGE_PLUGINS[packageMatch] : undefined);
		if (!pluginId) {
			patterns.add(SMOKE);
			continue;
		}
		if (pluginHasSpecs(pluginId)) patterns.add(specDirectory("plugins", pluginId, "e2e"));
		for (const related of RELATED_SPECS[pluginId] ?? []) patterns.add(related);
	}
	return [...patterns].join("|");
}

function pluginHasOwnSpecs(pluginId: string): boolean {
	return existsSync(path.join(repoRoot, "plugins", pluginId, "e2e", "specs"));
}

if (import.meta.main) {
	process.stdout.write(selectPrE2eGrep(readFileSync(0, "utf8").split("\n")));
}
