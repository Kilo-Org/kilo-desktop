import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));
// The host serves a plugin's `resources/` folder (packaged: the app's resources).
const outputDirectory = path.resolve(directory, "../../resources/terminal");
const nodeRequire = createRequire(import.meta.url);

function copyGhosttyWasm(): Plugin {
	return {
		name: "copy-ghostty-wasm",
		writeBundle() {
			mkdirSync(outputDirectory, { recursive: true });
			copyFileSync(
				nodeRequire.resolve("ghostty-web/ghostty-vt.wasm"),
				path.join(outputDirectory, "ghostty-vt.wasm"),
			);
		},
	};
}

export default defineConfig({
	root: directory,
	base: "./",
	plugins: [copyGhosttyWasm()],
	build: {
		outDir: outputDirectory,
		emptyOutDir: true,
	},
});
