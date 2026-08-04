import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig, loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

import {
	createViteEnvironmentDefinitions,
	getBuildEnvironment,
	requireViteEnvironmentVariable,
} from "./config/build-environment.js";
import { getReleaseChannel, getUpdatePublishUrl } from "./config/release.js";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
	const channel = getReleaseChannel(process.env);
	const environment = getBuildEnvironment(command, channel);
	const viteEnvironment = loadEnv(environment, root, "VITE_");
	requireViteEnvironmentVariable(environment, viteEnvironment, "VITE_AUTH_CLIENT_ID");

	return {
		plugins: [
			viteStaticCopy({
				targets: [
					{
						src: path.resolve(root, "drizzle/workspaces"),
						dest: "drizzle",
					},
				],
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
		},
		build: {
			lib: {
				entry: "src/main/main.ts",
				formats: ["es"],
				fileName: () => "main.js",
			},
			rollupOptions: {
				external: [
					"electron",
					"better-sqlite3",
					"@github/keytar",
					"electron-store",
					"electron-log",
					"electron-squirrel-startup",
					"update-electron-app",
					"electron-debug",
					"execa",
					...builtinModules,
					...builtinModules.map((module) => `node:${module}`),
				],
			},
		},
	};
});
