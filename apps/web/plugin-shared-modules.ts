import { createRequire } from "node:module";
import path from "node:path";

import type { Plugin } from "vite";

/**
 * Modules the renderer shares with local plugins' window code, so a plugin
 * renders into the app's own React tree and kernel context instead of
 * bringing copies (two Reacts break hooks; two kernel/web copies break
 * `useDomainObject`). A plugin's bundle keeps these specifiers external, and
 * the page's import map points each one at a tiny module that re-exports the
 * app's instance.
 *
 * This list is public API for local plugins (see docs/plugins/local-plugins.md):
 * adding is cheap, removing or renaming breaks plugins and needs a plugin API
 * major version (KERNEL_API_VERSION). `cjs` modules have no static export
 * list, so their names are read here, at build time.
 */
export const SHARED_MODULES: readonly {
	readonly specifier: string;
	readonly kind: "cjs" | "esm";
}[] = [
	{ specifier: "react", kind: "cjs" },
	{ specifier: "react/jsx-runtime", kind: "cjs" },
	{ specifier: "react-dom", kind: "cjs" },
	{ specifier: "react-dom/client", kind: "cjs" },
	{ specifier: "zod", kind: "esm" },
	{ specifier: "@kilo-desktop/kernel", kind: "esm" },
	{ specifier: "@kilo-desktop/kernel/web", kind: "esm" },
	{ specifier: "@kilo-desktop/ui/lib/utils", kind: "esm" },
	...[
		"alert",
		"badge",
		"button",
		"card",
		"checkbox",
		"empty",
		"field",
		"input",
		"item",
		"kbd",
		"label",
		"scroll-area",
		"select",
		"separator",
		"skeleton",
		"spinner",
		"switch",
		"tabs",
		"textarea",
		"tooltip",
	].map((component) => ({
		specifier: `@kilo-desktop/ui/components/${component}`,
		kind: "esm" as const,
	})),
];

const VIRTUAL_PREFIX = "virtual:kilo-shared/";
const OUTPUT_DIRECTORY = "plugin-shared";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function moduleName(specifier: string): string {
	return specifier.replace(/^@/, "").replaceAll("/", "__");
}

function sharedModuleSource(
	{ specifier, kind }: (typeof SHARED_MODULES)[number],
	resolveFrom: string,
): string {
	if (kind === "esm") {
		// `export *` skips a default export; zod's is its `z` namespace, also exported as `z`.
		return `export * from ${JSON.stringify(specifier)};\n`;
	}
	const exportsObject = createRequire(resolveFrom)(specifier) as Record<string, unknown>;
	const names = Object.keys(exportsObject).filter(
		(name) => name !== "default" && IDENTIFIER.test(name),
	);
	return [
		`import shared from ${JSON.stringify(specifier)};`,
		"export default shared;",
		`export const { ${names.join(", ")} } = shared;`,
		"",
	].join("\n");
}

/**
 * Builds each shared module as an entry with a stable name
 * (`plugin-shared/<name>.js`, from the app's own module graph so it is the
 * same instance) and adds the import map to the page. In development the map
 * points at the dev server's copy of each virtual module instead.
 */
export function pluginSharedModules(root: string): Plugin {
	const resolveFrom = path.join(root, "package.json");
	const bySpecifier = new Map(
		SHARED_MODULES.map((shared) => [moduleName(shared.specifier), shared]),
	);
	return {
		name: "kilo-plugin-shared-modules",
		config(config, { command }) {
			if (command !== "build") return;
			const pageRoot = config.root ? path.resolve(config.root) : root;
			return {
				build: {
					rollupOptions: {
						input: {
							index: path.join(pageRoot, "index.html"),
							...Object.fromEntries(
								[...bySpecifier.keys()].map((name) => [
									`${OUTPUT_DIRECTORY}/${name}`,
									`${VIRTUAL_PREFIX}${name}`,
								]),
							),
						},
						// Vite drops an app's entry exports by default; these entries exist for them.
						preserveEntrySignatures: "exports-only",
						output: {
							entryFileNames: (chunk) =>
								chunk.name.startsWith(`${OUTPUT_DIRECTORY}/`)
									? "[name].js"
									: "assets/[name]-[hash].js",
						},
					},
				},
			};
		},
		resolveId(id) {
			return id.startsWith(VIRTUAL_PREFIX) ? `\0${id}` : undefined;
		},
		load(id) {
			if (!id.startsWith(`\0${VIRTUAL_PREFIX}`)) return undefined;
			const shared = bySpecifier.get(id.slice(VIRTUAL_PREFIX.length + 1));
			return shared ? sharedModuleSource(shared, resolveFrom) : undefined;
		},
		transformIndexHtml(_html, context) {
			const urlOf = (name: string) =>
				context.server ? `/@id/__x00__${VIRTUAL_PREFIX}${name}` : `/${OUTPUT_DIRECTORY}/${name}.js`;
			const imports = Object.fromEntries(
				[...bySpecifier].map(([name, { specifier }]) => [specifier, urlOf(name)]),
			);
			return [
				{
					tag: "script",
					attrs: { type: "importmap" },
					children: JSON.stringify({ imports }),
					injectTo: "head-prepend",
				},
			];
		},
	};
}
