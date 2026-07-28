import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { defineConfig } from "vite";

import { getReleaseChannel, getUpdatePublishUrl } from "./config/release.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const channel = getReleaseChannel(process.env);
const updatePublishUrl = getUpdatePublishUrl(process.env);

export default defineConfig(({ command }) => ({
	define: {
		...(command === "build" ? { MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined" } : {}),
		RELEASE_CHANNEL: JSON.stringify(channel),
		UPDATE_PUBLISH_URL: JSON.stringify(updatePublishUrl),
	},
	resolve: {
		alias: {
			$config: path.resolve(root, "config"),
			$shared: path.resolve(root, "src/shared"),
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
}));
