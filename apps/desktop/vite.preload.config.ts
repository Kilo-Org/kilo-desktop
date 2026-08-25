import { builtinModules } from "node:module";

import { defineConfig } from "vite";

// The preload runs in Electron's isolated preload context, where a bare
// `require("<dep>")` does not resolve (unlike the Node main process). It must
// bundle its dependencies (e.g. `zod`, pulled in transitively via
// `@anaconda-agentic-desktop/contracts`) inline and externalize only `electron`
// + Node built-ins. This is electron-vite's documented `build.externalizeDeps:
// false` case: do not run the externalize plugin here.
export default defineConfig({
	build: {
		rollupOptions: {
			external: [
				"electron",
				...builtinModules,
				...builtinModules.map((builtin) => `node:${builtin}`),
			],
		},
	},
});
