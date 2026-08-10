import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig, loadEnv } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

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

	return {
		plugins: [
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
				...(process.env.SENTRY_AUTH_TOKEN && {
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
			sourcemap: true,
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
				platform: "node",
				external: [
					"electron",
					"better-sqlite3",
					"@github/keytar",
					// LaunchDarkly's Node SDK is CommonJS and lazily `require`s Node
					// built-ins (e.g. `require("url")`); bundling it into the ESM main
					// bundle turns those into the `__require` shim, which throws at
					// runtime. Keep it external so Electron requires it from
					// node_modules (shipped via `pnpm deploy --prod`).
					"@launchdarkly/node-client-sdk",
					"@sentry/electron",
					"electron-store",
					"electron-log",
					"electron-squirrel-startup",
					"update-electron-app",
					"electron-debug",
					"execa",
					// shell-env resolves its own nested execa@5 (CJS default export);
					// keep it external so bundling does not rewrite that import onto
					// the workspace's execa@9 (ESM, no default export).
					"shell-env",
					// Bundle-external: @vscode/proxy-agent conditionally requires the
					// optional native addon @vscode/windows-ca-certs, which we do not
					// install (addCertificatesV2 → false, so it is never reached at
					// runtime). Keep the package external so its own require resolves
					// from node_modules and the bundler does not try to inline the
					// missing optional dep.
					"@vscode/proxy-agent",
					"@vscode/windows-ca-certs",
					...builtinModules,
					...builtinModules.map((module) => `node:${module}`),
				],
			},
		},
	};
});
