import module from "node:module";
import { pathToFileURL } from "node:url";

import * as kernel from "@kilo-desktop/kernel";
import * as zod from "zod";

/**
 * Modules main shares with local plugins' main and contracts code, the main
 * counterpart of the renderer's import map (apps/web/plugin-shared-modules.ts):
 * a plugin keeps these specifiers external and gets the app's instances. The
 * app bundles every package, so nothing would resolve them from a plugin's
 * folder otherwise. Public API for local plugins, like the renderer's list.
 */
const SHARED: Readonly<Record<string, Record<string, unknown>>> = {
	zod,
	"@kilo-desktop/kernel": kernel,
};

const SCHEME = "kilo-plugin-shared:";
const REGISTRY = Symbol.for("kilo-desktop.plugin-shared-modules");
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The source of a module re-exporting one shared module's instance. */
export function sharedModuleSource(specifier: string, exports: Record<string, unknown>): string {
	const names = Object.keys(exports).filter((name) => name !== "default" && IDENTIFIER.test(name));
	const instance = `globalThis[Symbol.for(${JSON.stringify(REGISTRY.description)})][${JSON.stringify(specifier)}]`;
	return [
		`const shared = ${instance};`,
		"export default shared.default ?? shared;",
		names.length > 0 ? `export const { ${names.join(", ")} } = shared;` : "",
		"",
	].join("\n");
}

/** Plugin folders (file URLs, with a trailing slash) whose modules see the shared specifiers. */
const pluginRoots = new Set<string>();
let installed = false;

/**
 * Lets modules under `root` import the shared specifiers. Only plugin folders
 * are rewritten: the app's own runtime externals (electron, native addons)
 * resolve normally.
 */
export function shareModulesWith(root: string): void {
	pluginRoots.add(pathToFileURL(root.endsWith("/") ? root : `${root}/`).href);
	if (installed) return;
	installed = true;
	(globalThis as Record<symbol, unknown>)[REGISTRY] = SHARED;
	module.registerHooks({
		resolve(specifier, context, nextResolve) {
			const fromPlugin = [...pluginRoots].some((prefix) => context.parentURL?.startsWith(prefix));
			if (fromPlugin && Object.hasOwn(SHARED, specifier)) {
				return { url: `${SCHEME}${specifier}`, shortCircuit: true };
			}
			return nextResolve(specifier, context);
		},
		load(url, context, nextLoad) {
			if (!url.startsWith(SCHEME)) return nextLoad(url, context);
			const specifier = url.slice(SCHEME.length);
			return {
				format: "module",
				source: sharedModuleSource(specifier, SHARED[specifier] ?? {}),
				shortCircuit: true,
			};
		},
	});
}
