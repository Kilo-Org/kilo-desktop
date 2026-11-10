import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { repoRoot } from "./paths.js";

/**
 * Packages whose module state must be shared by the fixture and every page
 * object: `@anaconda/playwright-utils` keeps the current page in a module
 * singleton (the fixture calls `setPage`), and `@playwright/test` owns the
 * `test`/`expect` instances fixtures extend.
 */
const SHARED_HARNESS_PACKAGES = ["@anaconda/playwright-utils", "@playwright/test"] as const;

/** Directory Node would load `packageName` from when imported under `fromDirectory`. */
function resolvePackageDirectory(fromDirectory: string, packageName: string): string | undefined {
	let current = fromDirectory;
	for (;;) {
		const candidate = path.join(current, "node_modules", ...packageName.split("/"));
		if (existsSync(candidate)) return realpathSync(candidate);
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function pluginE2eDirectories(): string[] {
	const pluginsRoot = path.join(repoRoot, "plugins");
	if (!existsSync(pluginsRoot)) return [];
	return readdirSync(pluginsRoot)
		.map((plugin) => path.join(pluginsRoot, plugin, "e2e"))
		.filter((directory) => existsSync(directory));
}

/**
 * Fail fast when a plugin's e2e code would load its own copy of a shared
 * harness package. A second `@anaconda/playwright-utils` (e.g. a plugin
 * pinning a different version) has a page singleton the fixture never sets,
 * so every locator in that plugin's page objects throws
 * "Cannot read properties of undefined (reading 'getByTestId')" on every
 * attempt — a deterministic failure that looks like a flaky app.
 */
export function assertSharedHarnessDependencies(): void {
	const harnessDirectory = path.join(repoRoot, "e2e");
	const problems: string[] = [];
	for (const packageName of SHARED_HARNESS_PACKAGES) {
		const expected = resolvePackageDirectory(harnessDirectory, packageName);
		for (const directory of pluginE2eDirectories()) {
			const actual = resolvePackageDirectory(directory, packageName);
			if (actual && actual !== expected) {
				problems.push(
					`${path.relative(repoRoot, directory)} resolves ${packageName} from ${actual}, but the e2e harness uses ${expected ?? "nothing"}.`,
				);
			}
		}
	}
	if (problems.length === 0) return;
	throw new Error(
		[
			"Plugin e2e code must share the harness's Playwright packages.",
			...problems,
			"Remove the plugin's own dependency on these packages (depend on @kilo-desktop/e2e instead) or align the version with e2e/package.json.",
		].join("\n"),
	);
}
