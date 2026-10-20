/**
 * Choose the Playwright `grep` for a pull request from its changed paths.
 *
 * PRs run only `@smoke`, so a plugin's non-smoke specs used to run for the
 * first time in the merge queue, where a failure ejects the PR. This widens
 * the PR run to the full specs of every area the PR touches:
 *
 * - `plugins/<id>/…` runs `plugins/<id>/e2e/**` when that plugin has specs.
 * - Plugins whose behavior is exercised by specs elsewhere map through
 *   `RELATED_SPECS` (e.g. the Kilo server sidecar is exercised by kilo-ui).
 * - Harness changes (`e2e/`, the run-e2e and install-test-runtime actions,
 *   and `ci.yml`, which wires this selection into the e2e jobs) run
 *   everything.
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
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function specDirectory(...segments: string[]): string {
	return (
		segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(SEPARATOR) +
		SEPARATOR
	);
}

/** Plugins without their own specs (or with specs elsewhere) → the spec paths that cover them. */
const RELATED_SPECS: Readonly<Record<string, readonly string[]>> = {
	"kilo-server": [specDirectory("plugins", "kilo-ui", "e2e")],
	"kilo-ui": [specDirectory("e2e", "specs", "features", "chat")],
	git: [
		specDirectory("e2e", "specs", "features", "git"),
		specDirectory("plugins", "kilo-ui", "e2e", "specs") + "git-worktrees",
	],
	browser: [specDirectory("e2e", "specs", "features", "browser")],
	"local-inference": [specDirectory("plugins", "kilo-ui", "e2e", "specs") + "local-inference"],
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
		const match = /^plugins\/([^/]+)\//.exec(changed);
		if (!match) continue;
		const pluginId = match[1] as string;
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
