import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

import { type Plugin } from "vite";

export interface ExternalizeDepsOptions {
	/**
	 * Absolute path to the package.json whose dependencies become external.
	 *
	 * @default `${process.cwd()}/package.json`
	 */
	packageJsonPath?: string;
	/**
	 * Externalize Node built-ins (with and without the `node:` prefix).
	 *
	 * @default true
	 */
	nodeBuiltins?: boolean;
	/**
	 * Extra externals not present in package.json (e.g. `electron`, or a
	 * transitive dependency pulled in by a bundled workspace package).
	 */
	include?: Array<string | RegExp>;
	/**
	 * Dependencies to keep bundled (e.g. workspace-internal packages that are
	 * `workspace:*` / `link:` and not resolvable runtime modules on disk).
	 */
	exclude?: Array<string | RegExp>;
}

interface DependencySections {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

function matches(matchers: Array<string | RegExp>, id: string): boolean {
	return matchers.some((matcher) =>
		typeof matcher === "string" ? matcher === id : matcher.test(id),
	);
}

/**
 * Automatically externalize a package.json's dependencies.
 *
 * Sets `build.rollupOptions.external` to an **array** of `string | RegExp`
 * (dependency names, their `dep/subpath` forms, and optionally Node built-ins).
 * The array shape is deliberate: electron-forge's `@electron-forge/plugin-vite`
 * concatenates its own `external` array with the user config's, and Vite 8 /
 * Rolldown rejects a function element inside a concatenated `external` array —
 * so a function-valued `external` (as some externalize plugins emit) fails to
 * build. Adapted from electron-vite's `externalizeDepsPlugin`.
 */
export function externalizeDeps(options: ExternalizeDepsOptions = {}): Plugin {
	const {
		packageJsonPath = `${process.cwd()}/package.json`,
		nodeBuiltins = true,
		include = [],
		exclude = [],
	} = options;

	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as DependencySections;
	const depNames = [
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.optionalDependencies ?? {}),
		...Object.keys(pkg.peerDependencies ?? {}),
	].filter((name) => !matches(exclude, name));

	const external: Array<string | RegExp> = [];
	for (const name of new Set(depNames)) {
		external.push(name, new RegExp(`^${name}/.+`));
	}
	if (nodeBuiltins) {
		for (const builtin of builtinModules) {
			external.push(builtin, new RegExp(`^node:${builtin}$`));
		}
	}
	external.push(...include);

	return {
		name: "vite:externalize-deps",
		enforce: "pre",
		config() {
			return { build: { rollupOptions: { external } } };
		},
	};
}
