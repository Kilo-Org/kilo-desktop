import { builtinModules } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";

import { type Plugin } from "vite";

export interface ExternalOptions {
	exclude?: Array<string | RegExp>;
	include?: Array<string | RegExp>;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matches(matchers: Array<string | RegExp>, id: string): boolean {
	return matchers.some((matcher) =>
		typeof matcher === "string" ? matcher === id : matcher.test(id),
	);
}

/**
 * Automatically externalize a package.json's `dependencies`.
 *
 * A port of electron-vite's `externalizeDepsPlugin`, keeping its option shape
 * (`{ include, exclude }`) and external output — with three deliberate
 * differences forced by our toolchain:
 *
 *   1. Node built-ins are externalized here. Upstream leaves this to
 *      electron-vite's runtime; this repo builds via electron-forge's
 *      `@electron-forge/plugin-vite`, which does not auto-externalize built-ins.
 *   2. `external` is emitted as an array of `string | RegExp`. The array shape
 *      is deliberate: `@electron-forge/plugin-vite` concatenates its own
 *      `external` array with the user config's, and Vite 8 / Rolldown rejects a
 *      function element inside a concatenated `external` array.
 *   3. `include` / `exclude` accept `RegExp` in addition to exact names, so a
 *      family of packages (e.g. all `@kilo-desktop/*` workspace
 *      deps) can be matched with one pattern. String `include` entries are
 *      treated as dependency names (and get `<name>/<subpath>` externalized);
 *      `RegExp` includes are externalized verbatim.
 *
 * To keep third-party deps bundled (e.g. the **preload**, whose isolated
 * context cannot `require` from `node_modules`), do not use this plugin —
 * externalize only `electron` + built-ins directly, as electron-vite documents
 * for `build.externalizeDeps: false`.
 */
export function externalizeDeps(options: ExternalOptions = {}): Plugin {
	const { exclude = [], include = [] } = options;

	const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	// Named deps get a `<name>/<subpath>` regex; RegExp includes are externalized
	// verbatim (they are patterns, not resolvable dependency names).
	const stringIncludes = include.filter(
		(entry): entry is string => typeof entry === "string" && entry.trim() !== "",
	);
	const regexpIncludes = include.filter((entry): entry is RegExp => entry instanceof RegExp);
	const deps = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...stringIncludes])].filter(
		(dep) => !matches(exclude, dep),
	);

	const external: Array<string | RegExp> = [
		...deps,
		...(deps.length > 0 ? [new RegExp(`^(${deps.map(escapeRegExp).join("|")})/.+`)] : []),
		...regexpIncludes,
		...builtinModules,
		...builtinModules.map((builtin) => `node:${builtin}`),
	];

	return {
		name: "kilo:externalize-deps",
		enforce: "pre",
		config() {
			return { build: { rollupOptions: { external } } };
		},
	};
}
