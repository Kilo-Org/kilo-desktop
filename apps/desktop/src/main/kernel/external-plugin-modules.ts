import module from "node:module";
import { pathToFileURL } from "node:url";

import * as kernel from "@kilo-desktop/kernel";
import * as zod from "zod";

/**
 * How main loads local plugins' modules: only the bytes the user approved.
 *
 * A plugin's approval is pinned to a digest of its files (external-plugins.ts),
 * and windows are served those bytes from memory. Main must run the same
 * bytes, so it never reads a plugin's modules from disk: these loader hooks
 * serve every `file:` URL under a registered plugin folder from its approved
 * file map, and refuse what isn't in it — files the digest skipped
 * (`node_modules`, dot entries, symlinks), files written after the scan, and
 * anything outside the folder. A plugin's imports may only be its own files,
 * Node's built-ins, or the modules main shares (below).
 *
 * The shared modules are main's counterpart of the renderer's import map
 * (apps/web/plugin-shared-modules.ts): a plugin keeps these specifiers
 * external and gets the app's instances. Public API for local plugins, like
 * the renderer's list.
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

/** A plugin folder as a `file:` URL with a trailing slash, and its approved files by relative path. */
interface RegisteredPlugin {
	readonly root: string;
	readonly files: ReadonlyMap<string, Uint8Array>;
}

type ResolveResult = { readonly url: string; readonly shortCircuit?: boolean | undefined };
type LoadResult = {
	readonly format: "module";
	readonly source: string | Uint8Array;
	readonly shortCircuit: true;
};

function pluginFor(
	plugins: readonly RegisteredPlugin[],
	url: string | undefined,
): RegisteredPlugin | undefined {
	return url === undefined ? undefined : plugins.find((plugin) => url.startsWith(plugin.root));
}

/** A plugin file URL's key in its approved files: the relative path, without query or hash. */
function relativePath(plugin: RegisteredPlugin, url: string): string {
	const { pathname } = new URL(url);
	return decodeURIComponent(pathname.slice(new URL(plugin.root).pathname.length));
}

function refuse(message: string): never {
	throw Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });
}

/**
 * The resolve and load hooks over a set of registered plugins (a separate
 * function so tests can exercise them without installing process-wide hooks).
 */
export function createPluginModuleHooks(plugins: readonly RegisteredPlugin[]) {
	return {
		resolve(
			specifier: string,
			parentURL: string | undefined,
			next: () => ResolveResult,
		): ResolveResult {
			const parent = pluginFor(plugins, parentURL);
			if (!parent) return next();
			if (Object.hasOwn(SHARED, specifier)) {
				return { url: `${SCHEME}${specifier}`, shortCircuit: true };
			}
			if (module.isBuiltin(specifier)) return next();
			const isRelative = /^\.{1,2}\//.test(specifier) || specifier.startsWith("/");
			const url =
				isRelative || specifier.startsWith("file:") ? new URL(specifier, parentURL) : undefined;
			if (!url || !url.href.startsWith(parent.root)) {
				refuse(
					`A local plugin can only import its own files, Node's built-ins and the modules Kilo Desktop shares; "${specifier}" is none of these. Bundle it.`,
				);
			}
			if (!parent.files.has(relativePath(parent, url.href))) {
				refuse(`"${specifier}" isn't one of the plugin's approved files.`);
			}
			return { url: url.href, shortCircuit: true };
		},
		load(url: string, next: () => LoadResult | unknown): LoadResult | unknown {
			if (url.startsWith(SCHEME)) {
				const specifier = url.slice(SCHEME.length);
				return {
					format: "module",
					source: sharedModuleSource(specifier, SHARED[specifier] ?? {}),
					shortCircuit: true,
				};
			}
			const plugin = pluginFor(plugins, url);
			if (!plugin) return next();
			const source = plugin.files.get(relativePath(plugin, url));
			if (!source) refuse(`"${url}" isn't one of the plugin's approved files.`);
			return { format: "module", source, shortCircuit: true };
		},
	};
}

const registered: RegisteredPlugin[] = [];
let installed = false;

/**
 * Registers a plugin folder (a real path) and its approved files before its
 * modules are imported: from then on main loads them only from `files`.
 */
export function loadPluginModulesFrom(root: string, files: ReadonlyMap<string, Uint8Array>): void {
	registered.push({ root: pathToFileURL(root.endsWith("/") ? root : `${root}/`).href, files });
	if (installed) return;
	installed = true;
	(globalThis as Record<symbol, unknown>)[REGISTRY] = SHARED;
	const hooks = createPluginModuleHooks(registered);
	module.registerHooks({
		resolve: (specifier, context, nextResolve) =>
			hooks.resolve(specifier, context.parentURL, () => nextResolve(specifier, context)),
		load: (url, context, nextLoad) =>
			hooks.load(url, () => nextLoad(url, context)) as ReturnType<typeof nextLoad>,
	});
}
