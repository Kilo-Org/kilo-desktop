import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
// Temporary: see the @sentry/bundler-plugins note in pnpm-workspace.yaml; revert to @sentry/vite-plugin.
import { sentryVitePlugin } from "@sentry/bundler-plugins/vite";
import { externalizeDeps } from "@kilo-desktop/vite-plugin-externalize-deps";
import { NOTEBOOK_MAIN_EXTERNALS } from "@kilo-desktop/plugin-notebook/packaging";

import {
	createViteEnvironmentDefinitions,
	getBuildEnvironment,
	requireViteEnvironmentVariable,
} from "./config/build-environment.js";
import { getReleaseTrack, getUpdatePublishUrls } from "./config/release.js";
import appInfo from "./package.json";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
	const track = getReleaseTrack(process.env);
	const environment = getBuildEnvironment(command, track);
	const viteEnvironment = loadEnv(environment, root, "VITE_");
	requireViteEnvironmentVariable(environment, viteEnvironment, "VITE_AUTH_CLIENT_ID");

	const uploadSourcemaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

	return {
		plugins: [
			externalizeDeps({
				// Not in `dependencies`: `electron` (devDep), `@vscode/windows-ca-certs`
				// (uninstalled optional native dep of `@vscode/proxy-agent`), and
				// `better-sqlite3` (transitive via the bundled kilo-ui / todos plugins).
				// The plugin externalizes each name plus its `<name>/<subpath>` forms.
				// The notebook native main externals (koffi, @runtimed/node) come from
				// the plugin-owned NOTEBOOK_MAIN_EXTERNALS so this list and the plugin
				// cannot drift — a mismatch would bundle a native addon that then fails
				// to load in packaged builds.
				include: [
					"electron",
					"better-sqlite3",
					"node-pty",
					"@vscode/windows-ca-certs",
					...NOTEBOOK_MAIN_EXTERNALS,
				],
				// Workspace packages are `workspace:*` deps that must stay
				// bundled (not resolvable runtime modules on disk).
				exclude: [/^@kilo-desktop\/.+$/],
			}),
			sentryVitePlugin({
				authToken: process.env.SENTRY_AUTH_TOKEN,
				org: "anaconda-nq",
				project: "kilo-desktop",
				release: {
					name: `${appInfo.name}@${appInfo.version}`,
					deploy: {
						env: process.env.APP_MODE ?? environment,
					},
				},
				...(uploadSourcemaps && {
					// Absolute and rooted at `.vite/`: Sentry globs this without
					// `dot: true`, so a bare `**/*.map` never descends into the
					// dot-prefixed Forge output and the map (with full
					// `sourcesContent`) shipped inside app.asar. Forward slashes
					// because glob treats `\` as an escape on Windows hosts.
					sourcemaps: {
						filesToDeleteAfterUpload: [`${root.replaceAll("\\", "/")}/.vite/build/**/*.map`],
					},
				}),
			}),
		],
		define: {
			...createViteEnvironmentDefinitions(viteEnvironment),
			RELEASE_TRACK: JSON.stringify(track),
			UPDATE_PUBLISH_URLS: JSON.stringify(getUpdatePublishUrls(process.env, track)),
			// The environments plugin resolves bridge resources relative to its
			// own package root. After bundling, import.meta.dirname no longer
			// reflects the original source tree, so we inject the absolute path
			// at build time (dev-only; packaged mode uses process.resourcesPath).
			__ENVIRONMENTS_PLUGIN_ROOT__: JSON.stringify(
				path.resolve(root, "../../plugins/environments"),
			),
		},
		resolve: {
			alias: {
				$config: path.resolve(root, "config"),
			},
			// Electron main is Node. Vite's client environment otherwise prefers
			// the `browser` export condition (e.g. `ws/browser.js`, which throws).
			conditions: ["node"],
			mainFields: ["module", "jsnext:main", "jsnext"],
		},
		build: {
			// Only emit source maps when they will be uploaded to Sentry and then
			// stripped from the output (filesToDeleteAfterUpload). Without the token,
			// emitting maps would ship raw `.map` files in the packaged `.app`.
			sourcemap: uploadSourcemaps,
			lib: {
				entry: "src/main/main.ts",
				formats: ["es"],
				fileName: () => "main.js",
			},
			rollupOptions: {
				// Vite treats this lib build as a client consumer, so Rolldown would
				// default `platform` to `browser` for ESM output. Browser platform does
				// not inject `module.createRequire`, and CJS deps (e.g. `ws`) then
				// throw on `require("events")` via Rolldown's `__require` shim. Pin
				// Node so those requires resolve.
				platform: "node",
			},
		},
	};
});
