import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { externalizeDeps } from "vite-plugin-externalize-deps";

import {
	createViteEnvironmentDefinitions,
	getBuildEnvironment,
	requireViteEnvironmentVariable,
} from "./config/build-environment.js";
import { getReleaseChannel, getUpdatePublishUrl } from "./config/release.js";
import appInfo from "./package.json";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
	const channel = getReleaseChannel(process.env);
	const environment = getBuildEnvironment(command, channel);
	const viteEnvironment = loadEnv(environment, root, "VITE_");
	requireViteEnvironmentVariable(environment, viteEnvironment, "VITE_AUTH_CLIENT_ID");

	const uploadSourcemaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

	return {
		plugins: [
			// Externalize every runtime dependency (and Node built-ins) instead of
			// hand-maintaining a `rollupOptions.external` array. Rolldown (Vite 8)
			// otherwise rewrites CJS `require(...)` into a `__require` shim that
			// throws at runtime for lazy-`require` deps (LaunchDarkly, `shell-env`'s
			// nested execa@5, `@vscode/proxy-agent`, `ws` via the webmcp relay), and
			// native modules (`better-sqlite3`, `@github/keytar`) can never be
			// bundled. Externalized packages ship on disk via `pnpm deploy --prod`
			// (see forge.config.ts).
			externalizeDeps({
				useFile: path.resolve(root, "package.json"),
				// Not present in `dependencies`: `electron` is a devDependency and
				// `@vscode/windows-ca-certs` is an uninstalled optional native dep of
				// `@vscode/proxy-agent`. `better-sqlite3` is a transitive dep of the
				// bundled kilo-ui / todos plugins, so this package.json does not list
				// it. (`@github/keytar` is a direct dependency, so `deps` covers it.)
				include: ["electron", /^better-sqlite3(?:\/.+)?$/, "@vscode/windows-ca-certs"],
				// Workspace-internal packages must stay bundled into the main output;
				// they are `workspace:*` / `link:` deps, not resolvable runtime modules.
				except: [/^@anaconda-agentic-desktop\/(?:.+)?$/],
			}),
			sentryVitePlugin({
				authToken: process.env.SENTRY_AUTH_TOKEN,
				org: "anaconda-nq",
				project: "agentic-desktop",
				release: {
					name: `${appInfo.name}@${appInfo.version}`,
					deploy: {
						env: process.env.APP_MODE ?? environment,
					},
				},
				...(uploadSourcemaps && {
					sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
				}),
			}),
		],
		define: {
			...createViteEnvironmentDefinitions(viteEnvironment),
			RELEASE_CHANNEL: JSON.stringify(channel),
			UPDATE_PUBLISH_URL: JSON.stringify(getUpdatePublishUrl(process.env)),
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
				// not inject `module.createRequire`, and CJS deps such as `ws` (pulled
				// in by `@mcp-b/webmcp-local-relay`) then throw on `require("events")`
				// via Rolldown's `__require` shim. Pin Node so those requires resolve.
				// (The externalizeDeps plugin above supplies `external`.)
				platform: "node",
			},
		},
	};
});
